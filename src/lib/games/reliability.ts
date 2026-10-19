/**
 * How reliably a studio ships on its announced dates, from our own delay
 * tracker (`release_observations`). Pass the IGDB ids of the studio's games;
 * the rules live in `reliabilityFromObservations` (pure, self-checked).
 *
 * Honest by construction: it only knows the games we have seen and the
 * changes we noticed, so `tracked` and `since` travel with the numbers, and
 * an empty history is `{ tracked: 0, delayed: 0, avgDaysLate: null, since: null }`
 * rather than a flattering "never delayed".
 */

import { getDb } from "@/lib/cloudflare/db";
import { reliabilityFromObservations } from "./market-rules";
import type { StudioReliability } from "./types";

/** D1 caps bound parameters per statement at 100. */
const MAX_PARAMS = 100;
const EMPTY: StudioReliability = { tracked: 0, delayed: 0, avgDaysLate: null, since: null };

export async function studioReliability(gameIds: number[]): Promise<StudioReliability> {
  const ids = [...new Set(gameIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 1000);
  if (ids.length === 0) return EMPTY;
  const db = await getDb();
  if (!db) return EMPTY;
  try {
    const rows: Array<{ gameId: number; value: string; observedAt: number }> = [];
    for (let i = 0; i < ids.length; i += MAX_PARAMS) {
      const chunk = ids.slice(i, i + MAX_PARAMS);
      const result = await db
        .prepare(
          `SELECT game_id, value, observed_at FROM release_observations WHERE game_id IN (${chunk.map(() => "?").join(",")})`,
        )
        .bind(...chunk)
        .all<{ game_id: number; value: string; observed_at: number }>();
      for (const row of result.results ?? []) {
        rows.push({ gameId: row.game_id, value: row.value, observedAt: row.observed_at });
      }
    }
    return reliabilityFromObservations(rows);
  } catch (err) {
    console.warn("[reliability] read failed:", err instanceof Error ? err.message : err);
    return EMPTY;
  }
}
