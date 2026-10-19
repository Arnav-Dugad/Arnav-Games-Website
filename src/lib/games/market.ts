/**
 * Local prices, our own price history, a buy/wait verdict and regional
 * comparison for one game — assembled for `/api/game/[id]/market`.
 *
 * Honesty rules this module keeps:
 *
 *  - Prices are only ever the store's own figure in the store's own currency
 *    for the requested country. A US price is never converted and presented
 *    as an Indian one; FX appears only in `regional[].converted`, which is
 *    explicitly a comparison figure.
 *  - History is what *we* observed (`price_history`), one row per
 *    game/store/country/day, so "lowest" means "lowest we've seen", and the
 *    verdict says so. Stores can price one country in different currencies
 *    (Steam sells in USD in Turkey, Microsoft in TRY), so history, lowest and
 *    verdict only ever compare figures in the market's primary currency.
 *  - A source that fails leaves its price out; nothing is filled in.
 */

import { unstable_cache } from "next/cache";
import { runAfterResponse } from "@/lib/cloudflare/after";
import { commitWrites, fieldPath, getDocument, type Write } from "@/lib/firebase/server";
import { externalIdsFor } from "./providers/igdb-extras";
import { igdbConfigured } from "./providers/igdb";
import { convertMinor, formatMinor, planPriceRequests, priceVerdict, rotatingSlice } from "./market-rules";
import type { FetchBudget } from "./fetch-budget";
import { fxRates } from "./fx";
import {
  STEAM_PRICE_BATCH,
  steamIsFree,
  steamLocalPrice,
  steamPrice,
  steamPrices,
  type SteamPrice,
} from "./steam-store";
import { MICROSOFT_PRICE_BATCH, microsoftLocalPrice, microsoftPrices } from "./ms-store";
import { expiredDays, priceDocPath, priceRows, type PriceRow } from "./stats-docs";
import { countryViewWrite } from "./tracked";
import type { GameMarket, LocalPrice, PricePoint, RegionalPrice } from "./types";

/** Current prices are re-read at most this often (matches the route's s-maxage). */
const CURRENT_TTL = 60 * 30;
const DAY = 60 * 60 * 24;
/** History older than this isn't returned (the verdict looks back 120 days). */
const HISTORY_DAYS = 365;
/** ISO 4217's code for "no currency" — used for a free game's price. */
const NO_CURRENCY = "XXX";

/**
 * Steam storefronts for the regional comparison. DE stands in for the euro
 * area; TR and AR are priced in USD by Steam since 2023, which is exactly the
 * kind of thing the comparison is for.
 */
export const REGIONAL_STOREFRONTS = ["US", "GB", "DE", "IN", "TR", "BR", "AR", "JP", "KR", "CA", "AU", "PL", "ZA"] as const;

/* ---------------------------------------------------------------------------
 * Identity
 * ------------------------------------------------------------------------ */

export interface MarketIds {
  /**
   * The key our history is stored under: the IGDB id when IGDB confirms the
   * Steam app (or there is no Steam hint), the negated appid for a Steam-only
   * title — see `tracked.ts`. Null when there is nothing to key on.
   */
  key: number | null;
  igdbId: number | null;
  steam: number | null;
  microsoft: string | null;
  /** Twitch category: the `twitch` hint, else IGDB's link (null when neither). */
  twitch: string | null;
}

const DIGITS = /^\d{1,10}$/;
const BIG_ID = /^[0-9A-Z]{12}$/;

/**
 * `[id]` + optional `?steam=` / `?ms=` hints → store ids, using the same
 * convention as `/api/game/[id]/live`: `[id]` is the IGDB id, and a Steam-only
 * title is addressed by its appid with a matching `steam` hint. A hint that
 * IGDB doesn't confirm marks the request as Steam-only. Returns an error
 * string for malformed input.
 */
export async function resolveMarketIds(id: string, search: URLSearchParams): Promise<MarketIds | string> {
  if (!DIGITS.test(id) || Number(id) <= 0) return "id must be a numeric IGDB id";
  const steamRaw = search.get("steam")?.trim() || null;
  const msRaw = search.get("ms")?.trim().toUpperCase() || null;
  const twitchRaw = search.get("twitch")?.trim() || null;
  if (twitchRaw && !/^\d{1,12}$/.test(twitchRaw)) return "invalid twitch id";
  if (steamRaw && (!DIGITS.test(steamRaw) || Number(steamRaw) <= 0)) return "invalid steam id";
  if (msRaw && !BIG_ID.test(msRaw)) return "invalid ms id";

  const igdbId = Number(id);
  const hint = steamRaw ? Number(steamRaw) : null;
  const resolved = igdbConfigured() ? (await externalIdsFor([igdbId])).get(igdbId) : undefined;

  if (hint && resolved?.steam !== hint) {
    // Steam-only (or IGDB can't vouch for the pairing): key on the appid.
    return { key: -hint, igdbId: null, steam: hint, microsoft: msRaw, twitch: twitchRaw };
  }
  return {
    key: igdbConfigured() ? igdbId : null,
    igdbId,
    steam: hint ?? resolved?.steam ?? null,
    microsoft: msRaw ?? resolved?.microsoft ?? null,
    twitch: twitchRaw ?? resolved?.twitch ?? null,
  };
}

/* ---------------------------------------------------------------------------
 * History (Firestore: `priceHistory/{key}`, see stats-docs.ts)
 * ------------------------------------------------------------------------ */

/**
 * One country's observations: one document read, field-masked to that
 * country. Cached for 30 minutes in Next's data cache (R2 on Workers — a
 * binding call, not a subrequest), since the history only grows once a day
 * and every game page view asks: without it each view would cost a Firestore
 * read and an outbound request. Throws on a failed read so a failure is
 * never cached.
 */
const cachedHistory = unstable_cache(
  async (key: number, country: string): Promise<PriceRow[]> => {
    const doc = await getDocument(priceDocPath(key), { mask: [fieldPath(country)] });
    if (doc === undefined) throw new Error("price history unavailable");
    return priceRows(doc?.data ?? {}, country);
  },
  ["price-history-v2"],
  { revalidate: CURRENT_TTL, tags: ["price-history"] },
);

/** Null when Firestore couldn't be read — the market then claims nothing about history. */
async function readHistory(key: number, country: string): Promise<PriceRow[] | null> {
  try {
    const from = new Date(Date.now() - HISTORY_DAYS * DAY * 1000).toISOString().slice(0, 10);
    return (await cachedHistory(key, country)).filter((row) => row.observed_on >= from);
  } catch (err) {
    console.warn("[market] history read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * The writes for a set of observations: one document per game key, one
 * field per country/day/store, so a later observation the same day replaces
 * the earlier one (a sale that starts mid-day is still caught). Free and zero
 * prices are skipped — there is no history to keep. `prune` adds deletes for
 * the week of days that just passed the retention window (the daily cron
 * passes it; page views don't bother).
 */
export function priceWrites(
  observations: Array<{ key: number; price: LocalPrice }>,
  today: string,
  prune = false,
): Write[] {
  const byKey = new Map<number, LocalPrice[]>();
  for (const { key, price } of observations) {
    if (price.price <= 0 || price.currency === NO_CURRENCY || !Number.isInteger(key) || key === 0) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), price]);
  }
  const expired = prune ? expiredDays(today, HISTORY_DAYS) : [];
  return [...byKey].map(([key, prices]) => {
    const data: Record<string, Record<string, Record<string, unknown>>> = {};
    const mask = new Set<string>();
    for (const p of prices) {
      data[p.country] ??= {};
      data[p.country][today] ??= {};
      data[p.country][today][p.store] = [p.currency, p.price, p.initial, p.discount];
      mask.add(fieldPath(p.country, today, p.store));
      for (const day of expired) mask.add(fieldPath(p.country, day));
    }
    return { type: "update", path: priceDocPath(key), data, mask: [...mask] } satisfies Write;
  });
}

/** Writes made by this isolate, so re-renders don't rewrite the same value. */
const written = new Map<string, number>();

/**
 * Records today's prices from a page view, but only where the stored value
 * for today is missing or different — the (≤ 30-minute-old) history this
 * request already read says which — so steady prices cost no writes at all.
 */
function recordFromView(ids: MarketIds, prices: LocalPrice[], today: string, stored: PriceRow[] | null) {
  const key = ids.key;
  if (key === null || stored === null) return;
  const fresh = prices.filter((p) => {
    const same = stored.some(
      (row) => row.observed_on === today && row.store === p.store && row.currency === p.currency && row.price === p.price,
    );
    if (same) return false;
    const id = `${key}:${p.store}:${p.country}:${today}:${p.price}`;
    if (Date.now() - (written.get(id) ?? 0) < CURRENT_TTL * 1000) return false;
    written.set(id, Date.now());
    return true;
  });
  if (written.size > 5000) written.clear();
  const writes = priceWrites(fresh.map((price) => ({ key, price })), today);
  const country = countryViewWrite(prices[0]?.country ?? "");
  if (country) writes.push(country);
  if (writes.length > 0) void runAfterResponse(commitWrites(writes));
}

/* ---------------------------------------------------------------------------
 * Regional
 * ------------------------------------------------------------------------ */

type RegionalRaw = Array<{ country: string; price: SteamPrice }>;

/**
 * Steam prices in every comparison storefront, cached 24 h per app. That is
 * 13 requests per game per day at most, four at a time. A run where most
 * storefronts failed (rate limiting) throws, so it isn't pinned for a day.
 */
const cachedRegional = unstable_cache(
  async (appid: number): Promise<RegionalRaw> => {
    const out: RegionalRaw = [];
    let failures = 0;
    const queue = [...REGIONAL_STOREFRONTS];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let cc = queue.shift(); cc; cc = queue.shift()) {
          const price = await steamPrice(appid, cc, 0);
          if (price) out.push({ country: cc, price });
          else failures++;
        }
      }),
    );
    if (out.length === 0 && failures > 0) throw new Error("regional: no storefront answered");
    return out.sort((a, b) => REGIONAL_STOREFRONTS.indexOf(a.country as never) - REGIONAL_STOREFRONTS.indexOf(b.country as never));
  },
  ["steam-regional-v1"],
  { revalidate: DAY, tags: ["steam-regional"] },
);

async function regionalFor(
  appid: number,
  viewer: { country: string; price: SteamPrice | null; currency: string | null },
): Promise<RegionalPrice[]> {
  let raw: RegionalRaw;
  try {
    raw = await cachedRegional(appid);
  } catch {
    return [];
  }
  const rows = raw.filter((row) => row.country !== viewer.country);
  if (viewer.price) rows.unshift({ country: viewer.country, price: viewer.price });
  if (rows.length === 0) return [];

  const target = viewer.currency;
  const rates = target ? await fxRates(target) : null;
  return rows
    .map(({ country, price }): RegionalPrice => {
      const rate = rates?.[price.currency];
      return {
        country,
        currency: price.currency,
        price: price.price,
        formatted: price.formatted || formatMinor(price.price, price.currency, `en-${country}`),
        converted:
          target && price.currency === target
            ? price.price
            : target && rate
              ? convertMinor(price.price, price.currency, target, rate)
              : null,
        discount: price.discount,
      };
    })
    .sort((a, b) => (a.converted ?? Infinity) - (b.converted ?? Infinity));
}

/* ---------------------------------------------------------------------------
 * Assembly
 * ------------------------------------------------------------------------ */

export async function marketFor(
  ids: MarketIds,
  country: string,
  options: { regional: boolean },
): Promise<GameMarket> {
  const today = new Date().toISOString().slice(0, 10);

  const [steam, microsoft, historyRows] = await Promise.all([
    ids.steam ? steamPrice(ids.steam, country, CURRENT_TTL) : null,
    ids.microsoft ? microsoftPrices([ids.microsoft], country, CURRENT_TTL) : null,
    ids.key !== null ? readHistory(ids.key, country) : null,
  ]);
  const msPrice = ids.microsoft ? microsoft?.get(ids.microsoft) ?? null : null;
  // Only an unpriced Steam game needs the free check (a shared cache hit).
  const steamFree = ids.steam && !steam ? await steamIsFree(ids.steam) : null;

  const prices: LocalPrice[] = [];
  if (steam && ids.steam) prices.push(steamLocalPrice(ids.steam, country, steam));
  if (msPrice && ids.microsoft) prices.push(microsoftLocalPrice(ids.microsoft, country, msPrice));

  const paid = prices.filter((p) => p.price > 0);
  const currency = paid[0]?.currency ?? prices[0]?.currency ?? null;

  if (steamFree && ids.steam) {
    prices.push({
      store: "steam",
      country,
      currency: currency ?? NO_CURRENCY,
      price: 0,
      initial: 0,
      discount: 0,
      formatted: "Free",
      url: `https://store.steampowered.com/app/${ids.steam}/`,
    });
  }

  // Our observations plus today's, in the market's currency only.
  const history: PricePoint[] = (historyRows ?? [])
    .filter((row) => row.currency === currency && row.observed_on !== today)
    .map((row) => ({ date: row.observed_on, store: row.store, price: row.price, initial: row.initial }));
  if (historyRows) {
    for (const p of paid.filter((p) => p.currency === currency)) {
      history.push({ date: today, store: p.store, price: p.price, initial: p.initial });
    }
  }
  history.sort((a, b) => a.date.localeCompare(b.date) || a.store.localeCompare(b.store));

  const lowest = history.reduce<GameMarket["lowest"]>(
    (low, point) => (!low || point.price < low.price ? { price: point.price, date: point.date, store: point.store } : low),
    null,
  );

  const inCurrency = paid.filter((p) => p.currency === currency).sort((a, b) => a.price - b.price);
  const current = inCurrency[0] ?? (prices.some((p) => p.price === 0) ? prices.find((p) => p.price === 0)! : null);
  const verdict = priceVerdict({ current, history, today });

  const earliest = historyRows?.[0]?.observed_on ?? null;
  const trackingSince = earliest ?? (historyRows && paid.length > 0 && ids.key !== null ? today : null);

  const regional =
    options.regional && ids.steam
      ? await regionalFor(ids.steam, { country, price: steam, currency })
      : [];

  recordFromView(ids, paid, today, historyRows);

  return { country, currency, prices, history, lowest, verdict, regional, trackingSince };
}

/* ---------------------------------------------------------------------------
 * Daily snapshot (cron)
 * ------------------------------------------------------------------------ */

/**
 * Records today's price for a slice of the tracked games in each country,
 * within `budget` outbound requests (Workers Free allows 50 per invocation).
 *
 * `planPriceRequests` splits the budget into Steam batches (100 games per
 * request) and Microsoft batches (20 per request) per country. When there are
 * more games than one run can price, the slice rotates by day, so coverage
 * builds over successive days; every country prices the *same* slice, so a
 * game's histories stay aligned across countries.
 */
export async function snapshotPrices(
  games: Array<{ gameId: number; steamApp: number | null; microsoft: string | null }>,
  countries: string[],
  budget: FetchBudget,
): Promise<{ countries: string[]; steamGames: number; microsoftGames: number; rows: number; fetches: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const turn = Math.floor(Date.now() / (DAY * 1000));
  const steamIds = [...new Set(games.map((g) => g.steamApp).filter((id): id is number => Boolean(id)))];
  const msIds = [...new Set(games.map((g) => g.microsoft).filter((id): id is string => Boolean(id)))];

  // One request is held back for the single Firestore commit at the end.
  const plan = planPriceRequests({
    steamItems: steamIds.length,
    microsoftItems: msIds.length,
    countries: countries.length,
    budget: Math.max(0, budget.remaining - 1),
    steamBatch: STEAM_PRICE_BATCH,
    microsoftBatch: MICROSOFT_PRICE_BATCH,
  });
  const steamSlice = rotatingSlice(steamIds, plan.steam * STEAM_PRICE_BATCH, turn);
  const msSlice = rotatingSlice(msIds, plan.microsoft * MICROSOFT_PRICE_BATCH, turn);

  const observations: Array<{ key: number; price: LocalPrice }> = [];
  for (const country of countries) {
    const steam = await steamPrices(steamSlice, country, 0, budget);
    const ms = await microsoftPrices(msSlice, country, 0, budget);
    for (const game of games) {
      const s = game.steamApp ? steam.get(game.steamApp) : undefined;
      if (s && game.steamApp) observations.push({ key: game.gameId, price: steamLocalPrice(game.steamApp, country, s) });
      const m = game.microsoft ? ms.get(game.microsoft) : undefined;
      if (m && game.microsoft) observations.push({ key: game.gameId, price: microsoftLocalPrice(game.microsoft, country, m) });
    }
  }
  // Every country's prices for a game land in that game's one document, so
  // the whole snapshot is one write per game and a single request.
  const writes = priceWrites(observations, today, true);
  const stored = writes.length > 0 && budget.take() ? await commitWrites(writes) : 0;
  const rows = stored > 0 ? observations.filter((o) => o.price.price > 0 && o.price.currency !== NO_CURRENCY).length : 0;
  return { countries, steamGames: steamSlice.length, microsoftGames: msSlice.length, rows, fetches: budget.used };
}
