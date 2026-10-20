import { NextResponse } from "next/server";
import { fxRates } from "@/lib/games/fx";

/**
 * ECB reference rates for one base currency, for the stats page's spending
 * totals (purchases recorded in several currencies, reported in the
 * reader's own):
 *
 *   GET /api/fx?base=INR   → { base: "INR", rates: { USD: 0.0105, … } | null }
 *
 * `rates[X]` is how many X one unit of `base` buys. Public, identical for
 * everyone, and cached for 12 hours by `fxRates` — one outbound request (two
 * if the primary host fails) per base per half day.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const base = new URL(request.url).searchParams.get("base")?.toUpperCase() ?? "";
  if (!/^[A-Z]{3}$/.test(base)) {
    return NextResponse.json({ error: "base must be an ISO 4217 code" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const rates = await fxRates(base);
  return NextResponse.json(
    { base, rates },
    { headers: { "Cache-Control": rates ? "public, max-age=3600, s-maxage=43200" : "no-store" } },
  );
}
