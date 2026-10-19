import { NextResponse } from "next/server";
import { marketFor, resolveMarketIds } from "@/lib/games/market";

/**
 * Local prices, our price history and a buy/wait verdict for one game in one
 * country, as `GameMarket`:
 *
 *   GET /api/game/119133/market?cc=IN
 *   GET /api/game/119133/market?cc=IN&regional=1
 *   GET /api/game/367520/market?cc=GB&steam=367520     (Steam-only title)
 *
 * `[id]` is the IGDB id; `steam` / `ms` are optional id hints, as on
 * `/live`. `cc` is an ISO 3166-1 alpha-2 country (default US).
 *
 * `regional` is opt-in: it costs up to 13 Steam storefront lookups per game
 * (cached 24 h), so the default response leaves it as `[]` and a UI asks for
 * `?regional=1` only when the comparison is actually opened. With it, rows
 * are sorted cheapest-first by `converted`, rows without FX last.
 *
 * Outbound requests per call (Workers Free allows 50): measured 16–19 with
 * every cache cold including `regional=1`, 3 warm; worst case with IGDB
 * retries is under 30.
 */

const COUNTRY = /^[A-Z]{2}$/;

const badRequest = (error: string) =>
  NextResponse.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;

  const cc = (search.get("cc")?.trim() || "US").toUpperCase();
  if (!COUNTRY.test(cc) || cc === "XX" || cc === "T1") return badRequest("cc must be an ISO 3166-1 alpha-2 country");

  const ids = await resolveMarketIds(id, search);
  if (typeof ids === "string") return badRequest(ids);

  try {
    const market = await marketFor(ids, cc, { regional: search.get("regional") === "1" });
    return NextResponse.json(market, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error("[api/market] failed", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
