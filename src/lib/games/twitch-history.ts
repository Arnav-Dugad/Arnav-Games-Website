/**
 * Twitch viewership history: the cron (slots 1 and 4 of the 10-minute
 * schedule, so twice an hour) samples tracked games into `twitch_history`;
 * `/api/game/[id]/twitch` reads them back as a chart.
 *
 * What a sample is, precisely: the summed `viewer_count` and number of
 * streams on the first Helix page for the category — the top 100 live
 * streams by viewers. Helix has no category total, and one page per game is
 * what fits the request budget; for all but the largest categories the top
 * 100 is effectively everyone, and where it isn't the figure is an
 * undercount, never an inflation. The route documents it the same way.
 *
 * Twitch category ids live in `tracked_games.twitch`: NULL = not looked up
 * yet, '' = Twitch had no category for the IGDB id when last asked (re-asked
 * on rotation, since categories appear as games approach launch).
 */

import { getDb } from "@/lib/cloudflare/db";
import type { FetchBudget } from "./fetch-budget";
import { downsampleTwitch, sumStreams } from "./history-rules";
import { igdbAppAuth } from "./providers/igdb";
import { externalIdsFor } from "./providers/igdb-extras";
import type { TwitchHistory } from "./types";

const HOUR = 3600;
const DAY = 24 * HOUR;
export const TWITCH_RETENTION_DAYS = 120;
const CONCURRENCY = 8;
/** Games in the most-recently-viewed pool get an hourly sample (two runs × 40). */
const HOURLY_POOL = 80;
const TWITCH_ID = /^\d{1,12}$/;

type Auth = { clientId: string; token: string };

async function helix<T>(auth: Auth, path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
      headers: { "Client-ID": auth.clientId, Authorization: `Bearer ${auth.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** One app token for the run (the IGDB token; charged as one request when cold). */
export async function twitchAuth(budget: FetchBudget): Promise<Auth | null> {
  if (!budget.take()) return null;
  return igdbAppAuth();
}

/**
 * Fills `tracked_games.twitch` for up to 100 games with one Helix request
 * (`games?igdb_id=…` accepts 100 ids). Unlooked-up games go first; when
 * none are left, previously-unmatched ones are re-asked in rotation.
 */
export async function linkTwitchIds(auth: Auth, budget: FetchBudget): Promise<{ asked: number; linked: number }> {
  const db = await getDb();
  if (!db) return { asked: 0, linked: 0 };
  let ids: number[] = [];
  try {
    const fresh = await db
      .prepare("SELECT game_id FROM tracked_games WHERE game_id > 0 AND twitch IS NULL ORDER BY last_seen DESC LIMIT 100")
      .all<{ game_id: number }>();
    ids = (fresh.results ?? []).map((row) => row.game_id);
    if (ids.length === 0) {
      const total = (await db.prepare("SELECT COUNT(*) AS n FROM tracked_games WHERE game_id > 0 AND twitch = ''").first<{ n: number }>())?.n ?? 0;
      if (total > 0) {
        const turn = Math.floor(Date.now() / 1000 / HOUR);
        const retry = await db
          .prepare("SELECT game_id FROM tracked_games WHERE game_id > 0 AND twitch = '' ORDER BY game_id LIMIT 100 OFFSET ?")
          .bind((turn * 100) % total)
          .all<{ game_id: number }>();
        ids = (retry.results ?? []).map((row) => row.game_id);
      }
    }
  } catch (err) {
    console.warn("[twitch] link read failed:", err instanceof Error ? err.message : err);
    return { asked: 0, linked: 0 };
  }
  if (ids.length === 0 || !budget.take()) return { asked: 0, linked: 0 };

  const json = await helix<{ data?: Array<{ id?: string; igdb_id?: string }> }>(
    auth,
    `games?${ids.map((id) => `igdb_id=${id}`).join("&")}`,
  );
  if (!json) return { asked: ids.length, linked: 0 };
  const found = new Map<number, string>();
  for (const row of json.data ?? []) {
    const igdb = Number(row.igdb_id);
    if (row.id && TWITCH_ID.test(row.id) && Number.isInteger(igdb)) found.set(igdb, row.id);
  }
  const statement = db.prepare("UPDATE tracked_games SET twitch = ? WHERE game_id = ?");
  try {
    for (let i = 0; i < ids.length; i += 50) {
      await db.batch(ids.slice(i, i + 50).map((id) => statement.bind(found.get(id) ?? "", id)));
    }
  } catch (err) {
    console.warn("[twitch] link write failed:", err instanceof Error ? err.message : err);
  }
  return { asked: ids.length, linked: found.size };
}

/**
 * Categories to sample this run: those in the hourly pool (the 80 most
 * recently viewed) not yet sampled this hour; leftover slots go to the rest,
 * least recently sampled first, so every tracked game is covered over time.
 */
export async function twitchSampleQueue(limit: number): Promise<string[]> {
  const db = await getDb();
  if (!db || limit <= 0) return [];
  const now = Math.floor(Date.now() / 1000);
  const hour = now - (now % HOUR);
  const notThisHour = "NOT EXISTS (SELECT 1 FROM twitch_history h WHERE h.twitch_id = p.twitch AND h.hour = ?)";
  try {
    const due = await db
      .prepare(
        "SELECT p.twitch AS twitch FROM (SELECT twitch, MAX(last_seen) AS seen FROM tracked_games " +
          "WHERE twitch IS NOT NULL AND twitch <> '' GROUP BY twitch ORDER BY seen DESC LIMIT ?) p " +
          `WHERE ${notThisHour} ORDER BY p.seen DESC LIMIT ?`,
      )
      .bind(HOURLY_POOL, hour, limit)
      .all<{ twitch: string }>();
    const picked = (due.results ?? []).map((row) => row.twitch);
    if (picked.length < limit) {
      const rest = await db
        .prepare(
          "SELECT p.twitch AS twitch FROM (SELECT twitch, MAX(last_seen) AS seen FROM tracked_games " +
            "WHERE twitch IS NOT NULL AND twitch <> '' GROUP BY twitch) p " +
            `WHERE ${notThisHour} ` +
            "ORDER BY (SELECT MAX(h.hour) FROM twitch_history h WHERE h.twitch_id = p.twitch) ASC, p.seen DESC LIMIT ?",
        )
        .bind(hour, limit + HOURLY_POOL)
        .all<{ twitch: string }>();
      for (const row of rest.results ?? []) {
        if (picked.length >= limit) break;
        if (!picked.includes(row.twitch)) picked.push(row.twitch);
      }
    }
    return picked.filter((id) => TWITCH_ID.test(id));
  } catch (err) {
    console.warn("[twitch] queue failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** One Helix request per category (each charged to `budget`), filed under the current hour. */
export async function sampleTwitch(
  ids: string[],
  auth: Auth,
  budget: FetchBudget,
): Promise<{ sampled: number; stored: number; pruned: number }> {
  const categories = [...new Set(ids.filter((id) => TWITCH_ID.test(id)))];
  const db = await getDb();
  if (!db || categories.length === 0) return { sampled: 0, stored: 0, pruned: 0 };

  const hour = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
  const samples: Array<[string, { viewers: number; streams: number }]> = [];
  let cursor = 0;
  let sampled = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, categories.length) }, async () => {
      while (cursor < categories.length) {
        const id = categories[cursor++];
        if (!budget.take()) return;
        sampled++;
        const json = await helix<{ data?: Array<{ viewer_count?: unknown }> }>(auth, `streams?game_id=${id}&first=100`);
        if (json) samples.push([id, sumStreams(json.data)]);
      }
    }),
  );

  const statement = db.prepare("INSERT OR REPLACE INTO twitch_history (twitch_id, hour, viewers, streams) VALUES (?, ?, ?, ?)");
  let stored = 0;
  for (let i = 0; i < samples.length; i += 50) {
    const part = samples.slice(i, i + 50);
    try {
      await db.batch(part.map(([id, s]) => statement.bind(id, hour, s.viewers, s.streams)));
      stored += part.length;
    } catch (err) {
      console.warn("[twitch] store failed:", err instanceof Error ? err.message : err);
    }
  }

  let pruned = 0;
  try {
    const result = await db
      .prepare("DELETE FROM twitch_history WHERE hour < ?")
      .bind(hour - TWITCH_RETENTION_DAYS * DAY)
      .run();
    pruned = result.meta.changes ?? 0;
  } catch (err) {
    console.warn("[twitch] prune failed:", err instanceof Error ? err.message : err);
  }
  return { sampled, stored, pruned };
}

/**
 * The Twitch category for a game: our own link first (D1), then IGDB's
 * external ids (a cached query the market routes have usually warmed).
 */
export async function twitchIdFor(key: number | null, igdbId: number | null): Promise<string | null> {
  const db = key !== null ? await getDb() : null;
  if (db && key !== null) {
    try {
      const row = await db.prepare("SELECT twitch FROM tracked_games WHERE game_id = ?").bind(key).first<{ twitch: string | null }>();
      if (row?.twitch && TWITCH_ID.test(row.twitch)) return row.twitch;
    } catch {
      // Fall through to IGDB.
    }
  }
  if (!igdbId) return null;
  const id = (await externalIdsFor([igdbId])).get(igdbId)?.twitch ?? null;
  if (id && TWITCH_ID.test(id)) return id;
  // IGDB doesn't link every game (Counter-Strike 2 has no Twitch row); Twitch
  // itself maps IGDB ids. Cached a day — categories don't move.
  const auth = await igdbAppAuth();
  if (!auth) return null;
  try {
    const res = await fetch(`https://api.twitch.tv/helix/games?igdb_id=${igdbId}`, {
      headers: { "Client-ID": auth.clientId, Authorization: `Bearer ${auth.token}` },
      next: { revalidate: DAY },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const found = ((await res.json()) as { data?: Array<{ id?: string }> }).data?.[0]?.id;
    return found && TWITCH_ID.test(found) ? found : null;
  } catch {
    return null;
  }
}

/** The chart series for one category; empty (not null) when nothing is recorded. */
export async function twitchHistoryFor(twitchId: string): Promise<TwitchHistory> {
  const empty: TwitchHistory = { twitchId, points: [], peak24h: null, peakTracked: null, since: null };
  const db = await getDb();
  if (!db) return empty;
  const now = Math.floor(Date.now() / 1000);
  try {
    const result = await db
      .prepare("SELECT hour, viewers, streams FROM twitch_history WHERE twitch_id = ? AND hour >= ? ORDER BY hour")
      .bind(twitchId, now - TWITCH_RETENTION_DAYS * DAY)
      .all<{ hour: number; viewers: number; streams: number }>();
    return { twitchId, ...downsampleTwitch(result.results ?? [], now) };
  } catch (err) {
    console.warn("[twitch] read failed:", err instanceof Error ? err.message : err);
    return empty;
  }
}
