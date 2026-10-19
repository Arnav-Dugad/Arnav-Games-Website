/**
 * One current price per game for a whole grid of cards (`POST /api/prices`),
 * in one country's own currency.
 *
 * Built from the batched store calls the daily snapshot already uses: Steam
 * prices 100 apps per request (`filters=price_overview`), and only games
 * Steam doesn't price fall through to the Microsoft catalogue (20 per
 * request, ~1 MB each — so capped at 40 games to stay inside the Worker's
 * CPU allowance). A handful of unpriced Steam apps are checked for
 * free-to-play through the shared, day-cached store record.
 *
 * Ids follow the app convention: IGDB ids are positive; a Steam-only title
 * is its negated appid. Every requested id is present in the result, null
 * when no store price is known in that country — never a converted or
 * guessed figure.
 */

import { unstable_cache } from "next/cache";
import { FetchBudget } from "./fetch-budget";
import { externalIdsFor } from "./providers/igdb-extras";
import { microsoftLocalPrice, microsoftPrices } from "./ms-store";
import { steamIsFree, steamLocalPrice, steamPrices } from "./steam-store";
import type { BatchPrices, LocalPrice } from "./types";

export const BATCH_PRICE_MAX = 100;
const TTL = 60 * 30;
/** Requests one batch may spend (Workers Free allows 50 per invocation). */
const BUDGET = 40;
const MICROSOFT_MAX = 40;
const FREE_CHECKS = 6;
const NO_CURRENCY = "XXX";

async function compute(ids: number[], cc: string): Promise<BatchPrices> {
  const budget = new FetchBudget(BUDGET);
  const igdb = ids.filter((id) => id > 0);
  // IGDB external ids: one query per 90 games, plus the (cached) token.
  const external = igdb.length > 0 && budget.take(Math.ceil(igdb.length / 90) + 1) ? await externalIdsFor(igdb) : new Map();

  const steamOf = new Map<number, number>();
  const msOf = new Map<number, string>();
  for (const id of ids) {
    if (id < 0) steamOf.set(id, -id);
    const ext = id > 0 ? external.get(id) : undefined;
    if (ext?.steam) steamOf.set(id, ext.steam);
    if (ext?.microsoft) msOf.set(id, ext.microsoft);
  }

  const steam = await steamPrices([...steamOf.values()], cc, TTL, budget);
  const out: BatchPrices = {};
  const missing: number[] = [];
  for (const id of ids) {
    const appid = steamOf.get(id);
    const price = appid ? steam.get(appid) : undefined;
    if (price && appid) out[String(id)] = steamLocalPrice(appid, cc, price);
    else missing.push(id);
  }

  const msIds = missing.filter((id) => msOf.has(id)).slice(0, MICROSOFT_MAX);
  const ms = msIds.length > 0 ? await microsoftPrices(msIds.map((id) => msOf.get(id)!), cc, TTL, budget) : new Map();
  for (const id of msIds) {
    const bigId = msOf.get(id)!;
    const price = ms.get(bigId);
    if (price) out[String(id)] = microsoftLocalPrice(bigId, cc, price);
  }

  // Free-to-play and unpriced look the same in the batch call; ask the store record.
  const currency = Object.values(out).find((p): p is LocalPrice => Boolean(p && p.price > 0))?.currency ?? NO_CURRENCY;
  const unpriced = ids.filter((id) => !out[String(id)] && steamOf.has(id)).slice(0, FREE_CHECKS);
  const free = await Promise.all(unpriced.map((id) => (budget.take() ? steamIsFree(steamOf.get(id)!) : null)));
  unpriced.forEach((id, i) => {
    if (free[i] !== true) return;
    const appid = steamOf.get(id)!;
    out[String(id)] = {
      store: "steam",
      country: cc,
      currency,
      price: 0,
      initial: 0,
      discount: 0,
      formatted: "Free",
      url: `https://store.steampowered.com/app/${appid}/`,
    };
  });

  for (const id of ids) out[String(id)] ??= null;
  // A batch that priced nothing at all is more likely an outage than a page
  // of unreleased games; throwing keeps it out of the cache.
  if (steamOf.size + msOf.size > 0 && Object.values(out).every((p) => p === null)) {
    throw new Error("batch prices: no store answered");
  }
  return out;
}

const cached = unstable_cache(
  async (key: string, cc: string) => compute(key.split(",").map(Number), cc),
  ["batch-prices-v1"],
  { revalidate: TTL, tags: ["batch-prices"] },
);

/** Validated ids (non-zero integers, deduped, ≤ 100) → one price each. */
export async function batchPrices(ids: number[], cc: string): Promise<BatchPrices> {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id !== 0 && Math.abs(id) < 1e10).slice(0, BATCH_PRICE_MAX);
  if (unique.length === 0) return {};
  try {
    return await cached([...unique].sort((a, b) => a - b).join(","), cc);
  } catch {
    return Object.fromEntries(unique.map((id) => [String(id), null]));
  }
}
