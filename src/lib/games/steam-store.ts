/**
 * Steam storefront prices and store metadata, in the storefront's own currency.
 *
 * Two facts about `appdetails` shape everything here:
 *
 *  - With `filters=price_overview` *alone* it accepts many appids in one
 *    request (any other filter makes a multi-appid call return `null`). One
 *    request per country prices a whole batch of games, which is what keeps
 *    the daily snapshot inside Steam's ~200 requests / 5 min per-IP budget.
 *  - Free games and unpriced regions both answer `data: []`. Only the full
 *    record's `is_free` tells them apart, so that comes from the *same URL the
 *    Steam provider already fetches and caches* for the detail page (`cc=us`,
 *    `l=english`, daily) — a shared data-cache entry, not an extra request.
 *
 * Steam reports every currency ×100 (¥9,020 → 902000); values are converted
 * to true minor units with `steamToMinor` before anything else sees them.
 */

import type { LocalPrice } from "./types";
import { formatMinor, steamToMinor } from "./market-rules";
import { TTL } from "./providers/types";
import type { FetchBudget } from "./fetch-budget";

const STORE = "https://store.steampowered.com/api";
const TIMEOUT_MS = 3500;
/** Comfortably under URL-length limits; 150 appids per call is verified to work. */
export const STEAM_PRICE_BATCH = 100;

export interface SteamPrice {
  currency: string;
  /** Minor units. */
  price: number;
  initial: number;
  discount: number;
  /** Steam's own rendering, e.g. "₹ 3,599" — the price as the store shows it. */
  formatted: string;
}

interface PriceOverview {
  currency?: string;
  initial?: number;
  final?: number;
  discount_percent?: number;
  final_formatted?: string;
}

type PricePayload = Record<string, { success?: boolean; data?: { price_overview?: PriceOverview } | [] }>;

const validAppid = (id: number) => Number.isInteger(id) && id > 0 && id < 1e10;

function parseOverview(overview: PriceOverview | undefined): SteamPrice | null {
  const currency = overview?.currency?.toUpperCase();
  if (!overview || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  if (typeof overview.final !== "number" || overview.final < 0) return null;
  const initial = typeof overview.initial === "number" && overview.initial > 0 ? overview.initial : overview.final;
  return {
    currency,
    price: steamToMinor(overview.final, currency),
    initial: steamToMinor(initial, currency),
    discount: Math.max(0, Math.min(100, Math.round(overview.discount_percent ?? 0))),
    formatted: overview.final_formatted?.trim() || "",
  };
}

/**
 * Current Steam prices for many games in one storefront. Games Steam doesn't
 * sell there, or sells for free, are absent from the map — `steamIsFree`
 * distinguishes the two when it matters. Never throws.
 *
 * `revalidate` is the data-cache window (0 = always fresh, for the crons).
 * One request per `STEAM_PRICE_BATCH` appids, each charged to `budget`.
 */
export async function steamPrices(
  appids: number[],
  cc: string,
  revalidate: number,
  budget?: FetchBudget,
): Promise<Map<number, SteamPrice>> {
  const out = new Map<number, SteamPrice>();
  const ids = [...new Set(appids.filter(validAppid))].sort((a, b) => a - b);
  if (ids.length === 0 || !/^[A-Z]{2}$/.test(cc)) return out;

  for (let i = 0; i < ids.length; i += STEAM_PRICE_BATCH) {
    const part = ids.slice(i, i + STEAM_PRICE_BATCH);
    if (budget && !budget.take()) break;
    try {
      const res = await fetch(
        `${STORE}/appdetails?appids=${part.join(",")}&cc=${cc.toLowerCase()}&filters=price_overview`,
        {
          headers: { Accept: "application/json" },
          ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" as const }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as PricePayload | null;
      for (const id of part) {
        const entry = json?.[String(id)];
        const data = entry?.success && entry.data && !Array.isArray(entry.data) ? entry.data : null;
        const price = parseOverview(data?.price_overview);
        if (price) out.set(id, price);
      }
    } catch {
      // A failed batch only means fewer prices; the rest still count.
    }
  }
  return out;
}

/** One game in one storefront, or null when unpriced/unreachable. */
export async function steamPrice(
  appid: number,
  cc: string,
  revalidate: number,
  budget?: FetchBudget,
): Promise<SteamPrice | null> {
  return (await steamPrices([appid], cc, revalidate, budget)).get(appid) ?? null;
}

interface FullDetails {
  type?: string;
  is_free?: boolean;
  achievements?: {
    total?: number;
    highlighted?: Array<{ name?: string; path?: string; hidden?: number }>;
  };
}

/**
 * The full US `appdetails` record, read through the exact URL and window the
 * Steam provider uses (`enrichWithSteam`), so it is normally a data-cache hit.
 */
export async function steamFullDetails(appid: number): Promise<FullDetails | null> {
  if (!validAppid(appid)) return null;
  try {
    const res = await fetch(`${STORE}/appdetails?appids=${appid}&cc=us&l=english`, {
      headers: { Accept: "application/json" },
      next: { revalidate: TTL.detail },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, { success?: boolean; data?: FullDetails }> | null;
    const entry = json?.[String(appid)];
    return entry?.success && entry.data ? entry.data : null;
  } catch {
    return null;
  }
}

/** True/false when Steam says so; null when it couldn't be asked. */
export async function steamIsFree(appid: number): Promise<boolean | null> {
  const details = await steamFullDetails(appid);
  return typeof details?.is_free === "boolean" ? details.is_free : null;
}

/** A Steam price as the shared `LocalPrice` shape. */
export function steamLocalPrice(appid: number, country: string, price: SteamPrice): LocalPrice {
  return {
    store: "steam",
    country,
    currency: price.currency,
    price: price.price,
    initial: price.initial,
    discount: price.discount,
    formatted: price.formatted || formatMinor(price.price, price.currency, `en-${country}`),
    url: `https://store.steampowered.com/app/${appid}/`,
  };
}
