import { NextResponse } from "next/server";
import { BATCH_PRICE_MAX, batchPrices } from "@/lib/games/batch-prices";
import { normaliseCountry } from "@/lib/games/market-rules";

/**
 * Current prices for a grid of games in one country, as `BatchPrices`:
 *
 *   POST /api/prices   { "ids": [119133, 7346, -367520], "cc": "IN" }
 *
 * `ids` are IGDB ids, or a negated Steam appid for a Steam-only title — at
 * most 100. `cc` is ISO 3166-1 alpha-2; omitted, the visitor's Cloudflare
 * country is used, then US. Every id comes back as a key: a `LocalPrice` in
 * that country's currency, or null when no store prices it there.
 *
 * Outbound requests per call (cold): IGDB ids ≤ 3, Steam 1, Microsoft ≤ 2
 * (only for games Steam doesn't price), free-to-play checks ≤ 6 — ≤ 12.
 * Results are cached 30 minutes per id set and country.
 */

const bad = (error: string) => NextResponse.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("body must be JSON");
  }
  const { ids, cc } = (body ?? {}) as { ids?: unknown; cc?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return bad("ids must be a non-empty array");
  if (ids.length > BATCH_PRICE_MAX) return bad(`at most ${BATCH_PRICE_MAX} ids`);
  if (!ids.every((id) => typeof id === "number" && Number.isInteger(id) && id !== 0)) {
    return bad("ids must be non-zero integers");
  }
  const country =
    (typeof cc === "string" ? normaliseCountry(cc) : null) ??
    (cc === undefined || cc === null ? normaliseCountry(request.headers.get("cf-ipcountry")) ?? "US" : null);
  if (!country) return bad("cc must be an ISO 3166-1 alpha-2 country");

  const prices = await batchPrices(ids as number[], country);
  return NextResponse.json(prices, { headers: { "Cache-Control": "private, max-age=600" } });
}
