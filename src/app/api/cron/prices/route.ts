import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron-auth";
import { getDb } from "@/lib/cloudflare/db";
import { normaliseCountry } from "@/lib/games/market-rules";
import { snapshotPrices } from "@/lib/games/market";
import { trackedGames } from "@/lib/games/tracked";
import { FetchBudget } from "@/lib/games/fetch-budget";

/**
 * Daily local-price snapshot (cron "20 4 * * *" in worker.mjs).
 *
 * Records Steam and Microsoft Store prices for the most recently seen tracked
 * games, in the countries our visitors actually come from (top 6 by pageviews
 * over 30 days, US always included).
 *
 * Hard ceiling of 45 outbound requests per run (Workers Free allows 50; D1 is
 * a binding and doesn't count). Steam prices 100 games per request and
 * Microsoft 20, per country; when the tracked set needs more than that, a
 * rotating slice is priced each day (see `snapshotPrices`). No seeding here —
 * the players cron owns that, and it would spend this run's budget on IGDB.
 *
 *   curl -X POST http://localhost:4000/api/cron/prices           (next dev)
 */

/** The rotation pool; each run prices the slice that fits the budget. */
const MAX_GAMES = 300;
const FETCH_BUDGET = 45;
const MAX_COUNTRIES = 6;

async function visitorCountries(): Promise<string[]> {
  const countries: string[] = [];
  const db = await getDb();
  if (db) {
    try {
      const since = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      const result = await db
        .prepare(
          "SELECT country, COUNT(*) AS n FROM analytics_events WHERE ts >= ? AND type = 'pageview' AND country IS NOT NULL " +
            "GROUP BY country ORDER BY n DESC LIMIT 12",
        )
        .bind(since)
        .all<{ country: string }>();
      for (const row of result.results ?? []) {
        const code = normaliseCountry(row.country);
        if (code && !countries.includes(code)) countries.push(code);
      }
    } catch (err) {
      console.warn("[cron/prices] countries failed:", err instanceof Error ? err.message : err);
    }
  }
  const top = countries.filter((code) => code !== "US").slice(0, MAX_COUNTRIES - 1);
  return ["US", ...top];
}

export async function POST(request: Request) {
  if (!(await isAuthorizedCron(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const [countries, games] = await Promise.all([visitorCountries(), trackedGames(MAX_GAMES, "any")]);
  const result = await snapshotPrices(games, countries, new FetchBudget(FETCH_BUDGET));
  return NextResponse.json(
    { job: "prices", tracked: games.length, ...result, budget: FETCH_BUDGET, ms: Date.now() - started },
    { headers: { "Cache-Control": "no-store" } },
  );
}
