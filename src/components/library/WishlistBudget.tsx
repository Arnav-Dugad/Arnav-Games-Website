"use client";

/**
 * "Best buys this month": a monthly budget turned into a shopping list.
 *
 * The candidates are released games on the watchlist that the reader doesn't
 * own and hasn't already played. Each gets a value score and the list is the
 * subset that maximises total value without going over budget — an exact 0/1
 * knapsack, not a greedy "cheapest first", so one great £40 game can beat
 * four forgettable £10 ones.
 *
 * Value, deliberately simple and explained in the UI through the chips on
 * each row:
 *  - critic score, squared, so a 92 is worth noticeably more than a 75
 *    (unscored games count as a middling 70 rather than zero);
 *  - a discount bonus — a sale is a reason to buy *this* month;
 *  - a gentle hours bonus where IGDB has a time-to-beat, so value per hour
 *    counts without turning every pick into a 100-hour RPG.
 *
 * Prices are the stores' own local prices for the reader's price region
 * (`POST /api/prices`), in minor units. Nothing is converted or estimated; a
 * game with no store price in that region is simply left out and counted.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Minus, Plus } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { ScorePill } from "@/components/ui/ScoreRing";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTimeToBeat } from "@/components/stats/useTimeToBeat";
import { usePreferences } from "@/lib/preferences/PreferencesProvider";
import { PRICE_REGIONS, usePriceRegion } from "@/lib/preferences/region";
import { currencyDigits } from "@/lib/games/market-rules";
import { releaseState } from "@/lib/games/release-state";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import type { WatchlistEntry } from "@/lib/firebase/db";
import type { BatchPrices, LocalPrice } from "@/lib/games/types";
import type { TimeToBeatLike } from "@/lib/games/stats";

const SHOWN = 6;

interface Candidate {
  entry: WatchlistEntry;
  price: LocalPrice;
  hours: number | null;
  value: number;
}

export default function WishlistBudget({
  saved,
  preview,
}: {
  saved: WatchlistEntry[];
  /** Dev preview only: illustrative prices for the sample library's fake ids. */
  preview?: { region: string; prices: BatchPrices; hours?: Record<number, TimeToBeatLike> };
}) {
  const [liveRegion] = usePriceRegion();
  const region = preview?.region ?? liveRegion;
  const candidates = useMemo(
    () => saved.filter((entry) => releaseState(entry) === "released" && (entry.ownedOn ?? []).length === 0 && entry.status !== "played"),
    [saved],
  );
  const ttb = useTimeToBeat(candidates, { preview: preview?.hours });
  const prices = usePrices(candidates, region, preview?.prices);

  const priced = useMemo<Candidate[]>(() => {
    if (!prices) return [];
    return candidates.flatMap((entry) => {
      const price = prices[String(entry.gameId)];
      if (!price) return [];
      const ttbRow = ttb.data?.[entry.gameId];
      const hours = ttbRow?.normally ?? ttbRow?.hastily ?? null;
      return [{ entry, price, hours, value: valueOf(entry, price, hours) }];
    });
  }, [candidates, prices, ttb.data]);

  // One region means one currency; the most common one wins if a store ever disagrees.
  const currency = useMemo(() => mostCommon(priced.map((item) => item.price.currency)), [priced]);
  const sameCurrency = useMemo(() => priced.filter((item) => item.price.currency === currency), [priced, currency]);
  const scale = useMemo(() => budgetScale(sameCurrency.map((item) => item.price.price)), [sameCurrency]);

  // A real preference field (device + account), not a key in the poster-size map.
  const { wishlistBudget, setWishlistBudget } = usePreferences();
  const stored = wishlistBudget && currency && wishlistBudget.currency === currency && wishlistBudget.amount > 0 ? wishlistBudget.amount : null;
  const [draft, setDraft] = useState<{ currency: string; amount: number } | null>(null);
  const budget = draft?.currency === currency ? draft.amount : stored ?? scale?.suggested ?? 0;

  // Commit after the thumb settles: a drag fires dozens of changes, and the
  // preference is mirrored to the account.
  useEffect(() => {
    if (!draft || !currency || draft.currency !== currency || draft.amount === stored) return;
    const id = window.setTimeout(() => setWishlistBudget({ currency: draft.currency, amount: draft.amount }), 600);
    return () => window.clearTimeout(id);
  }, [draft, currency, stored, setWishlistBudget]);

  const picks = useMemo(() => bestBuys(sameCurrency, budget), [sameCurrency, budget]);
  const regionName = PRICE_REGIONS.find((item) => item.code === region)?.name.replace(/ \(Euro\)$/, "") ?? region;

  // Nothing released and unowned on the list: there is nothing to buy.
  if (candidates.length === 0) return null;

  const loading = !region || prices === undefined;
  const set = (amount: number) => {
    if (!currency || !scale) return;
    setDraft({ currency, amount: Math.min(scale.max, Math.max(scale.step, Math.round(amount / scale.step) * scale.step)) });
  };

  return (
    <section aria-labelledby="budget-title" className="glass mt-8 rounded-3xl p-4 sm:mt-10 sm:p-6">
      <h2 id="budget-title" className="font-display text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">
        Best buys this month
      </h2>

      {loading ? (
        <div className="mt-5 space-y-3" aria-label="Loading prices">
          <Skeleton className="h-12 w-full max-w-md rounded-2xl" />
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16 w-full rounded-2xl" />)}
        </div>
      ) : prices === null ? (
        <p className="mt-2 text-[15px] text-muted">Store prices aren&apos;t available right now.</p>
      ) : !currency || !scale ? (
        <p className="mt-2 text-[15px] text-muted">
          None of your wishlisted games has a Steam or Microsoft Store price in {regionName}.
        </p>
      ) : (
        <>
          {/* Desktop: the budget sits beside its answer instead of above a very wide list. */}
          <div className="lg:mt-5 lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start lg:gap-12 lg:[&>*]:mt-0">
            <BudgetControl budget={budget} currency={currency} scale={scale} onChange={set} />
            <PickList picks={picks} budget={budget} currency={currency} all={sameCurrency} />
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-faint">
            Steam and Microsoft Store prices for {regionName}
            {candidates.length > priced.length && ` · ${candidates.length - priced.length} without a store price there`}
            {" · "}
            <Link href="/settings#price-region" className="font-medium text-brand-soft fine:hover:underline">
              Change region
            </Link>
          </p>
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Budget control                                                             */
/* -------------------------------------------------------------------------- */

function BudgetControl({
  budget,
  currency,
  scale,
  onChange,
}: {
  budget: number;
  currency: string;
  scale: Scale;
  onChange: (amount: number) => void;
}) {
  const step = (direction: 1 | -1) => {
    haptic("selection");
    onChange(budget + direction * scale.step);
  };
  return (
    <div className="mt-4 sm:max-w-md">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="wishlist-budget" className="text-[13px] font-medium text-muted">
          Monthly budget
        </label>
        <output htmlFor="wishlist-budget" className="font-display text-[28px] font-bold leading-none tabular-nums">
          {money(budget, currency)}
        </output>
      </div>
      {/* Slider for big moves, steppers for exact ones (and for anyone who can't drag). */}
      <div className="mt-2 flex items-center gap-2">
        <StepButton label="Lower budget" onClick={() => step(-1)} disabled={budget <= scale.step}>
          <Minus size={16} />
        </StepButton>
        <input
          id="wishlist-budget"
          type="range"
          min={scale.step}
          max={scale.max}
          step={scale.step}
          value={Math.min(scale.max, budget)}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-valuetext={money(budget, currency)}
          className="h-11 min-w-0 flex-1 cursor-pointer accent-[var(--color-brand)]"
        />
        <StepButton label="Raise budget" onClick={() => step(1)} disabled={budget >= scale.max}>
          <Plus size={16} />
        </StepButton>
      </div>
    </div>
  );
}

function StepButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-fg/[0.07] text-text transition-colors fine:hover:bg-fg/[0.12] disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Picks                                                                      */
/* -------------------------------------------------------------------------- */

function PickList({ picks, budget, currency, all }: { picks: Candidate[]; budget: number; currency: string; all: Candidate[] }) {
  const [expanded, setExpanded] = useState(false);
  const total = picks.reduce((sum, item) => sum + item.price.price, 0);
  const savings = picks.reduce((sum, item) => sum + Math.max(0, (item.price.initial ?? item.price.price) - item.price.price), 0);
  const left = all.length - picks.length;

  if (picks.length === 0) {
    const cheapest = Math.min(...all.map((item) => item.price.price));
    return (
      <p className="mt-4 text-[15px] text-muted">
        Nothing fits {money(budget, currency)} — the cheapest game on your list is {money(cheapest, currency)}.
      </p>
    );
  }

  const shown = expanded ? picks : picks.slice(0, SHOWN);
  const running = shown.map((_, index) => shown.slice(0, index + 1).reduce((sum, item) => sum + item.price.price, 0));

  return (
    <div className="mt-5">
      <p className="text-[15px] text-muted">
        <span className="font-semibold text-text">{picks.length} {picks.length === 1 ? "game" : "games"}</span> for{" "}
        <span className="font-semibold tabular-nums text-text">{money(total, currency)}</span>
        {savings > 0 && <> · <span className="font-semibold tabular-nums text-mint">{money(savings, currency)} off</span></>}
      </p>
      {/* Spend bar: one segment per pick, so the running total is visible at a glance. */}
      <div aria-hidden className="mt-2.5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-fg/[0.07]">
        {picks.map((item) => (
          <span key={item.entry.gameId} className="h-full bg-brand first:rounded-l-full" style={{ width: `${(item.price.price / Math.max(budget, total)) * 100}%` }} />
        ))}
      </div>
      <p className="mt-1.5 flex justify-between text-[12px] tabular-nums text-faint">
        <span>{money(total, currency)} spent</span>
        <span>{money(Math.max(0, budget - total), currency)} left</span>
      </p>

      <ol className="mt-4 overflow-hidden rounded-2xl border border-line bg-panel/55 light:bg-panel">
        {shown.map((item, index) => (
          <PickRow key={item.entry.gameId} item={item} running={running[index]} currency={currency} first={index === 0} />
        ))}
      </ol>
      {(picks.length > SHOWN || left > 0) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[13px] text-faint">
          {left > 0 ? <span>{left} more {left === 1 ? "doesn't" : "don't"} fit this month</span> : <span />}
          {picks.length > SHOWN && (
            <button type="button" onClick={() => setExpanded((value) => !value)} className="min-h-11 font-medium text-brand-soft fine:hover:text-text">
              {expanded ? "Show fewer" : `Show all ${picks.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PickRow({ item, running, currency, first }: { item: Candidate; running: number; currency: string; first: boolean }) {
  const { entry, price, hours } = item;
  const store = price.store === "steam" ? { name: "Steam", icon: "steam" } : { name: "Microsoft Store", icon: "xbox" };
  const perHour = hours && price.price > 0 ? price.price / hours : null;
  // Two lines, no right-hand price column: on a 320px phone the title needs
  // the width more than the price needs its own column.
  return (
    <li className={cn("flex items-center gap-3 py-2.5 pl-3 pr-1.5", !first && "border-t border-line")}>
      <Link prefetch={false} href={`/game/${entry.slug}`} tabIndex={-1} aria-hidden className="relative h-14 w-[42px] shrink-0 overflow-hidden rounded-lg ring-1 ring-inset ring-fg/10">
        <GameCover name={entry.name} slug={entry.slug} image={entry.image} imageFallback={entry.imageFallback} width={120} sizes="42px" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link prefetch={false} href={`/game/${entry.slug}`} className="block truncate text-[15px] font-semibold fine:hover:text-brand-soft">{entry.name}</Link>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
          <span className="text-[13px] font-semibold tabular-nums text-text">{price.price === 0 ? "Free" : price.formatted}</span>
          {price.discount > 0 && <span className="rounded-md bg-mint/15 px-1 text-[11px] font-bold tabular-nums text-mint">−{price.discount}%</span>}
          <ScorePill score={entry.metacritic} />
          {perHour !== null && <span className="tabular-nums">{money(perHour, currency, true)}/h</span>}
          <span className="tabular-nums text-faint">Total {money(running, currency)}</span>
        </p>
      </div>
      <a
        href={price.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Buy ${entry.name} on ${store.name}, ${price.formatted}`}
        title={`Open on ${store.name}`}
        className="press flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-muted transition-colors fine:hover:bg-fg/[0.06] fine:hover:text-text"
      >
        <BrandIcon name={store.icon} size={15} title={null} />
        <span className="max-sm:sr-only">{store.name}</span>
        <ExternalLink size={12} aria-hidden />
      </a>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Data & maths                                                               */
/* -------------------------------------------------------------------------- */

/** `undefined` while loading, `null` when the route can't answer. */
function usePrices(candidates: WatchlistEntry[], region: string | null, preview?: BatchPrices): BatchPrices | null | undefined {
  const key = region ? `${region}|${candidates.map((entry) => entry.gameId).filter((id) => id !== 0).sort((a, b) => a - b).join(",")}` : "";
  const [state, setState] = useState<{ key: string; prices: BatchPrices | null } | null>(null);

  useEffect(() => {
    if (preview || !key) return;
    const [cc, list] = key.split("|");
    if (!list) return;
    const ids = list.split(",").map(Number);
    const controller = new AbortController();
    const chunks: number[][] = [];
    for (let offset = 0; offset < ids.length; offset += 50) chunks.push(ids.slice(offset, offset + 50));
    Promise.all(
      chunks.map((chunk) =>
        fetch("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk, cc }),
          signal: controller.signal,
        }).then((response) => (response.ok ? (response.json() as Promise<BatchPrices>) : null)),
      ),
    )
      .then((parts) => {
        const ok = parts.filter((part): part is BatchPrices => Boolean(part));
        setState({ key, prices: ok.length > 0 ? Object.assign({}, ...ok) : null });
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setState({ key, prices: null });
      });
    return () => controller.abort();
  }, [key, preview]);

  if (preview) return preview;
  if (!key) return undefined;
  if (!key.split("|")[1]) return {};
  return state?.key === key ? state.prices : undefined;
}

function valueOf(entry: WatchlistEntry, price: LocalPrice, hours: number | null): number {
  const quality = (entry.metacritic ?? 70) / 100;
  const sale = 1 + (price.discount / 100) * 0.8;
  const length = hours ? 1 + 0.15 * Math.log2(1 + hours / 10) : 1;
  return quality * quality * sale * length;
}

/**
 * Exact 0/1 knapsack over prices bucketed to ~1/400th of the budget. Weights
 * round *up*, so the chosen set can never exceed the budget; free games are
 * always in. Returned best value-for-money first.
 */
export function bestBuys<T extends { price: { price: number }; value: number }>(items: T[], budget: number): T[] {
  const free = items.filter((item) => item.price.price === 0);
  const paid = items.filter((item) => item.price.price > 0 && item.price.price <= budget);
  if (budget <= 0 || paid.length === 0) return free;
  const unit = Math.max(1, Math.ceil(budget / 400));
  const cap = Math.floor(budget / unit);
  const weights = paid.map((item) => Math.ceil(item.price.price / unit));
  const best = new Float64Array(cap + 1);
  const took = paid.map((item, k) => {
    const row = new Uint8Array(cap + 1);
    for (let c = cap; c >= weights[k]; c--) {
      const value = best[c - weights[k]] + item.value;
      if (value > best[c]) {
        best[c] = value;
        row[c] = 1;
      }
    }
    return row;
  });
  const chosen: T[] = [];
  let c = cap;
  for (let k = paid.length - 1; k >= 0; k--) {
    if (took[k][c]) {
      chosen.push(paid[k]);
      c -= weights[k];
    }
  }
  chosen.sort((a, b) => b.value / b.price.price - a.value / a.price.price);
  return [...free, ...chosen];
}

interface Scale {
  step: number;
  max: number;
  suggested: number;
}

/** 1, 2 or 5 × a power of ten: steps that read as round money in any currency. */
function nice(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  const lead = value / power;
  return (lead < 1.5 ? 1 : lead < 3.5 ? 2 : lead < 7.5 ? 5 : 10) * power;
}

/** Slider scale from the actual prices: steps ~1/6 of a typical game, room for the whole list. */
function budgetScale(prices: number[]): Scale | null {
  const paid = prices.filter((price) => price > 0).sort((a, b) => a - b);
  if (paid.length === 0) return null;
  const median = paid[Math.floor(paid.length / 2)];
  const step = nice(median / 6);
  const sum = paid.reduce((total, price) => total + price, 0);
  const max = Math.max(step * 10, Math.ceil(sum / step) * step);
  const suggested = Math.min(max, Math.max(step, Math.round((median * 2) / step) * step));
  return { step, max, suggested };
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  for (const [value, count] of counts) if (!best || count > (counts.get(best) ?? 0)) best = value;
  return best;
}

/** Minor units → money, without decimals when they'd only add ".00". */
function money(amount: number, currency: string, keepCents = false): string {
  const digits = currencyDigits(currency);
  const major = amount / 10 ** digits;
  const whole = !keepCents && Number.isInteger(major);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : Math.min(digits, 2),
      maximumFractionDigits: whole ? 0 : Math.min(digits, 2),
    }).format(major);
  } catch {
    return `${major.toFixed(whole ? 0 : digits)} ${currency}`;
  }
}
