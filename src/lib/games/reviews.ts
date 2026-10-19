/**
 * Steam review velocity around launch: an hourly cron samples review totals
 * for tracked games released in the last 14 days or releasing in the next 2,
 * into `review_history`; `/api/game/[id]/reviews` reads them back.
 *
 * Steam publishes only the running totals, so "how fast are reviews coming
 * in" and "how did launch week go" exist only because we sample — and only
 * for the window we sampled, which the summary respects (`history-rules.ts`).
 *
 * Known gap: candidates come from IGDB release dates, so Steam-only tracked
 * titles (negative keys) aren't sampled — finding their dates would cost a
 * Steam store request each, every hour.
 */

import { getDb } from "@/lib/cloudflare/db";
import type { FetchBudget } from "./fetch-budget";
import { reviewVelocity } from "./history-rules";
import { releaseDatesInWindow } from "./providers/igdb-extras";
import { parseSteamDate } from "./providers/steam";
import { steamFullDetails } from "./steam-store";
import type { ReviewVelocity } from "./types";

const HOUR = 3600;
const DAY = 24 * HOUR;
const CONCURRENCY = 8;
/** Launch windows are short; a year of samples is far more than any chart needs. */
const RETENTION_DAYS = 365;
/** How many tracked games are checked against IGDB's calendar per run. */
const CANDIDATE_POOL = 500;

export interface ReviewQueue {
  apps: number[];
  /** Tracked games whose release falls in the window (before the cap). */
  inWindow: number;
}

/**
 * Steam apps to sample this run, closest-to-launch first. Costs one IGDB
 * request (two above 500 tracked games), charged to `budget`.
 */
export async function reviewSampleQueue(limit: number, budget: FetchBudget): Promise<ReviewQueue> {
  const db = await getDb();
  if (!db) return { apps: [], inWindow: 0 };
  let rows: Array<{ game_id: number; steam_app: number }> = [];
  try {
    rows =
      (
        await db
          .prepare(
            "SELECT game_id, steam_app FROM tracked_games WHERE game_id > 0 AND steam_app IS NOT NULL ORDER BY last_seen DESC LIMIT ?",
          )
          .bind(CANDIDATE_POOL)
          .all<{ game_id: number; steam_app: number }>()
      ).results ?? [];
  } catch (err) {
    console.warn("[reviews] queue read failed:", err instanceof Error ? err.message : err);
    return { apps: [], inWindow: 0 };
  }
  if (rows.length === 0 || !budget.take(2)) return { apps: [], inWindow: 0 }; // query + token

  const now = Math.floor(Date.now() / 1000);
  const hour = now - (now % HOUR);
  const dates = await releaseDatesInWindow(
    rows.map((row) => row.game_id),
    hour - 14 * DAY,
    hour + 2 * DAY + HOUR,
  );
  const candidates = rows
    .filter((row) => dates.has(row.game_id))
    .map((row) => ({ app: row.steam_app, distance: Math.abs(now - dates.get(row.game_id)!) }))
    .sort((a, b) => a.distance - b.distance);
  const apps = [...new Set(candidates.map((c) => c.app))];
  return { apps: apps.slice(0, Math.max(0, limit)), inWindow: apps.length };
}

/** Review totals right now, uncached (a cached figure would be filed under the wrong hour). */
async function currentReviews(appid: number): Promise<{ total: number; positive: number } | null> {
  try {
    const res = await fetch(
      `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`,
      { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(3500) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      success?: number;
      query_summary?: { total_positive?: number; total_negative?: number; total_reviews?: number };
    };
    const summary = json.success === 1 ? json.query_summary : undefined;
    if (!summary) return null;
    const positive = summary.total_positive ?? 0;
    const total = summary.total_reviews ?? positive + (summary.total_negative ?? 0);
    return Number.isFinite(total) && total >= 0 && positive >= 0 ? { total, positive } : null;
  } catch {
    return null;
  }
}

/** One request per app (each charged to `budget`), filed under the current hour. */
export async function sampleReviews(
  appids: number[],
  budget: FetchBudget,
): Promise<{ sampled: number; stored: number; pruned: number }> {
  const apps = [...new Set(appids.filter((id) => Number.isInteger(id) && id > 0))];
  const db = await getDb();
  if (!db || apps.length === 0) return { sampled: 0, stored: 0, pruned: 0 };

  const hour = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
  const counts: Array<[number, { total: number; positive: number }]> = [];
  let cursor = 0;
  let sampled = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, apps.length) }, async () => {
      while (cursor < apps.length) {
        const appid = apps[cursor++];
        if (!budget.take()) return;
        sampled++;
        const summary = await currentReviews(appid);
        if (summary) counts.push([appid, summary]);
      }
    }),
  );

  const statement = db.prepare("INSERT OR REPLACE INTO review_history (app_id, hour, total, positive) VALUES (?, ?, ?, ?)");
  let stored = 0;
  for (let i = 0; i < counts.length; i += 50) {
    const part = counts.slice(i, i + 50);
    try {
      await db.batch(part.map(([appid, s]) => statement.bind(appid, hour, s.total, s.positive)));
      stored += part.length;
    } catch (err) {
      console.warn("[reviews] store failed:", err instanceof Error ? err.message : err);
    }
  }

  let pruned = 0;
  try {
    const result = await db.prepare("DELETE FROM review_history WHERE hour < ?").bind(hour - RETENTION_DAYS * DAY).run();
    pruned = result.meta.changes ?? 0;
  } catch (err) {
    console.warn("[reviews] prune failed:", err instanceof Error ? err.message : err);
  }
  return { sampled, stored, pruned };
}

/**
 * Launch time for the 72-hour figure: UTC midnight of Steam's release date
 * (Steam publishes a day, not a time). Read through the same cached store
 * record the PC panel and detail page use.
 */
async function steamLaunch(appid: number): Promise<number | null> {
  const details = await steamFullDetails(appid).catch(() => null);
  if (!details?.release_date || details.release_date.coming_soon) return null;
  const released = parseSteamDate(details.release_date.date).released;
  const at = released ? Date.parse(`${released}T00:00:00Z`) : NaN;
  return Number.isFinite(at) ? at / 1000 : null;
}

/** The series for one app; empty (not null) when nothing is recorded. */
export async function reviewVelocityFor(appid: number): Promise<ReviewVelocity> {
  const now = Math.floor(Date.now() / 1000);
  const db = await getDb();
  if (!db) return reviewVelocity(appid, [], null, now);
  try {
    const result = await db
      .prepare("SELECT hour, total, positive FROM review_history WHERE app_id = ? ORDER BY hour")
      .bind(appid)
      .all<{ hour: number; total: number; positive: number }>();
    const samples = result.results ?? [];
    // The launch date only matters when there is something to measure.
    const launch = samples.length > 0 ? await steamLaunch(appid) : null;
    return reviewVelocity(appid, samples, launch, now);
  } catch (err) {
    console.warn("[reviews] read failed:", err instanceof Error ? err.message : err);
    return reviewVelocity(appid, [], null, now);
  }
}
