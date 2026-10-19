import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron-auth";
import { normaliseCountry } from "@/lib/games/market-rules";
import { snapshotPrices } from "@/lib/games/market";
import { readTrackedIndex, trackedWithStores, type TrackedIndex } from "@/lib/games/tracked";
import { FetchBudget } from "@/lib/games/fetch-budget";

/**
 * Daily local-price snapshot (04:20 UTC slot of the 10-minute cron in
 * worker.mjs).
 *
 * Records Steam and Microsoft Store prices for the most recently seen tracked
 * games, in the countries our visitors actually price games in (the top 5 by
 * market views, counted in the tracked index; US always included).
 *
 * Hard ceiling of 45 outbound requests per run (Workers Free allows 50): the
 * tracked-index read, Steam batches (100 games per request) and Microsoft
 * batches (20) per country, and one Firestore commit holding every price
 * (one document per game). When the tracked set needs more than that, a
 * rotating slice is priced each day (see `snapshotPrices`). No seeding here —
 * the players cron owns that, and it would spend this run's budget on IGDB.
 *
 *   curl -X POST http://localhost:4000/api/cron/prices           (next dev)
 */

/** The rotation pool; each run prices the slice that fits the budget. */
const MAX_GAMES = 300;
const FETCH_BUDGET = 45;
const MAX_COUNTRIES = 6;

function visitorCountries(index: TrackedIndex): string[] {
  const ranked = [...index.countries]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code]) => normaliseCountry(code))
    .filter((code): code is string => Boolean(code) && code !== "US");
  return ["US", ...new Set(ranked)].slice(0, MAX_COUNTRIES);
}

export async function POST(request: Request) {
  if (!(await isAuthorizedCron(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const budget = new FetchBudget(FETCH_BUDGET);
  const index = await readTrackedIndex(["steam", "ms", "seen", "cc"], budget);
  if (!index) {
    return NextResponse.json(
      { job: "prices", error: "tracked index unavailable", fetches: budget.used, ms: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const games = trackedWithStores(index, MAX_GAMES, "any");
  const result = await snapshotPrices(games, visitorCountries(index), budget);
  return NextResponse.json(
    { job: "prices", tracked: games.length, ...result, budget: FETCH_BUDGET, ms: Date.now() - started },
    { headers: { "Cache-Control": "no-store" } },
  );
}
