/**
 * How reliably a studio ships on its announced dates, from our own delay
 * tracker (`release-history.ts`). Pass the IGDB ids of the studio's games;
 * the rules live in `reliabilityFromObservations` (pure, self-checked).
 *
 * Honest by construction: it only knows the games we have seen and the
 * changes we noticed, so `tracked` and `since` travel with the numbers, and
 * an empty history is `{ tracked: 0, delayed: 0, avgDaysLate: null, since: null }`
 * rather than a flattering "never delayed".
 *
 * Cost: ≤ 4 Firestore document reads in one request (the release shards,
 * field-masked to these ids). Studio pages are ISR'd for a day, so this runs
 * about once per studio per day.
 */

import { reliabilityFromObservations } from "./market-rules";
import { readReleaseObservations } from "./release-history";
import type { StudioReliability } from "./types";

const EMPTY: StudioReliability = { tracked: 0, delayed: 0, avgDaysLate: null, since: null };

export async function studioReliability(gameIds: number[]): Promise<StudioReliability> {
  const ids = [...new Set(gameIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 1000);
  if (ids.length === 0) return EMPTY;
  const observations = await readReleaseObservations(ids);
  if (!observations) return EMPTY;
  const rows: Array<{ gameId: number; value: string; observedAt: number }> = [];
  for (const [gameId, list] of observations) {
    for (const row of list) rows.push({ gameId, value: row.value, observedAt: row.observedAt });
  }
  return reliabilityFromObservations(rows);
}
