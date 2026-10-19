/**
 * Critic-score timeline: a daily cron records IGDB's aggregated critic
 * rating for tracked games released in the last 120 days (`score_history`),
 * so a game page can show how its score settled after launch.
 *
 * IGDB keeps only the current aggregate; the timeline exists only from the
 * day we started observing it, which `since` says.
 */

import { getDb } from "@/lib/cloudflare/db";
import type { FetchBudget } from "./fetch-budget";
import { scoreTimeline } from "./history-rules";
import { criticAggregatesFor } from "./providers/igdb-extras";
import type { ScoreTimeline } from "./types";

const DAY = 86_400;
/** Scores settle within weeks; four months covers launch and the long tail of reviews. */
export const SCORE_WINDOW_DAYS = 120;
/** Tracked games checked per run (500 per IGDB query). */
const MAX_GAMES = 1000;
const RETENTION_DAYS = 400;

/**
 * Records today's aggregate for every tracked IGDB game released in the
 * window that has one. One IGDB request per 500 games (+ the token), each
 * charged to `budget`. Re-running the same day overwrites that day's row.
 */
export async function recordCriticScores(
  budget: FetchBudget,
): Promise<{ checked: number; scored: number; stored: number; failed: boolean }> {
  const db = await getDb();
  if (!db) return { checked: 0, scored: 0, stored: 0, failed: false };
  let ids: number[] = [];
  try {
    const rows = await db
      .prepare("SELECT game_id FROM tracked_games WHERE game_id > 0 ORDER BY last_seen DESC LIMIT ?")
      .bind(MAX_GAMES)
      .all<{ game_id: number }>();
    ids = (rows.results ?? []).map((row) => row.game_id);
  } catch (err) {
    console.warn("[scores] read failed:", err instanceof Error ? err.message : err);
    return { checked: 0, scored: 0, stored: 0, failed: true };
  }
  const queries = Math.ceil(ids.length / 500);
  if (ids.length === 0 || !budget.take(queries + 1)) return { checked: ids.length, scored: 0, stored: 0, failed: false };

  const now = Math.floor(Date.now() / 1000);
  const today = now - (now % DAY);
  // Day-aligned bounds: a same-day re-run is a cache hit, tomorrow's asks afresh.
  const scores = await criticAggregatesFor(ids, today - SCORE_WINDOW_DAYS * DAY, today + DAY);
  if (!scores) return { checked: ids.length, scored: 0, stored: 0, failed: true };

  const date = new Date(today * 1000).toISOString().slice(0, 10);
  const statement = db.prepare("INSERT OR REPLACE INTO score_history (game_id, observed_on, score, count) VALUES (?, ?, ?, ?)");
  const entries = [...scores];
  let stored = 0;
  for (let i = 0; i < entries.length; i += 50) {
    const part = entries.slice(i, i + 50);
    try {
      await db.batch(part.map(([id, s]) => statement.bind(id, date, Math.round(s.score * 10) / 10, s.count)));
      stored += part.length;
    } catch (err) {
      console.warn("[scores] store failed:", err instanceof Error ? err.message : err);
    }
  }
  try {
    const cutoff = new Date((today - RETENTION_DAYS * DAY) * 1000).toISOString().slice(0, 10);
    await db.prepare("DELETE FROM score_history WHERE observed_on < ?").bind(cutoff).run();
  } catch (err) {
    console.warn("[scores] prune failed:", err instanceof Error ? err.message : err);
  }
  return { checked: ids.length, scored: scores.size, stored, failed: false };
}

/** One game's observations; empty (not null) when nothing is recorded. */
export async function scoreTimelineFor(gameId: number): Promise<ScoreTimeline> {
  const db = await getDb();
  if (!db) return { points: [], since: null };
  try {
    const result = await db
      .prepare("SELECT observed_on, score, count FROM score_history WHERE game_id = ? ORDER BY observed_on")
      .bind(gameId)
      .all<{ observed_on: string; score: number; count: number }>();
    return scoreTimeline(result.results ?? []);
  } catch (err) {
    console.warn("[scores] timeline read failed:", err instanceof Error ? err.message : err);
    return { points: [], since: null };
  }
}
