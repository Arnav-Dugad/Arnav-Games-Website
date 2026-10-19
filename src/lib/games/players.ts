/**
 * Steam concurrent-player history: an hourly cron samples tracked games into
 * `player_history`, and `/api/game/[id]/players` reads it back as a chart.
 *
 * Steam publishes only the *current* count (the same call the live panel
 * uses); the history is entirely our own sampling, which is why it starts
 * the day a game was first tracked and says so (`since`).
 */

import { getDb } from "@/lib/cloudflare/db";
import { choosePlayerSamples, downsamplePlayers } from "./market-rules";
import type { PlayerHistory } from "./types";

const HOUR = 3600;
/** Samples older than this are pruned; the chart never shows more. */
export const PLAYER_RETENTION_DAYS = 120;
const CONCURRENCY = 8;
/** Matches the every-10-minutes players schedule in worker.mjs. */
export const PLAYER_RUNS_PER_HOUR = 6;
const WEEK = 7 * 24 * HOUR;

/**
 * The apps this run should sample (see `choosePlayerSamples` for the rules).
 * Both lists come from D1 — binding calls, not subrequests.
 */
export async function playerSampleQueue(limit: number, reserve = 8): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const now = Math.floor(Date.now() / 1000);
  const hour = now - (now % HOUR);
  const run = Math.floor((now % HOUR) / (HOUR / PLAYER_RUNS_PER_HOUR));
  const recent = "EXISTS (SELECT 1 FROM player_history p WHERE p.app_id = t.steam_app AND p.hour >= ?)";
  try {
    const [due, quiet] = await Promise.all([
      db
        .prepare(
          `SELECT t.steam_app AS app FROM tracked_games t WHERE t.steam_app IS NOT NULL AND ${recent} ` +
            "AND NOT EXISTS (SELECT 1 FROM player_history p WHERE p.app_id = t.steam_app AND p.hour = ?) " +
            "GROUP BY t.steam_app ORDER BY MAX(t.last_seen) DESC LIMIT ?",
        )
        .bind(hour - WEEK, hour, limit)
        .all<{ app: number }>(),
      db
        .prepare(
          `SELECT t.steam_app AS app FROM tracked_games t WHERE t.steam_app IS NOT NULL AND NOT ${recent} ` +
            "GROUP BY t.steam_app ORDER BY MAX(t.last_seen) DESC, t.steam_app LIMIT ?",
        )
        .bind(hour - WEEK, limit * PLAYER_RUNS_PER_HOUR)
        .all<{ app: number }>(),
    ]);
    return choosePlayerSamples({
      due: (due.results ?? []).map((row) => row.app),
      quiet: (quiet.results ?? []).map((row) => row.app),
      run,
      runsPerHour: PLAYER_RUNS_PER_HOUR,
      limit,
      reserve,
    });
  } catch (err) {
    console.warn("[players] queue failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Current players, fresh (no data cache — a cached sample would be a lie
 * about the hour it is filed under). Null on failure or for an app Steam
 * doesn't report (unreleased games answer `result: 42`).
 */
async function currentPlayers(appid: number): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
      { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(3500) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { response?: { player_count?: number; result?: number } };
    const count = json.response?.result === 1 ? json.response.player_count : undefined;
    return typeof count === "number" && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

/**
 * Samples each app once (one request each), at most 8 in flight, and files
 * the counts under the current hour. Re-running within the hour overwrites,
 * never duplicates.
 */
export async function samplePlayers(appids: number[]): Promise<{ sampled: number; stored: number; pruned: number }> {
  const apps = [...new Set(appids.filter((id) => Number.isInteger(id) && id > 0))];
  const db = await getDb();
  if (!db || apps.length === 0) return { sampled: apps.length, stored: 0, pruned: 0 };

  const hour = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
  const counts: Array<[number, number]> = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, apps.length) }, async () => {
      while (cursor < apps.length) {
        const appid = apps[cursor++];
        const players = await currentPlayers(appid);
        if (players !== null) counts.push([appid, players]);
      }
    }),
  );

  const statement = db.prepare("INSERT OR REPLACE INTO player_history (app_id, hour, players) VALUES (?, ?, ?)");
  let stored = 0;
  for (let i = 0; i < counts.length; i += 50) {
    const part = counts.slice(i, i + 50);
    try {
      await db.batch(part.map(([appid, players]) => statement.bind(appid, hour, players)));
      stored += part.length;
    } catch (err) {
      console.warn("[players] store failed:", err instanceof Error ? err.message : err);
    }
  }

  let pruned = 0;
  try {
    const result = await db
      .prepare("DELETE FROM player_history WHERE hour < ?")
      .bind(hour - PLAYER_RETENTION_DAYS * 24 * HOUR)
      .run();
    pruned = result.meta.changes ?? 0;
  } catch (err) {
    console.warn("[players] prune failed:", err instanceof Error ? err.message : err);
  }
  return { sampled: apps.length, stored, pruned };
}

/** The chart series for one app; empty (not null) when nothing is recorded. */
export async function playerHistoryFor(appid: number): Promise<PlayerHistory> {
  const empty: PlayerHistory = { appId: appid, points: [], peak24h: null, peakTracked: null, since: null };
  const db = await getDb();
  if (!db) return empty;
  const now = Math.floor(Date.now() / 1000);
  try {
    const result = await db
      .prepare("SELECT hour, players FROM player_history WHERE app_id = ? AND hour >= ? ORDER BY hour")
      .bind(appid, now - PLAYER_RETENTION_DAYS * 24 * HOUR)
      .all<{ hour: number; players: number }>();
    return { appId: appid, ...downsamplePlayers(result.results ?? [], now) };
  } catch (err) {
    console.warn("[players] read failed:", err instanceof Error ? err.message : err);
    return empty;
  }
}
