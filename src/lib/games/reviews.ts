/**
 * Steam review velocity around launch: an hourly cron samples review totals
 * for tracked games released in the last 14 days or releasing in the next 2,
 * into `reviewHistory/{appid}` (one document per app, one field per hour —
 * see `stats-docs.ts`); the game page reads it straight from Firestore.
 *
 * Steam publishes only the running totals, so "how fast are reviews coming
 * in" and "how did launch week go" exist only because we sample — and only
 * for the window we sampled, which the summary respects (`history-rules.ts`).
 *
 * Known gap: candidates come from IGDB release dates, so Steam-only tracked
 * titles (negative keys) aren't sampled — finding their dates would cost a
 * Steam store request each, every hour.
 */

import { commitWrites, fieldPath, type Write } from "@/lib/firebase/server";
import type { FetchBudget } from "./fetch-budget";
import { releaseDatesInWindow } from "./providers/igdb-extras";
import { expiredHours, STATS_COLLECTIONS } from "./stats-docs";
import type { TrackedIndex } from "./tracked";

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
 * Steam apps to sample this run, closest-to-launch first, from the tracked
 * index the cron already read. Costs one IGDB request (+ its token),
 * charged to `budget`.
 */
export async function reviewSampleQueue(index: TrackedIndex, limit: number, budget: FetchBudget): Promise<ReviewQueue> {
  const rows = index.games
    .filter((game) => game.gameId > 0 && game.steamApp)
    .slice(0, CANDIDATE_POOL)
    .map((game) => ({ gameId: game.gameId, steamApp: game.steamApp! }));
  if (rows.length === 0 || !budget.take(2)) return { apps: [], inWindow: 0 }; // query + token

  const now = Math.floor(Date.now() / 1000);
  const hour = now - (now % HOUR);
  const dates = await releaseDatesInWindow(
    rows.map((row) => row.gameId),
    hour - 14 * DAY,
    hour + 2 * DAY + HOUR,
  );
  const candidates = rows
    .filter((row) => dates.has(row.gameId))
    .map((row) => ({ app: row.steamApp, distance: Math.abs(now - dates.get(row.gameId)!) }))
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

/**
 * One request per app (each charged to `budget`), filed under the current
 * hour, then one commit (charged too) for every sample.
 */
export async function sampleReviews(appids: number[], budget: FetchBudget): Promise<{ sampled: number; stored: number }> {
  const apps = [...new Set(appids.filter((id) => Number.isInteger(id) && id > 0))];
  if (apps.length === 0) return { sampled: 0, stored: 0 };

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

  const expired = expiredHours(hour, RETENTION_DAYS);
  const writes: Write[] = counts.map(([appid, s]) => ({
    type: "update",
    path: `${STATS_COLLECTIONS.reviews}/${appid}`,
    data: { appId: appid, updatedAt: hour, s: { [hour]: [s.total, s.positive] } },
    mask: ["appId", "updatedAt", fieldPath("s", hour), ...expired.map((h) => fieldPath("s", h))],
  }));
  const committed = writes.length > 0 && budget.take() ? await commitWrites(writes) : 0;
  return { sampled, stored: committed };
}
