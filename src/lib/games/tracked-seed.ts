/**
 * Bootstraps the tracked set from the site's own shelves while it is small,
 * so the crons have something worth sampling before many pages have been
 * viewed. Separate from `tracked.ts` because it reads the shelves through
 * `source.ts`, which itself imports `tracked.ts`.
 */

import { getSteamCharts, getTopRated, getTrending, getUpcoming } from "./source";
import { seedTrackedGames, type TrackedIndex } from "./tracked";
import type { GameSummary } from "./types";

/** Below this many tracked games, the shelves top the set up. */
export const SEED_BELOW = 100;

/**
 * `attempted` is true whenever the shelves were read — that costs IGDB
 * requests (up to ~15 on a cold cache), so a cron run that seeds does no other
 * outbound work. `offered` is how many games were upserted. Takes the index
 * the caller already read, so seeding costs no extra Firestore read.
 */
export async function seedTrackedIfSmall(index: TrackedIndex | null): Promise<{ attempted: boolean; offered: number }> {
  if (index === null || index.games.length >= SEED_BELOW) return { attempted: false, offered: 0 };

  const [trending, topRated, charts, upcoming] = await Promise.all([
    getTrending(40),
    getTopRated(40),
    getSteamCharts(15),
    getUpcoming(40, 1, { notableOnly: true, ordering: "-hypes" }),
  ]);
  // IGDB ids only — a Steam-fallback shelf carries appids, which would be
  // filed under the wrong key.
  const games: GameSummary[] = [
    ...(charts.source === "igdb" ? charts.data.flatMap((chart) => chart.games) : []),
    ...(trending.source === "igdb" ? trending.data : []),
    ...(topRated.source === "igdb" ? topRated.data : []),
    ...(upcoming.source === "igdb" ? upcoming.data.results : []),
  ];
  return { attempted: true, offered: await seedTrackedGames(games, index) };
}
