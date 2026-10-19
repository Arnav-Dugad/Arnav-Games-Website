"use client";

/**
 * Prices: what the game costs *where the reader is*, whether now is a good
 * moment to buy, and how that price has moved.
 *
 * Local prices only. Every amount in the main UI is the store's own price in
 * the store's own currency for the chosen region — never a US price run
 * through an exchange rate, which is not a price anyone can actually pay.
 * The one place conversions appear is the regional comparison, where they
 * are the point, and it says so on the tin.
 *
 * Until the region is known (server render, or detection in flight) the
 * section shows its skeleton rather than flashing US prices to someone in
 * India.
 */

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { ArrowUpRight, BadgePercent, ChevronDown, Globe2, MapPin, RefreshCw, Store, TrendingDown } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { haptic } from "@/lib/haptics";
import { usePriceRegion } from "@/lib/preferences/region";
import { cn } from "@/lib/utils/cn";
import type { GameMarket, LocalPrice, PricePoint, RegionalPrice } from "@/lib/games/types";
import { DetailSection } from "./DetailSection";
import { marketUrl, useEndpoint, type GameIds } from "./endpoint";
import { useLiveField } from "./live";
import { bestPrice, DiscountTag, STORE_LABEL, StoreMark, VERDICT, VerdictChip } from "./market-ui";
import { countryName, formatMoney } from "./money";
import { TimeChart } from "./TimeChart";

export const PRICE_REGION_SETTINGS = "/settings#price-region";

const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const AXIS_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const AXIS_MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const formatDay = (iso: string) => DAY_FMT.format(new Date(dayMs(iso)));

export function PriceSection({ ids, name, upcoming }: { ids: GameIds; name: string; upcoming: boolean }) {
  const [region, , explicit] = usePriceRegion();
  const market = useEndpoint<GameMarket>(region ? marketUrl(ids, region) : null);

  const where = region ? countryName(region) : null;
  const aside = where ? (
    <p className="flex items-center gap-1.5 text-[13px] text-muted">
      <MapPin size={13} className="shrink-0 text-faint" />
      <span>
        Prices for <span className="font-semibold text-text">{where}</span>
        {!explicit && <span className="text-faint"> (your location)</span>}
      </span>
      <span aria-hidden className="text-faint">·</span>
      <Link
        href={PRICE_REGION_SETTINGS}
        className="font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))] underline-offset-2 hover:underline"
        aria-label={`Change price region (currently ${where})`}
      >
        Change
      </Link>
    </p>
  ) : null;

  return (
    <DetailSection
      id="prices"
      eyebrow="Prices"
      icon={<BadgePercent size={14} />}
      title="What it costs"
      description={region ? undefined : "Finding your store region…"}
      aside={aside}
    >
      {market.status === "loading" || !region ? (
        <PriceSkeleton />
      ) : market.status === "error" ? (
        <Unavailable onRetry={market.retry} />
      ) : market.status === "missing" ? (
        <NoPrice name={name} country={where ?? region} upcoming={upcoming} />
      ) : (
        <PriceBody market={market.data} ids={ids} name={name} upcoming={upcoming} region={region} />
      )}
    </DetailSection>
  );
}

/* ------------------------------------------------------------------------ */

function PriceBody({
  market,
  ids,
  name,
  upcoming,
  region,
}: {
  market: GameMarket;
  ids: GameIds;
  name: string;
  upcoming: boolean;
  region: string;
}) {
  const best = bestPrice(market);
  const country = countryName(market.country);
  const free = market.prices.length > 0 && market.prices.every((price) => price.price === 0);

  if (!best && market.history.length === 0) {
    return <NoPrice name={name} country={country} upcoming={upcoming} />;
  }

  return (
    <div className="space-y-4">
      <div className="glass overflow-hidden rounded-3xl">
        {best && <BestPrice best={best} market={market} free={free} />}
        {market.prices.length > 1 && (
          <ul className="border-t border-line">
            {market.prices
              .filter((price) => price !== best)
              .map((price) => (
                <li key={price.store}>
                  <StoreRow price={price} />
                </li>
              ))}
          </ul>
        )}
      </div>

      {!free && <History market={market} />}

      {!free && <RegionalComparison market={market} ids={ids} region={region} />}

      {region === "US" && <UsDeals />}
    </div>
  );
}

function BestPrice({ best, market, free }: { best: LocalPrice; market: GameMarket; free: boolean }) {
  const verdict = VERDICT[market.verdict.kind];
  return (
    <div className="relative isolate p-5 sm:p-6">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-16 -top-24 -z-10 h-56 w-56 rounded-full bg-[var(--game-glow)] opacity-60 blur-3xl"
      />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            <StoreMark store={best.store} size={14} />
            {free ? `Free on ${STORE_LABEL[best.store]}` : market.prices.length > 1 ? `Best price · ${STORE_LABEL[best.store]}` : STORE_LABEL[best.store]}
          </p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-[40px] font-bold leading-none tracking-[-0.03em] text-text sm:text-[48px]">
              {free ? "Free to play" : formatMoney(best.price, best.currency, best.country)}
            </span>
            {!free && <DiscountTag percent={best.discount} className="text-[13px]" />}
            {!free && best.initial !== null && best.initial > best.price && (
              <s className="text-[15px] text-faint">{formatMoney(best.initial, best.currency, best.country)}</s>
            )}
          </p>
          {/* "Lowest we've seen" means nothing until we've seen more than one day. */}
          {!free && market.lowest && new Set(market.history.map((point) => point.date)).size > 1 && (
            <p className="mt-2.5 flex items-center gap-1.5 text-[13px] text-muted">
              <TrendingDown size={14} className="shrink-0 text-mint" />
              Lowest we&rsquo;ve seen: {formatMoney(market.lowest.price, best.currency, market.country)} on{" "}
              {formatDay(market.lowest.date)}
            </p>
          )}
        </div>

        <a
          href={best.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => haptic("light")}
          className="press inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--game-accent,var(--color-brand))] px-6 text-[15px] font-semibold text-[var(--game-on-accent,#fff)] shadow-[0_10px_30px_-12px_var(--game-glow)] transition-transform"
        >
          {free ? "Play free" : "Buy"} on {STORE_LABEL[best.store]}
          <ArrowUpRight size={16} />
        </a>
      </div>

      {!free && (
        <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:gap-3">
          <VerdictChip kind={market.verdict.kind} className="w-fit" />
          {market.verdict.reason && (
            <p className="text-[13px] leading-snug text-muted">
              <span className="sr-only">{verdict.label}: </span>
              {market.verdict.reason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StoreRow({ price }: { price: LocalPrice }) {
  return (
    <a
      href={price.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-14 items-center gap-3 px-5 py-3 text-[15px] transition-colors fine:hover:bg-fg/[0.04] sm:px-6"
    >
      <StoreMark store={price.store} />
      <span className="min-w-0 flex-1 truncate font-medium text-text">{STORE_LABEL[price.store]}</span>
      <DiscountTag percent={price.discount} />
      {price.initial !== null && price.initial > price.price && (
        <s className="hidden text-[13px] text-faint min-[400px]:inline">{formatMoney(price.initial, price.currency, price.country)}</s>
      )}
      <span className="font-semibold tabular-nums text-text">{formatMoney(price.price, price.currency, price.country)}</span>
      <ArrowUpRight size={14} className="shrink-0 text-faint" />
    </a>
  );
}

/* ------------------------------------------------------------------------ */

function History({ market }: { market: GameMarket }) {
  const stores = useMemo(() => {
    const counts = new Map<LocalPrice["store"], number>();
    market.history.forEach((point) => counts.set(point.store, (counts.get(point.store) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === "steam" ? -1 : 1)).map(([store]) => store);
  }, [market.history]);
  const [chosen, setChosen] = useState<LocalPrice["store"] | null>(null);
  // The current price holds until today; captured once so renders stay pure.
  const [today] = useState(() => Date.now());
  const store = chosen && stores.includes(chosen) ? chosen : stores[0];
  const currency = market.currency ?? market.prices[0]?.currency ?? null;

  const series: PricePoint[] = useMemo(
    () => market.history.filter((point) => point.store === store),
    [market.history, store],
  );
  const points = useMemo(() => series.map((point) => ({ t: dayMs(point.date), v: point.price })), [series]);
  const since = market.trackingSince ?? market.history[0]?.date ?? null;

  if (!currency || !store) return null;
  const fmt = (value: number) => formatMoney(value, currency, market.country);
  // The axis's zero is a number, not a price — "Free" there would read as a claim.
  const fmtTick = (value: number) => (value === 0 ? "0" : formatMoney(value, currency, market.country, { compact: true }));
  const spanDays = points.length > 1 ? (points[points.length - 1].t - points[0].t) / 86_400_000 : 0;
  const lowest = market.lowest && market.lowest.store === store ? market.lowest : null;
  const changes = series.reduce((count, point, index) => (index > 0 && point.price !== series[index - 1].price ? count + 1 : count), 0);

  return (
    <div className="glass rounded-3xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-semibold text-text">Price history</h3>
          <p className="mt-0.5 text-[13px] text-muted">
            {since ? (
              <>
                Tracked daily in {countryName(market.country)} since {formatDay(since)}
                {points.length > 1 && ` · ${changes === 0 ? "no changes yet" : `${changes} ${changes === 1 ? "change" : "changes"}`}`}
              </>
            ) : (
              `Tracked daily in ${countryName(market.country)}`
            )}
          </p>
        </div>
        {stores.length > 1 && (
          <div role="radiogroup" aria-label="Store" className="flex rounded-full border border-line bg-fg/[0.05] p-0.5">
            {stores.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === store}
                onClick={() => {
                  haptic("selection");
                  setChosen(option);
                }}
                className={cn(
                  "press inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors coarse:min-h-11",
                  option === store ? "bg-panel text-text shadow-sm" : "text-muted fine:hover:text-text",
                )}
              >
                <StoreMark store={option} size={13} />
                {option === "steam" ? "Steam" : "Microsoft"}
              </button>
            ))}
          </div>
        )}
      </div>

      {points.length >= 2 ? (
        <TimeChart
          className="mt-5"
          points={points}
          step
          extendTo={today}
          height={210}
          formatValue={fmt}
          formatTick={fmtTick}
          formatTime={(t) => DAY_FMT.format(new Date(t))}
          formatAxisTime={(t) => (spanDays > 120 ? AXIS_MONTH_FMT : AXIS_FMT).format(new Date(t))}
          marker={lowest && changes > 0 ? { t: dayMs(lowest.date), v: lowest.price, label: `Lowest ${fmt(lowest.price)}` } : null}
          label={`${STORE_LABEL[store]} price history in ${countryName(market.country)}`}
          summary={`${points.length} daily observations from ${DAY_FMT.format(new Date(points[0].t))}. Current ${fmt(points[points.length - 1].v)}${lowest ? `, lowest ${fmt(lowest.price)} on ${formatDay(lowest.date)}` : ""}.`}
        />
      ) : (
        <p className="mt-5 rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[13px] leading-relaxed text-muted">
          We started watching this price{since ? ` on ${formatDay(since)}` : " recently"}. The chart appears once
          there&rsquo;s more than one day to draw.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function RegionalComparison({ market, ids, region }: { market: GameMarket; ids: GameIds; region: string }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const calm = useCalmMotion();
  // Regional prices may come with the main response; otherwise they're only
  // fetched once someone opens the comparison.
  const needsFetch = open && market.regional.length === 0;
  const fetched = useEndpoint<GameMarket>(needsFetch ? marketUrl(ids, region, true) : null);
  const source = market.regional.length > 0 ? market : fetched.status === "ready" ? fetched.data : null;
  const currency = source?.currency ?? market.currency;

  const rows = useMemo(() => {
    if (!source) return [];
    return [...source.regional].sort((a, b) => {
      if (a.converted === null) return 1;
      if (b.converted === null) return -1;
      return a.converted - b.converted;
    });
  }, [source]);
  const converted = rows.filter((row): row is RegionalPrice & { converted: number } => row.converted !== null);
  const max = Math.max(1, ...converted.map((row) => row.converted));
  const cheapest = converted[0]?.country ?? null;
  const shown = all ? rows : rows.slice(0, 8);
  const panelId = "regional-prices-panel";

  return (
    <div className="glass overflow-hidden rounded-3xl">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          haptic("selection");
          setOpen((value) => !value);
        }}
        className="flex min-h-16 w-full items-center gap-3 px-5 py-4 text-left transition-colors fine:hover:bg-fg/[0.03] sm:px-6"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fg/[0.06] text-[var(--game-accent)]">
          <Globe2 size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-text">Steam prices around the world</span>
          <span className="block text-[13px] text-muted">
            {currency ? `Converted to ${currency} for comparison` : "Regional Steam prices"}
          </span>
        </span>
        <ChevronDown size={18} className={cn("shrink-0 text-faint transition-transform duration-300", open && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={calm ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={calm ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-line px-5 pb-5 pt-4 sm:px-6">
              {!source ? (
                fetched.status === "error" || fetched.status === "missing" ? (
                  <p className="py-4 text-[13px] text-muted">Regional prices aren&rsquo;t available right now.</p>
                ) : (
                  <div aria-hidden className="space-y-3 py-1">
                    {Array.from({ length: 5 }, (_, index) => (
                      <Skeleton key={index} className="h-9 w-full rounded-xl" />
                    ))}
                  </div>
                )
              ) : rows.length === 0 ? (
                <p className="py-4 text-[13px] text-muted">Steam doesn&rsquo;t list this game in other regions.</p>
              ) : (
                <>
                  <p className="mb-3 text-[12px] leading-snug text-faint">
                    Each store charges in its own currency (shown small). Bars compare them converted to {currency} at
                    today&rsquo;s exchange rate — a guide, not a price you can pay.
                  </p>
                  <ul className="divide-y divide-line">
                    {shown.map((row) => {
                      const isCheapest = row.country === cheapest;
                      const isYou = row.country === market.country;
                      return (
                        <li key={row.country} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5">
                          <span className="flex min-w-0 items-center gap-2 text-[14px] text-text">
                            <span className="w-7 shrink-0 text-[11px] font-semibold tabular-nums text-faint">{row.country}</span>
                            <span className="truncate">{countryName(row.country)}</span>
                            {isCheapest && (
                              <span className="shrink-0 rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-bold text-mint">Cheapest</span>
                            )}
                            {isYou && (
                              <span className="shrink-0 rounded-full bg-fg/[0.08] px-2 py-0.5 text-[10px] font-bold text-muted">You</span>
                            )}
                          </span>
                          <span className="text-right">
                            <span className="block text-[14px] font-semibold tabular-nums text-text">
                              {row.converted !== null && currency ? formatMoney(row.converted, currency, market.country) : formatMoney(row.price, row.currency, row.country)}
                            </span>
                          </span>
                          <span className="col-span-2 flex items-center gap-3">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/[0.07]" aria-hidden>
                              {row.converted !== null && (
                                <span
                                  className={cn("block h-full rounded-full", isCheapest ? "bg-mint" : isYou ? "bg-[var(--game-accent)]" : "bg-fg/30")}
                                  style={{ width: `${Math.max(3, (row.converted / max) * 100)}%` }}
                                />
                              )}
                            </span>
                            <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-faint">
                              {row.converted !== null ? formatMoney(row.price, row.currency, row.country) : "no exchange rate"}
                              {row.discount >= 1 && <span className="text-mint"> −{row.discount}%</span>}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {rows.length > 8 && (
                    <button
                      type="button"
                      onClick={() => setAll((value) => !value)}
                      className="press mt-3 inline-flex min-h-10 items-center rounded-full bg-fg/[0.07] px-4 text-[13px] font-semibold text-text fine:hover:bg-fg/[0.12]"
                    >
                      {all ? "Show fewer" : `Show all ${rows.length} regions`}
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** US readers also get CheapShark's PC key-store deals — US prices, so only for them. */
function UsDeals() {
  const deals = useLiveField((live) => (live.deals && live.deals.stores.length > 0 ? live.deals : null));
  if (deals.state !== "ready") return null;
  const usd = (n: number) => (n === 0 ? "Free" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n));
  return (
    <div className="glass rounded-3xl p-5 sm:p-6">
      <h3 className="text-[17px] font-semibold text-text">Other PC stores</h3>
      <p className="mt-0.5 text-[13px] text-muted">US prices via CheapShark</p>
      <ul className="mt-3 divide-y divide-line">
        {deals.value.stores.slice(0, 6).map((deal) => (
          <li key={`${deal.store}-${deal.url}`}>
            <a
              href={deal.url}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="flex min-h-12 items-center gap-3 py-2 text-[14px] transition-colors fine:hover:text-text"
            >
              <Store size={15} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate font-medium text-text">{deal.store}</span>
              <DiscountTag percent={deal.savings} />
              <span className="font-semibold tabular-nums text-text">{usd(deal.price)}</span>
              <ArrowUpRight size={13} className="shrink-0 text-faint" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function PriceSkeleton() {
  return (
    <div aria-hidden className="space-y-4">
      <div className="glass rounded-3xl p-5 sm:p-6">
        <Skeleton className="h-3.5 w-28 rounded-full" />
        <Skeleton className="mt-3 h-11 w-44 rounded-xl" />
        <Skeleton className="mt-3 h-3.5 w-56 rounded-full" />
        <div className="mt-5 border-t border-line pt-4">
          <Skeleton className="h-7 w-36 rounded-full" />
        </div>
      </div>
      <div className="glass rounded-3xl p-5 sm:p-6">
        <Skeleton className="h-4 w-28 rounded-full" />
        <Skeleton className="mt-5 h-[210px] w-full rounded-2xl" />
      </div>
    </div>
  );
}

function NoPrice({ name, country, upcoming }: { name: string; country: string; upcoming: boolean }) {
  return (
    <div className="glass flex flex-col items-start gap-3 rounded-3xl p-5 sm:flex-row sm:items-center sm:p-6">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-fg/[0.06] text-faint">
        <BadgePercent size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-text">
          {upcoming ? `Not on sale in ${country} yet` : `No store price for ${country}`}
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted">
          {upcoming
            ? `Steam and the Microsoft Store haven't listed a price for ${name} here. Follow it to hear when pre-orders open.`
            : `${name} isn't sold on Steam or the Microsoft Store in ${country}, or the store hides its price.`}
        </p>
      </div>
      <Link
        href={PRICE_REGION_SETTINGS}
        className="press inline-flex min-h-10 shrink-0 items-center rounded-full bg-fg/[0.07] px-4 text-[13px] font-semibold text-text fine:hover:bg-fg/[0.12]"
      >
        Change region
      </Link>
    </div>
  );
}

function Unavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="glass flex flex-col items-start gap-3 rounded-3xl p-5 sm:flex-row sm:items-center sm:p-6">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-text">Prices couldn&rsquo;t load</p>
        <p className="mt-0.5 text-[13px] text-muted">The stores didn&rsquo;t answer in time. Your other data is unaffected.</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="press inline-flex min-h-10 items-center gap-2 rounded-full bg-fg/[0.07] px-4 text-[13px] font-semibold text-text fine:hover:bg-fg/[0.12]"
      >
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}
