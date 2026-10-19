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
import { getDb, runAfterResponse } from "@/lib/cloudflare/db";
import { externalIdsFor, igdbSlugForId } from "./providers/igdb-extras";
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
import { trackGameView } from "./tracked";
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
  if (steamRaw && (!DIGITS.test(steamRaw) || Number(steamRaw) <= 0)) return "invalid steam id";
  if (msRaw && !BIG_ID.test(msRaw)) return "invalid ms id";

  const igdbId = Number(id);
  const hint = steamRaw ? Number(steamRaw) : null;
  const resolved = igdbConfigured() ? (await externalIdsFor([igdbId])).get(igdbId) : undefined;

  if (hint && resolved?.steam !== hint) {
    // Steam-only (or IGDB can't vouch for the pairing): key on the appid.
    return { key: -hint, igdbId: null, steam: hint, microsoft: msRaw };
  }
  return {
    key: igdbConfigured() ? igdbId : null,
    igdbId,
    steam: hint ?? resolved?.steam ?? null,
    microsoft: msRaw ?? resolved?.microsoft ?? null,
  };
}

/* ---------------------------------------------------------------------------
 * History (D1)
 * ------------------------------------------------------------------------ */

interface HistoryRow {
  store: LocalPrice["store"];
  currency: string;
  price: number;
  initial: number | null;
  observed_on: string;
}

async function readHistory(key: number, country: string): Promise<HistoryRow[] | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const from = new Date(Date.now() - HISTORY_DAYS * DAY * 1000).toISOString().slice(0, 10);
    const result = await db
      .prepare(
        "SELECT store, currency, price, initial, observed_on FROM price_history " +
          "WHERE game_id = ? AND country = ? AND observed_on >= ? ORDER BY observed_on",
      )
      .bind(key, country, from)
      .all<HistoryRow>();
    return result.results ?? [];
  } catch (err) {
    console.warn("[market] history read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Writes made by this isolate, so cached re-renders don't rewrite the same row. */
const written = new Map<string, number>();

/**
 * One row per game/store/country/day; a later observation the same day
 * replaces the earlier one, so a sale that starts mid-day is still caught.
 * Free and zero prices are skipped — there is no history to keep.
 */
export async function recordPrices(
  observations: Array<{ key: number; price: LocalPrice }>,
  today: string,
): Promise<number> {
  const rows = observations.filter(({ price }) => price.price > 0 && price.currency !== NO_CURRENCY);
  if (rows.length === 0) return 0;
  const db = await getDb();
  if (!db) return 0;
  const statement = db.prepare(
    "INSERT OR REPLACE INTO price_history (game_id, store, country, currency, price, initial, discount, observed_on) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  let stored = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const part = rows.slice(i, i + 50);
    try {
      await db.batch(
        part.map(({ key, price: p }) =>
          statement.bind(key, p.store, p.country, p.currency, p.price, p.initial, p.discount, today),
        ),
      );
      stored += part.length;
    } catch (err) {
      console.warn("[market] record failed:", err instanceof Error ? err.message : err);
    }
  }
  return stored;
}

function recordFromView(ids: MarketIds, prices: LocalPrice[], today: string) {
  const key = ids.key;
  if (key === null) return;
  const fresh = prices.filter((p) => {
    const id = `${key}:${p.store}:${p.country}:${today}:${p.price}`;
    if (Date.now() - (written.get(id) ?? 0) < CURRENT_TTL * 1000) return false;
    written.set(id, Date.now());
    return true;
  });
  if (written.size > 5000) written.clear();
  if (fresh.length > 0) void runAfterResponse(recordPrices(fresh.map((price) => ({ key, price })), today));

  // Keep the game in the daily snapshot. Steam-only titles are tracked by
  // `getGame` itself, which knows their slug.
  if (key > 0) {
    void runAfterResponse(
      igdbSlugForId(key).then((slug) =>
        slug ? trackGameView({ gameId: key, slug, steamApp: ids.steam, microsoft: ids.microsoft }) : undefined,
      ),
    );
  }
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

  recordFromView(ids, paid, today);

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

  const plan = planPriceRequests({
    steamItems: steamIds.length,
    microsoftItems: msIds.length,
    countries: countries.length,
    budget: budget.remaining,
    steamBatch: STEAM_PRICE_BATCH,
    microsoftBatch: MICROSOFT_PRICE_BATCH,
  });
  const steamSlice = rotatingSlice(steamIds, plan.steam * STEAM_PRICE_BATCH, turn);
  const msSlice = rotatingSlice(msIds, plan.microsoft * MICROSOFT_PRICE_BATCH, turn);

  let rows = 0;
  for (const country of countries) {
    const steam = await steamPrices(steamSlice, country, 0, budget);
    const ms = await microsoftPrices(msSlice, country, 0, budget);
    const observations: Array<{ key: number; price: LocalPrice }> = [];
    for (const game of games) {
      const s = game.steamApp ? steam.get(game.steamApp) : undefined;
      if (s && game.steamApp) observations.push({ key: game.gameId, price: steamLocalPrice(game.steamApp, country, s) });
      const m = game.microsoft ? ms.get(game.microsoft) : undefined;
      if (m && game.microsoft) observations.push({ key: game.gameId, price: microsoftLocalPrice(game.microsoft, country, m) });
    }
    rows += await recordPrices(observations, today);
  }
  return { countries, steamGames: steamSlice.length, microsoftGames: msSlice.length, rows, fetches: budget.used };
}
