"use client";

/**
 * The extra data the deeper personal analytics need beyond the library
 * snapshot, each fetched the way that costs the least:
 *
 *  - `useGameFacets`: IGDB themes and perspectives per game (taste map),
 *    through `/api/library/metadata` in chunks of 100, kept on the device for
 *    30 days — catalogue data, identical for everyone and slow to change.
 *  - `useFxRates`: ECB rates for the reader's currency (`/api/fx`), on the
 *    device for 12 hours.
 *  - `useLibraryPricing`: today's best store price for owned games
 *    (`POST /api/prices`, the batch the wishlist budget uses) and our own
 *    price history for the most valuable of them, read straight from the
 *    public Firestore documents (no Worker request), both on the device for
 *    a day. History is capped at `HISTORY_GAMES` documents per visit so a
 *    big library can't burn the free read quota.
 */

import { useEffect, useMemo, useState } from "react";
import type { WatchlistEntry } from "@/lib/firebase/db";
import { readStatsDoc } from "@/lib/firebase/stats";
import { priceRows, STATS_COLLECTIONS } from "@/lib/games/stats-docs";
import type { BatchPrices } from "@/lib/games/types";
import type { GameFacets } from "@/lib/personal/taste-map";
import type { PriceSample, Rates } from "@/lib/personal/spend";
import { readLocalCache, writeLocalCache } from "@/lib/utils/local-cache";

const DAY_MS = 86_400_000;

/** IGDB ids only: Steam-only records (`-s<appid>` slugs) have no IGDB facets or prices by id. */
const igdbIds = (entries: WatchlistEntry[]) =>
  [...new Set(entries.filter((entry) => entry.gameId > 0 && !/-s\d+$/.test(entry.slug)).map((entry) => entry.gameId))].sort((a, b) => a - b);

/* ---------------------------------------------------------------------------
 * Facets
 * ------------------------------------------------------------------------ */

type FacetWire = { t: Array<[number, string]>; p: Array<[number, string]> };
const facetCache = new Map<number, GameFacets | null>();
let facetsHydrated = false;
const FACET_TTL = 30 * DAY_MS;

function hydrateFacets() {
  if (facetsHydrated || typeof window === "undefined") return;
  facetsHydrated = true;
  const stored = readLocalCache<Array<[number, FacetWire | null]>>("game-facets", FACET_TTL);
  for (const [id, wire] of stored ?? []) if (!facetCache.has(id)) facetCache.set(id, wire ? fromWire(wire) : null);
}

const fromWire = (wire: FacetWire): GameFacets => ({
  themes: wire.t.map(([id, name]) => ({ id, name })),
  perspectives: wire.p.map(([id, name]) => ({ id, name })),
});
const toWire = (facets: GameFacets): FacetWire => ({
  t: facets.themes.map(({ id, name }) => [id, name]),
  p: facets.perspectives.map(({ id, name }) => [id, name]),
});

async function loadFacets(ids: number[]): Promise<void> {
  hydrateFacets();
  const missing = ids.filter((id) => !facetCache.has(id));
  if (missing.length === 0) return;
  const chunks: number[][] = [];
  for (let offset = 0; offset < missing.length; offset += 100) chunks.push(missing.slice(offset, offset + 100));
  let any = false;
  // Sequential on purpose: a 600-game library is six small requests, not six at once.
  for (const chunk of chunks) {
    const response = await fetch("/api/library/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: chunk, include: ["facets"] }),
    }).catch(() => null);
    if (!response?.ok) continue;
    const payload = (await response.json()) as { facets?: Record<string, FacetWire> };
    if (!payload.facets) continue;
    any = true;
    for (const id of chunk) {
      const wire = payload.facets[String(id)];
      facetCache.set(id, wire ? fromWire(wire) : null);
    }
  }
  if (any) {
    writeLocalCache(
      "game-facets",
      [...facetCache].slice(-3000).map(([id, facets]) => [id, facets ? toWire(facets) : null]),
    );
  }
}

/** Themes/perspectives by game id; `ready` once the lookup settled (even if it failed). */
export function useGameFacets(entries: WatchlistEntry[], preview?: Record<number, GameFacets>): { ready: boolean; facets: Record<number, GameFacets> } {
  const ids = useMemo(() => igdbIds(entries), [entries]);
  const key = ids.join(",");
  const [state, setState] = useState<{ key: string; facets: Record<number, GameFacets> } | null>(null);
  useEffect(() => {
    if (preview || !key) return;
    let active = true;
    const wanted = key.split(",").map(Number);
    loadFacets(wanted)
      .catch(() => undefined)
      .then(() => {
        if (!active) return;
        const facets: Record<number, GameFacets> = {};
        for (const id of wanted) {
          const value = facetCache.get(id);
          if (value) facets[id] = value;
        }
        setState({ key, facets });
      });
    return () => {
      active = false;
    };
  }, [key, preview]);
  if (preview) return { ready: true, facets: preview };
  if (!key) return { ready: true, facets: {} };
  return state?.key === key ? { ready: true, facets: state.facets } : { ready: false, facets: state?.facets ?? {} };
}

/* ---------------------------------------------------------------------------
 * Exchange rates
 * ------------------------------------------------------------------------ */

const FX_TTL = 12 * 60 * 60_000;

/** `undefined` while loading, `null` when unavailable. */
export function useFxRates(base: string | null, needed: boolean, preview?: Rates): Rates | null | undefined {
  const [state, setState] = useState<{ base: string; rates: Rates | null } | null>(null);
  useEffect(() => {
    if (preview || !base || !needed) return;
    const cached = readLocalCache<Rates>(`fx:${base}`, FX_TTL);
    if (cached) {
      // Deferred a frame so the state write isn't in the effect body.
      const frame = requestAnimationFrame(() => setState({ base, rates: cached }));
      return () => cancelAnimationFrame(frame);
    }
    const controller = new AbortController();
    fetch(`/api/fx?base=${base}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ rates: Rates | null }>) : { rates: null }))
      .then(({ rates }) => {
        if (rates) writeLocalCache(`fx:${base}`, rates);
        setState({ base, rates });
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setState({ base, rates: null });
      });
    return () => controller.abort();
  }, [base, needed, preview]);
  if (preview) return preview;
  if (!base) return undefined;
  if (!needed) return {};
  return state?.base === base ? state.rates : undefined;
}

/* ---------------------------------------------------------------------------
 * Prices
 * ------------------------------------------------------------------------ */

/** Firestore history documents read per visit, most valuable games first. */
export const HISTORY_GAMES = 30;
const PRICE_TTL = 6 * 60 * 60_000;
const HISTORY_TTL = DAY_MS;

export interface LibraryPricing {
  /** gameId → today's best price in the region (null = no store prices it). */
  current: BatchPrices;
  /** gameId → our observations in the region's price currency, oldest first. */
  history: Record<number, { currency: string; samples: PriceSample[] }>;
  /** How many owned games had history looked up. */
  historyChecked: number;
}

/** Collapses a document's rows to one best price per day in one currency. */
function samplesFrom(data: Record<string, unknown> | null, country: string, currency: string | null): { currency: string; samples: PriceSample[] } | null {
  const rows = priceRows(data ?? {}, country);
  if (rows.length === 0) return null;
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.currency, (counts.get(row.currency) ?? 0) + 1);
  const chosen = currency && counts.has(currency) ? currency : [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const byDay = new Map<string, PriceSample>();
  for (const row of rows) {
    if (row.currency !== chosen) continue;
    const existing = byDay.get(row.observed_on);
    if (!existing || row.price < existing.price) {
      byDay.set(row.observed_on, { date: row.observed_on, price: row.price, initial: row.initial ?? existing?.initial ?? null });
    }
  }
  return { currency: chosen, samples: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

/**
 * `undefined` while loading, `null` when the price route can't answer.
 * `priority` ids (games with a recorded purchase) get their history read first.
 */
export function useLibraryPricing(
  owned: WatchlistEntry[],
  region: string | null,
  priority: number[],
  preview?: LibraryPricing,
): LibraryPricing | null | undefined {
  const ids = useMemo(() => igdbIds(owned), [owned]);
  const key = region && ids.length ? `${region}|${ids.join(",")}|${[...priority].sort((a, b) => a - b).join(",")}` : "";
  const [state, setState] = useState<{ key: string; pricing: LibraryPricing | null } | null>(null);

  useEffect(() => {
    if (preview || !key) return;
    const [cc, list, first] = key.split("|");
    const wanted = list.split(",").map(Number);
    const prioritised = first ? first.split(",").map(Number) : [];
    let active = true;
    (async () => {
      const cacheKey = `library-prices:${cc}`;
      const cached = readLocalCache<{ ids: string; current: BatchPrices }>(cacheKey, PRICE_TTL);
      let current: BatchPrices | null = cached?.ids === list ? cached.current : null;
      if (!current) {
        const parts = [];
        for (let offset = 0; offset < wanted.length; offset += 100) {
          const chunk = wanted.slice(offset, offset + 100);
          parts.push(
            await fetch("/api/prices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: chunk, cc }),
            })
              .then((response) => (response.ok ? (response.json() as Promise<BatchPrices>) : null))
              .catch(() => null),
          );
        }
        const ok = parts.filter((part): part is BatchPrices => Boolean(part));
        if (ok.length === 0) {
          if (active) setState({ key, pricing: null });
          return;
        }
        current = Object.assign({}, ...ok) as BatchPrices;
        writeLocalCache(cacheKey, { ids: list, current });
      }

      // History for purchases first, then the priciest owned games.
      const byPrice = wanted
        .filter((id) => !prioritised.includes(id))
        .sort((a, b) => (current![String(b)]?.price ?? -1) - (current![String(a)]?.price ?? -1));
      const historyIds = [...prioritised.filter((id) => wanted.includes(id)), ...byPrice].slice(0, HISTORY_GAMES);
      const history: LibraryPricing["history"] = {};
      await Promise.all(
        historyIds.map(async (id) => {
          const slot = `price-history:${cc}:${id}`;
          const hit = readLocalCache<{ currency: string; samples: PriceSample[] } | false>(slot, HISTORY_TTL);
          if (hit !== null) {
            if (hit) history[id] = hit;
            return;
          }
          try {
            const data = await readStatsDoc(STATS_COLLECTIONS.prices, String(id));
            const samples = samplesFrom(data, cc, current![String(id)]?.currency ?? null);
            if (samples) history[id] = samples;
            writeLocalCache(slot, samples ?? false);
          } catch {
            /* a refused read is just a game without history */
          }
        }),
      );
      if (active) setState({ key, pricing: { current, history, historyChecked: historyIds.length } });
    })();
    return () => {
      active = false;
    };
  }, [key, preview]);

  if (preview) return preview;
  if (!region) return undefined;
  if (!ids.length) return { current: {}, history: {}, historyChecked: 0 };
  return state?.key === key ? state.pricing : undefined;
}
