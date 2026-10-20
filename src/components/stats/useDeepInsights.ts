"use client";

/**
 * The deeper personal analytics on /stats — what you finish, your taste map,
 * when you play, what you've spent and what the library is worth — assembled
 * in the browser from data the reader's device already has (library, journal,
 * hours, purchases, reviews) plus three cheap lookups (facets, FX, prices;
 * see `personal-data.ts`). Every builder is pure; this hook only gathers.
 *
 * The dev preview passes `preview` and touches no network or account.
 */

import { useMemo } from "react";
import type { WatchlistEntry } from "@/lib/firebase/db";
import { usePersonal, type JournalEntry } from "@/lib/personal/store";
import { finishRates, type FinishRates, type PlaySession } from "@/lib/personal/play-insights";
import { buildTasteMap, type GameFacets, type TasteMap } from "@/lib/personal/taste-map";
import {
  currencyForRegion,
  libraryValue,
  observedLow,
  spendSummary,
  toCurrency,
  type LibraryValue,
  type ObservedLow,
  type Purchase,
  type Rates,
  type SpendSummary,
} from "@/lib/personal/spend";
import { PRICE_REGIONS, usePriceRegion } from "@/lib/preferences/region";
import { useAccountReviews } from "@/lib/recs/use-recommendations";
import type { TasteReview } from "@/lib/recs/profile";
import { releaseState } from "@/lib/games/release-state";
import { useFxRates, useGameFacets, useLibraryPricing, type LibraryPricing } from "./personal-data";
import type { GameName } from "./charts/Money";

export interface MoneyInsights {
  status: "loading" | "ready" | "unavailable";
  /** The reader's currency (from their price region). */
  currency: string;
  regionName: string;
  purchases: number;
  spend: SpendSummary | null;
  value: LibraryValue | null;
  /** The stores' currency for the region (Steam prices some regions in USD). */
  valueCurrency: string | null;
  /** Recorded purchases of owned games, in `valueCurrency`. */
  paid: number | null;
  owned: number;
  historyChecked: number;
  historyFound: number;
  names: Record<number, GameName>;
}

export interface DeepInsights {
  finish: FinishRates;
  /** Null while reviews/facets load. */
  taste: TasteMap | null;
  play: { sessions: PlaySession[]; milestones: number[] };
  money: MoneyInsights;
}

export interface DeepPreview {
  journal: JournalEntry[];
  playtime: Record<number, number>;
  purchases: Purchase[];
  reviews: TasteReview[];
  facets: Record<number, GameFacets>;
  pricing: LibraryPricing;
  rates: Rates;
  region: string;
}

const NO_PURCHASES: Record<number, Purchase> = {};

export function useDeepInsights(entries: WatchlistEntry[], preview?: DeepPreview): DeepInsights {
  const live = usePersonal();
  const liveReviews = useAccountReviews();
  const [liveRegion] = usePriceRegion();
  const journal = preview?.journal ?? live.journal;
  const playtime = preview?.playtime ?? live.playtime;
  const purchaseMap = live.purchases ?? NO_PURCHASES;
  const purchases = useMemo(() => preview?.purchases ?? Object.values(purchaseMap), [preview, purchaseMap]);
  const reviews = preview?.reviews ?? liveReviews;
  const region = preview?.region ?? liveRegion;

  const owned = useMemo(
    () => entries.filter((entry) => (entry.ownedOn ?? []).length > 0 && releaseState(entry) !== "upcoming"),
    [entries],
  );
  const facets = useGameFacets(entries, preview?.facets);

  const finish = useMemo(() => {
    const themes: Record<number, Array<{ id: number; name: string }>> = {};
    for (const [id, value] of Object.entries(facets.facets)) themes[Number(id)] = value.themes;
    return finishRates(entries, { playtime, journal, themes });
  }, [entries, playtime, journal, facets.facets]);

  const taste = useMemo(
    () => (reviews && facets.ready ? buildTasteMap(entries, { reviews, journal, facets: facets.facets, playtime }) : null),
    [entries, reviews, journal, facets, playtime],
  );

  const play = useMemo(
    () => ({
      sessions: journal.map((entry) => ({ gameId: entry.gameId, at: entry.at, hours: entry.hours })),
      milestones: entries.flatMap((entry) => [entry.startedAt ?? 0, entry.finishedAt ?? 0]).filter((at) => at > 0),
    }),
    [journal, entries],
  );

  // Money ------------------------------------------------------------------
  const currency = currencyForRegion(region);
  const purchasedIds = useMemo(() => purchases.map((purchase) => purchase.gameId), [purchases]);
  const pricing = useLibraryPricing(owned, region, purchasedIds, preview?.pricing);
  const current = pricing?.current ?? null;
  const valueCurrency = useMemo(() => {
    if (!current) return null;
    const counts = new Map<string, number>();
    for (const price of Object.values(current)) if (price && price.price > 0) counts.set(price.currency, (counts.get(price.currency) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? currency;
  }, [current, currency]);
  const needsFx = purchases.some((purchase) => purchase.currency !== currency) || (valueCurrency !== null && valueCurrency !== currency);
  const rates = useFxRates(region ? currency : null, needsFx, preview?.rates);

  const money = useMemo<MoneyInsights>(() => {
    const regionName = PRICE_REGIONS.find((item) => item.code === region)?.name.replace(/ \(Euro\)$/, "") ?? region ?? "your region";
    const names: Record<number, GameName> = {};
    for (const entry of entries) names[entry.gameId] = { name: entry.name, slug: entry.slug };
    const base = {
      currency,
      regionName,
      purchases: purchases.length,
      owned: owned.length,
      names,
      historyChecked: pricing?.historyChecked ?? 0,
      historyFound: pricing ? Object.keys(pricing.history).length : 0,
    };
    if (!region || pricing === undefined || rates === undefined) {
      return { ...base, status: "loading", spend: null, value: null, valueCurrency: null, paid: null };
    }
    const lows: Record<number, ObservedLow> = {};
    for (const [id, history] of Object.entries(pricing?.history ?? {})) {
      const low = observedLow(history.samples, history.currency);
      if (low) lows[Number(id)] = low;
    }
    const spend = purchases.length ? spendSummary(purchases, { currency, rates, playtime, lows }) : null;
    if (!pricing || !valueCurrency) {
      return { ...base, status: "unavailable", spend, value: null, valueCurrency: null, paid: null };
    }
    const value = libraryValue(
      owned.map((entry) => {
        const price = pricing.current[String(entry.gameId)];
        const history = pricing.history[entry.gameId];
        return {
          gameId: entry.gameId,
          addedAt: entry.addedAt,
          current: price && price.currency === valueCurrency ? price.price : price?.price === 0 ? 0 : null,
          history: history && history.currency === valueCurrency ? history.samples : [],
        };
      }),
    );
    const ownedIds = new Set(owned.map((entry) => entry.gameId));
    const ownedPurchases = purchases.filter((purchase) => ownedIds.has(purchase.gameId));
    const converted = ownedPurchases.map((purchase) => toCurrency(purchase.amount, purchase.currency, valueCurrency, rates, currency));
    const paid = ownedPurchases.length && converted.every((amount) => amount !== null)
      ? converted.reduce<number>((sum, amount) => sum + (amount ?? 0), 0)
      : null;
    return { ...base, status: "ready", spend, value, valueCurrency, paid };
  }, [entries, owned, purchases, region, currency, pricing, rates, valueCurrency, playtime]);

  return { finish, taste, play, money };
}
