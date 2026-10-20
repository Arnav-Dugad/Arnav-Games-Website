"use client";

/**
 * "Where to play & price": every store the game is on, what it costs *where
 * the reader is*, whether now is a good moment to buy, and how the price has
 * moved.
 *
 * One list instead of three overlapping blocks (the old "Where to play" tile,
 * the price card and its store rows): a store row shows its local price when
 * we know it and is a plain link when we don't. Deep data — prices around the
 * world, US key stores, release dates by region — sits behind "Show".
 *
 * Local prices only. Every amount is the store's own price in the store's own
 * currency for the chosen region — never a US price run through an exchange
 * rate. The one place conversions appear is the regional comparison, where
 * they are the point, and it says so.
 *
 * Until the region is known (server render, or detection in flight) the
 * price shows its skeleton rather than flashing US prices to someone in
 * India. Changing the region keeps the last prices on screen until the new
 * ones arrive, so the history chart can morph from one series to the other.
 */

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, BadgePercent, ChevronDown, Globe2, History as HistoryIcon, MapPin, RefreshCw, Sparkles, Store, TrendingDown } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { brandIcon } from "@/components/brand/brand-icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { haptic } from "@/lib/haptics";
import { valuePerHour } from "@/lib/games/market-rules";
import { PRICE_REGIONS, usePriceRegion } from "@/lib/preferences/region";
import { cn } from "@/lib/utils/cn";
import type { GameMarket, GeForceNowMembership, LocalPrice, PricePoint, RegionalPrice, StoreRef } from "@/lib/games/types";
import { DetailSection } from "./DetailSection";
import { Disclosure } from "./Disclosure";
import { marketUrl, useEndpoint, type EndpointState, type GameIds } from "./endpoint";
import { InfoTip } from "./InfoTip";
import { useLiveField, usePagePart } from "./live";
import { BuyingTipPanel, useBuyingTip } from "./BuyingTip";
import { bestPrice, DiscountTag, STORE_LABEL, StoreMark, useMarket, VERDICT, VerdictChip } from "./market-ui";
import { countryName, formatMoney, formatRate } from "./money";
import { hoursLabel } from "./summary";
import { TimeChart } from "./TimeChart";

export const PRICE_REGION_SETTINGS = "/settings#price-region";

const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const AXIS_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const AXIS_MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const formatDay = (iso: string) => DAY_FMT.format(new Date(dayMs(iso)));

/** IGDB store slug ↔ the market's store, so one row carries both the link and the price. */
const MARKET_STORE: Record<string, LocalPrice["store"]> = { steam: "steam", xbox: "microsoft", gog: "gog" };

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function PriceSection({
  ids,
  name,
  upcoming,
  stores,
  mainHours,
  releaseDates,
  released = null,
  publishers = [],
}: {
  ids: GameIds | null;
  name: string;
  upcoming: boolean;
  stores: StoreRef[];
  /** Main-story hours from IGDB, for cost per hour. */
  mainHours: number | null;
  /** First release (YYYY-MM-DD) and publisher names, for the buying tip. */
  released?: string | null;
  publishers?: string[];
  /** Server-rendered "Release dates" disclosure, when there are any to show. */
  releaseDates?: ReactNode;
}) {
  const [region] = usePriceRegion();
  const latest = useMarket(ids, region);
  const market = useLastReady(latest);
  const gamePass = useLiveField((live) => (live.gamePass && (live.gamePass.console || live.gamePass.pc) ? live.gamePass : null));
  const cloud = usePagePart("cloud");
  const gfn = cloud?.status === "ready" && cloud.data.geforceNow && cloud.data.geforceNow.status !== "not-listed" ? cloud.data.geforceNow : null;
  const refreshing = latest.status === "loading" && market !== null;

  const best = market ? bestPrice(market) : null;
  const free = Boolean(market && market.prices.length > 0 && market.prices.every((price) => price.price === 0));
  const priced = Boolean(market && !free && (best || market.history.length > 0));

  return (
    <DetailSection
      id="prices"
      title="Where to play & price"
      aside={ids ? <RegionPicker /> : undefined}
    >
      <div className="space-y-4">
        <div className={cn("glass overflow-hidden rounded-3xl transition-opacity duration-300", refreshing && "opacity-60")} aria-busy={refreshing || undefined}>
          {ids &&
            (market ? (
              best ? (
                <BestPrice best={best} market={market} free={free} mainHours={mainHours} game={{ released, publishers }} />
              ) : (
                <NoPrice name={name} country={countryName(market.country)} upcoming={upcoming} />
              )
            ) : latest.status === "error" ? (
              <Unavailable onRetry={latest.retry} />
            ) : latest.status === "missing" && region ? (
              <NoPrice name={name} country={countryName(region)} upcoming={upcoming} />
            ) : (
              <PriceSkeleton />
            ))}
          <StoreList stores={stores} market={market} best={best} gamePass={gamePass.state === "ready" ? gamePass.value : null} gfn={gfn} divided={Boolean(ids)} />
        </div>

        {market && priced && <History market={market} />}

        {market && priced && ids && (
          <Disclosure
            icon={<Globe2 size={17} />}
            title="Prices around the world"
            help="regional"
            subtitle={market.currency ? `Steam, converted to ${market.currency} for comparison` : "Regional Steam prices"}
          >
            <RegionalTable market={market} ids={ids} />
          </Disclosure>
        )}

        {region === "US" && <UsDeals />}

        {releaseDates}
      </div>
    </DetailSection>
  );
}

/** Keeps the last good answer on screen while the next one (a new region) loads. */
function useLastReady(state: EndpointState<GameMarket>): GameMarket | null {
  const [last, setLast] = useState<GameMarket | null>(null);
  // Derived state, set during render (React's documented pattern for it).
  if (state.status === "ready" && state.data !== last) setLast(state.data);
  if ((state.status === "missing" || state.status === "error") && last !== null) setLast(null);
  return state.status === "ready" ? state.data : last;
}

/* ------------------------------------------------------------------------ */

/**
 * The region, changeable in place. A native select: it's the platform's own
 * picker on phones (a wheel on iOS, a sheet on Android), fully accessible,
 * and costs nothing. "Automatic" goes back to the detected country.
 */
function RegionPicker() {
  const [region, setRegion, explicit] = usePriceRegion();
  if (!region) return <Skeleton className="h-9 w-40 rounded-full" />;
  const known = PRICE_REGIONS.some((option) => option.code === region);
  return (
    <label className="relative inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-fg/[0.04] pl-3 pr-8 text-[13px] text-muted transition-colors focus-within:border-line-strong fine:hover:border-line-strong coarse:min-h-11">
      <MapPin size={13} aria-hidden className="shrink-0 text-faint" />
      <span>Prices for</span>
      <select
        value={explicit ? region : "auto"}
        onChange={(event) => {
          haptic("selection");
          setRegion(event.target.value === "auto" ? null : event.target.value);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label="Price region"
      >
        <option value="auto">Automatic ({countryName(region)})</option>
        {!known && explicit && <option value={region}>{countryName(region)}</option>}
        {PRICE_REGIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
      <span aria-hidden className="font-semibold text-text">
        {countryName(region)}
      </span>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 text-faint" />
    </label>
  );
}

function BestPrice({
  best,
  market,
  free,
  mainHours,
  game,
}: {
  best: LocalPrice;
  market: GameMarket;
  free: boolean;
  mainHours: number | null;
  game: { released: string | null; publishers: string[] };
}) {
  const verdict = VERDICT[market.verdict.kind];
  const tip = useBuyingTip(market, free ? null : best, game);
  const perHour = !free && mainHours ? valuePerHour(best, mainHours)?.perHour ?? null : null;
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
          {/* The store sells an edition or bundle under its own name: say so, so its price isn't read as the base game's. */}
          {best.productTitle && <p className="mt-0.5 text-[12px] text-faint">{best.productTitle}</p>}
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-[40px] font-bold leading-none tracking-[-0.03em] text-text tabular-nums sm:text-[48px]">
              {free ? "Free to play" : formatMoney(best.price, best.currency, best.country)}
            </span>
            {!free && <DiscountTag percent={best.discount} className="text-[13px]" />}
            {!free && best.initial !== null && best.initial > best.price && (
              <s className="text-[15px] text-faint">{formatMoney(best.initial, best.currency, best.country)}</s>
            )}
          </p>
          {perHour !== null && mainHours && (
            <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
              <span>
                <span className="font-semibold text-text">≈ {formatRate(perHour, best.currency, best.country)} per hour</span> of main story ({hoursLabel(mainHours)})
              </span>
              <InfoTip topic="valuePerHour" />
            </p>
          )}
          {/* "Lowest we've seen" means nothing until we've seen more than one day. */}
          {!free && market.lowest && new Set(market.history.map((point) => point.date)).size > 1 && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted">
              <TrendingDown size={14} className="shrink-0 text-mint" />
              Lowest we&rsquo;ve seen: {formatMoney(market.lowest.price, best.currency, market.country)} on {formatDay(market.lowest.date)}
            </p>
          )}
          {/* A US, all-stores historic marker — never a local price, so it's labelled as exactly that. */}
          {!free && market.lowestEver && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-muted">
              <HistoryIcon size={14} className="mt-[3px] shrink-0 text-faint" aria-hidden />
              <span>
                {market.lowestEver.label}:{" "}
                <span className="font-semibold tabular-nums text-text">{USD.format(market.lowestEver.price / 100)}</span>
                {" · "}
                {MONTH_FMT.format(new Date(`${market.lowestEver.date}T00:00:00Z`))}
              </span>
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

      {!free && tip && <BuyingTipPanel tip={tip} />}
      {/* No tip (a pre-order, say): our history's own call, as before. */}
      {!free && !tip && (
        <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:gap-3">
          <span className="inline-flex items-center gap-1.5">
            <VerdictChip kind={market.verdict.kind} className="w-fit" />
            <InfoTip topic="verdict" />
          </span>
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

/**
 * Every store, as one grouped list. Rows we have a local price for show it;
 * the rest are links. Game Pass joins as a row when the game is in it.
 */
function StoreList({
  stores,
  market,
  best,
  gamePass,
  gfn,
  divided,
}: {
  stores: StoreRef[];
  market: GameMarket | null;
  best: LocalPrice | null;
  gamePass: { console: boolean; pc: boolean; leavingSoon: boolean; recentlyAdded: boolean } | null;
  gfn: GeForceNowMembership | null;
  divided: boolean;
}) {
  const prices = new Map((market?.prices ?? []).map((price) => [price.store, price]));
  const rows: { key: string; icon: ReactNode; name: string; url: string | null; price: LocalPrice | null }[] = stores.map((store) => {
    const price = MARKET_STORE[store.slug] ? prices.get(MARKET_STORE[store.slug]) ?? null : null;
    if (price) prices.delete(price.store);
    return {
      key: `${store.slug}-${store.id}`,
      icon: brandIcon(store.slug) ? <BrandIcon name={store.slug} size={16} tinted title={null} /> : <Store size={16} className="text-faint" />,
      name: store.name,
      url: price?.url ?? store.url ?? (store.domain ? `https://${store.domain}` : null),
      price,
    };
  });
  // Market listings IGDB doesn't know about (often the Microsoft Store).
  for (const price of prices.values()) {
    rows.push({ key: price.store, icon: <StoreMark store={price.store} size={16} />, name: STORE_LABEL[price.store], url: price.url, price });
  }
  // The best price already has the big card; its row would repeat it.
  const listed = rows.filter((row) => row.price !== best || !best);
  if (listed.length === 0 && !gamePass && !gfn) return null;

  return (
    <ul className={cn("divide-y divide-line", divided && "border-t border-line")}>
      {gamePass && (
        <li className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 sm:px-6">
          <BrandIcon name="xbox" size={16} title={null} tinted />
          <span className="min-w-0 flex-1 text-[15px] font-medium text-text">
            Game Pass <span className="text-muted">· {gamePass.console && gamePass.pc ? "Console & PC" : gamePass.console ? "Console" : "PC"}</span>
          </span>
          {gamePass.recentlyAdded && (
            <span className="inline-flex items-center gap-1 rounded-full bg-neon/12 px-2.5 py-1 text-[11px] font-semibold text-neon">
              <Sparkles size={11} /> Just added
            </span>
          )}
          {gamePass.leavingSoon && (
            <span className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/12 px-2.5 py-1 text-[11px] font-semibold text-gold">
              <AlertTriangle size={11} /> Leaving soon
            </span>
          )}
          <span className="text-[13px] font-semibold text-mint">Included</span>
        </li>
      )}
      {gfn && <GeForceNowRow gfn={gfn} />}
      {listed.map((row) => {
        const content = (
          <>
            <span aria-hidden className="grid w-5 shrink-0 place-items-center">{row.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-text">{row.name}</span>
              {row.price?.productTitle && <span className="block truncate text-[12px] text-faint">{row.price.productTitle}</span>}
            </span>
            {row.price && (
              <>
                <DiscountTag percent={row.price.discount} />
                {row.price.initial !== null && row.price.initial > row.price.price && (
                  <s className="hidden text-[13px] text-faint min-[400px]:inline">
                    {formatMoney(row.price.initial, row.price.currency, row.price.country)}
                  </s>
                )}
                <span className="font-semibold tabular-nums text-text">{formatMoney(row.price.price, row.price.currency, row.price.country)}</span>
              </>
            )}
            {row.url && <ArrowUpRight size={14} className="shrink-0 text-faint" aria-hidden />}
          </>
        );
        return (
          <li key={row.key}>
            {row.url ? (
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-14 items-center gap-3 px-5 py-3 transition-colors fine:hover:bg-fg/[0.04] sm:px-6"
              >
                {content}
              </a>
            ) : (
              <div className="flex min-h-14 items-center gap-3 px-5 py-3 sm:px-6">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * GeForce NOW as a "where to play" row: it streams the copy you own on one of
 * NVIDIA's listed stores. Maintenance or patching is NVIDIA's own status,
 * said plainly rather than hidden.
 */
function GeForceNowRow({ gfn }: { gfn: GeForceNowMembership }) {
  const stores = gfn.stores.length > 0 ? gfn.stores : gfn.store ? [gfn.store] : [];
  const status =
    gfn.status === "available"
      ? { text: "Play in the cloud", className: "text-mint" }
      : gfn.status === "maintenance"
        ? { text: "Under maintenance", className: "text-gold" }
        : { text: "Updating", className: "text-gold" };
  return (
    <li>
      <a
        href="https://play.geforcenow.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-14 items-center gap-3 px-5 py-3 transition-colors fine:hover:bg-fg/[0.04] sm:px-6"
      >
        <span aria-hidden className="grid w-5 shrink-0 place-items-center">
          <BrandIcon name="nvidia" size={16} tinted title={null} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-text">GeForce NOW</span>
          {stores.length > 0 && <span className="block truncate text-[12px] text-faint">via {stores.slice(0, 3).join(", ")}</span>}
        </span>
        <span className={cn("shrink-0 text-[13px] font-semibold", status.className)}>{status.text}</span>
        <ArrowUpRight size={14} className="shrink-0 text-faint" aria-hidden />
      </a>
    </li>
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
                {option === "microsoft" ? "Microsoft" : STORE_LABEL[option]}
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

function RegionalTable({ market, ids }: { market: GameMarket; ids: GameIds }) {
  const [all, setAll] = useState(false);
  // Regional prices may come with the main response; otherwise they're only
  // fetched now that someone has opened the comparison.
  const fetched = useEndpoint<GameMarket>(market.regional.length === 0 ? marketUrl(ids, market.country, true) : null);
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
  // The reader's own Steam price is the yardstick for "% vs you".
  const yours = converted.find((row) => row.country === market.country)?.converted ?? null;
  const versus = (row: RegionalPrice) =>
    yours && row.converted !== null && row.country !== market.country ? Math.round(((row.converted - yours) / yours) * 100) : null;
  const cheapestRow = converted[0] && converted[0].country !== market.country ? converted[0] : null;
  const saving = cheapestRow ? versus(cheapestRow) : null;
  // Collapsed, the reader's own row still shows (last, in rank order) — it's the yardstick for every "%".
  const head = rows.slice(0, 8);
  const own = rows.find((row) => row.country === market.country);
  const shown = all ? rows : own && !head.includes(own) ? [...head.slice(0, 7), own] : head;

  if (!source) {
    return fetched.status === "error" || fetched.status === "missing" ? (
      <p className="py-2 text-[13px] text-muted">Regional prices aren&rsquo;t available right now.</p>
    ) : (
      <div aria-hidden className="space-y-3 py-1">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) return <p className="py-2 text-[13px] text-muted">Steam doesn&rsquo;t list this game in other regions.</p>;

  return (
    <>
      {cheapestRow && saving !== null && saving <= -5 && (
        <p className="mb-2 text-[14px] leading-snug text-text">
          Cheapest in <span className="font-semibold">{countryName(cheapestRow.country)}</span>:{" "}
          <span className="font-semibold tabular-nums text-mint">{Math.abs(saving)}% less</span> than your price.
        </p>
      )}
      {yours !== null && converted.length > 1 && cheapestRow === null && (
        <p className="mb-2 text-[14px] leading-snug text-text">Your region is already the cheapest of these.</p>
      )}
      <p className="mb-3 text-[12px] leading-snug text-faint">
        Each store charges in its own currency (shown small). Bars compare them converted to {currency} at
        today&rsquo;s exchange rate — a guide, not a price you can pay: Steam charges the price of your account&rsquo;s own region.
      </p>
      <ul className="divide-y divide-line">
        {shown.map((row) => {
          const isCheapest = row.country === cheapest;
          const isYou = row.country === market.country;
          return (
            <li
              key={row.country}
              aria-current={isYou || undefined}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5",
                // The reader's row reads as theirs at a glance, without moving the columns.
                isYou && "-mx-2 rounded-xl border-transparent bg-[color-mix(in_oklab,var(--game-accent,var(--color-brand))_9%,transparent)] px-2",
              )}
            >
              <span className="flex min-w-0 items-center gap-2 text-[14px] text-text">
                <span className="w-7 shrink-0 text-[11px] font-semibold tabular-nums text-faint">{row.country}</span>
                <span className="truncate">{countryName(row.country)}</span>
                {isCheapest && <span className="shrink-0 rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-bold text-mint">Cheapest</span>}
                {isYou && <span className="shrink-0 rounded-full bg-fg/[0.08] px-2 py-0.5 text-[10px] font-bold text-muted">You</span>}
              </span>
              <span className="flex items-baseline justify-end gap-2 text-right">
                {versus(row) !== null && (
                  <span
                    className={cn(
                      "text-[11px] font-semibold tabular-nums",
                      versus(row)! <= -5 ? "text-mint" : versus(row)! >= 5 ? "text-faint" : "text-muted",
                    )}
                  >
                    <span className="sr-only">compared with your price: </span>
                    {versus(row) === 0 ? "same" : `${versus(row)! > 0 ? "+" : "−"}${Math.abs(versus(row)!)}%`}
                  </span>
                )}
                <span className="text-[14px] font-semibold tabular-nums text-text">
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
  );
}

/** US readers also get CheapShark's PC key-store deals — US prices, so only for them. */
function UsDeals() {
  const deals = useLiveField((live) => (live.deals && live.deals.stores.length > 0 ? live.deals : null));
  if (deals.state !== "ready") return null;
  const usd = (n: number) => (n === 0 ? "Free" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n));
  const cheapest = deals.value.cheapest;
  return (
    <Disclosure
      icon={<Store size={17} />}
      title="Other PC stores"
      subtitle={cheapest ? `From ${usd(cheapest.price)} at ${cheapest.store} · US prices via CheapShark` : "US prices via CheapShark"}
    >
      <ul className="divide-y divide-line">
        {deals.value.stores.slice(0, 8).map((deal) => (
          <li key={`${deal.store}-${deal.url}`}>
            <a
              href={deal.url}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="flex min-h-12 items-center gap-3 py-2 text-[14px] transition-colors fine:hover:text-text"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-text">{deal.store}</span>
              <DiscountTag percent={deal.savings} />
              <span className="font-semibold tabular-nums text-text">{usd(deal.price)}</span>
              <ArrowUpRight size={13} className="shrink-0 text-faint" />
            </a>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/* ------------------------------------------------------------------------ */

function PriceSkeleton() {
  return (
    <div aria-hidden className="p-5 sm:p-6">
      <Skeleton className="h-3.5 w-28 rounded-full" />
      <Skeleton className="mt-3 h-11 w-44 rounded-xl" />
      <Skeleton className="mt-3 h-3.5 w-56 rounded-full" />
      <div className="mt-5 border-t border-line pt-4">
        <Skeleton className="h-7 w-36 rounded-full" />
      </div>
    </div>
  );
}

function NoPrice({ name, country, upcoming }: { name: string; country: string; upcoming: boolean }) {
  return (
    <div className="flex items-start gap-3 p-5 sm:p-6">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-fg/[0.06] text-faint">
        <BadgePercent size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-text">{upcoming ? `Not on sale in ${country} yet` : `No store price for ${country}`}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted">
          {upcoming
            ? `Steam and the Microsoft Store haven't listed a price for ${name} here. Follow it to hear when pre-orders open.`
            : `${name} isn't sold on Steam or the Microsoft Store in ${country}, or the store hides its price.`}
        </p>
      </div>
    </div>
  );
}

function Unavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:p-6">
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
