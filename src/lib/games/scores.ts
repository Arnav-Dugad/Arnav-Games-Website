/**
 * Critic-score timeline: a daily cron records IGDB's aggregated critic
 * rating for tracked games released in the last 120 days into
 * `scoreHistory/{igdbId}` (one document per game, one field per day — see
 * `stats-docs.ts`), so a game page can show how its score settled after
 * launch. The page reads the document straight from Firestore.
 *
 * IGDB keeps only the current aggregate; the timeline exists only from the
 * day we started observing it, which `since` says.
 */

import { commitWrites, fieldPath, type Write } from "@/lib/firebase/server";
import type { FetchBudget } from "./fetch-budget";
import { criticAggregatesFor } from "./providers/igdb-extras";
import { expiredDays, STATS_COLLECTIONS } from "./stats-docs";
import type { TrackedIndex } from "./tracked";

const DAY = 86_400;
/** Scores settle within weeks; four months covers launch and the long tail of reviews. */
export const SCORE_WINDOW_DAYS = 120;
/** Tracked games checked per run (500 per IGDB query). */
const MAX_GAMES = 1000;
const RETENTION_DAYS = 400;

/**
 * Records today's aggregate for every tracked IGDB game released in the
 * window that has one. One IGDB request per 500 games (+ the token) and one
 * Firestore commit per 500 scores, each charged to `budget`. Re-running the
 * same day overwrites that day's value.
 */
export async function recordCriticScores(
  index: TrackedIndex,
  budget: FetchBudget,
): Promise<{ checked: number; scored: number; stored: number; failed: boolean }> {
  const ids = index.games.filter((game) => game.gameId > 0).slice(0, MAX_GAMES).map((game) => game.gameId);
  const queries = Math.ceil(ids.length / 500);
  if (ids.length === 0 || !budget.take(queries + 1)) return { checked: ids.length, scored: 0, stored: 0, failed: false };

  const now = Math.floor(Date.now() / 1000);
  const today = now - (now % DAY);
  // Day-aligned bounds: a same-day re-run is a cache hit, tomorrow's asks afresh.
  const scores = await criticAggregatesFor(ids, today - SCORE_WINDOW_DAYS * DAY, today + DAY);
  if (!scores) return { checked: ids.length, scored: 0, stored: 0, failed: true };

  const date = new Date(today * 1000).toISOString().slice(0, 10);
  const expired = expiredDays(date, RETENTION_DAYS);
  const writes: Write[] = [...scores].map(([id, s]) => ({
    type: "update",
    path: `${STATS_COLLECTIONS.scores}/${id}`,
    data: { gameId: id, updatedAt: date, s: { [date]: [Math.round(s.score * 10) / 10, s.count] } },
    mask: ["gameId", "updatedAt", fieldPath("s", date), ...expired.map((day) => fieldPath("s", day))],
  }));
  const commits = Math.ceil(writes.length / 500);
  const stored = writes.length > 0 && budget.take(commits) ? await commitWrites(writes) : 0;
  return { checked: ids.length, scored: scores.size, stored, failed: false };
}
