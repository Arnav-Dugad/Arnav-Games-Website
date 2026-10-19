"use client";

/**
 * "At a glance" — the bento grid under the hero.
 *
 * Mixed-size glass tiles, each answering one question (Is it good? How long
 * is it? Is anyone playing? What does it cost? Where can I play it?). The rule
 * that keeps it honest: a tile renders only when its source has something to
 * say. Server facts decide up front; live tiles show a skeleton of their own
 * shape while loading, then either morph into content or fold away — the
 * grid reflows around them (`layout`), so a missing source never leaves a hole
 * or a "No data" card behind.
 *
 * 2 columns on a phone, 4 from `lg`. Rows are packed explicitly (see
 * `packRows`): whichever tiles exist, the last tile in each row widens to fill
 * it, so a missing source never leaves a hole in the grid.
 */

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  BadgePercent,
  CalendarDays,
  ExternalLink,
  Flame,
  Gamepad2,
  Hourglass,
  MonitorSmartphone,
  Radio,
  Sparkles,
  Star,
  Store,
  TrendingDown,
  Users,
} from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { brandIcon } from "@/components/brand/brand-icons";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { cn } from "@/lib/utils/cn";
import { compactNumber, formatDate } from "@/lib/utils/format";
import { usePriceRegion } from "@/lib/preferences/region";
import type { GameLiveData, GameMarket, HypeIndex, LocalPrice, Ref, StoreRef, TimeToBeat } from "@/lib/games/types";
import { marketUrl, useEndpoint, type GameIds } from "./endpoint";
import { useLiveField } from "./live";
import { bestPrice, DiscountTag, STORE_LABEL, StoreMark, VerdictChip } from "./market-ui";
import { countryName, formatMoney } from "./money";

export interface BentoData {
  name: string;
  critic: { score: number | null; label: string; caption: string };
  userRating: { rating: number; count: number } | null;
  hasSteam: boolean;
  canHaveGamePass: boolean;
  timeToBeat: TimeToBeat | null;
  howLongToBeatUrl: string | null;
  hype: HypeIndex | null;
  platforms: Ref[];
  release: {
    label: string;
    sublabel: string | null;
    region: string | null;
    delays: number;
    upcoming: boolean;
  };
  stores: StoreRef[];
  /** Store ids for local prices; null when the game has no Steam or Microsoft listing. */
  market: GameIds | null;
  /** Whether the Stats section exists to link to. */
  hasStats: boolean;
}

export function GameBento({ data }: { data: BentoData }) {
  const calm = useCalmMotion();
  const reviews = useLiveField((live) => live.steamReviews);
  const players = useLiveField((live) => live.steamPlayers);
  const twitch = useLiveField((live) => (live.twitch && live.twitch.streams > 0 ? live.twitch : null));
  const deals = useLiveField((live) => live.deals?.cheapest ? live.deals : null);
  const [region] = usePriceRegion();
  const market = useEndpoint<GameMarket>(data.market && region ? marketUrl(data.market, region) : null);
  const local = market.status === "ready" ? bestPrice(market.data) : null;
  const gamePass = useLiveField((live) => live.gamePass);

  const hasCritic = data.critic.score !== null || data.userRating !== null;
  const tiles: TileSpec[] = [];

  if (hasCritic || (data.hasSteam && reviews.state !== "empty")) {
    tiles.push({ key: "critic", span: [2, 2], node: <CriticTile data={data} reviews={reviews} /> });
  }
  tiles.push({ key: "release", span: [1, 1], node: <ReleaseTile release={data.release} /> });
  if (data.hasSteam && players.state !== "empty") {
    tiles.push({ key: "players", span: [1, 1], node: <PlayersTile players={players} hasStats={data.hasStats} /> });
  }
  const ttb = data.timeToBeat;
  if (ttb && (ttb.hastily || ttb.normally || ttb.completely)) {
    tiles.push({ key: "ttb", span: [2, 2], node: <TimeToBeatTile ttb={ttb} url={data.howLongToBeatUrl} /> });
  }
  // Local store prices for the reader's region. CheapShark's PC deals are US
  // prices, so they only stand in for readers in the US — anyone else would
  // be shown dollars they can't pay.
  const marketPending = Boolean(data.market) && (!region || market.status === "loading");
  if (local && market.status === "ready") {
    tiles.push({ key: "price", span: [1, 1], node: <LocalPriceTile price={local} market={market.data} /> });
  } else if (marketPending) {
    tiles.push({ key: "price", span: [1, 1], node: <PriceSkeletonTile /> });
  } else if (region === "US" && deals.state !== "empty") {
    tiles.push({ key: "price", span: [1, 1], node: <PriceTile deals={deals} name={data.name} /> });
  }
  if (data.hype && data.release.upcoming) {
    tiles.push({ key: "hype", span: [1, 1], node: <HypeTile hype={data.hype} /> });
  }
  if (data.platforms.length > 0) {
    tiles.push({
      key: "platforms",
      span: [data.platforms.length > 3 ? 2 : 1, 1],
      node: <PlatformsTile platforms={data.platforms} upcoming={data.release.upcoming} />,
    });
  }

  if (twitch.state !== "empty") {
    tiles.push({ key: "twitch", span: [2, 2], node: <TwitchTile twitch={twitch} /> });
  }
  const passOn = gamePass.state === "ready" && (gamePass.value.console || gamePass.value.pc);
  if (data.stores.length > 0 || passOn || (data.canHaveGamePass && gamePass.state === "loading")) {
    tiles.push({ key: "where", span: [2, 2], node: <WhereToPlayTile stores={data.stores} gamePass={gamePass} /> });
  }
  const mobile = packRows(tiles.map((tile) => tile.span[0]), 2);
  const desktop = packRows(tiles.map((tile) => tile.span[1]), 4);

  return (
    <LayoutGroup>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <AnimatePresence initial={false} mode="popLayout">
          {tiles.map((tile, index) => (
            <motion.div
              key={tile.key}
              layout={calm ? false : "position"}
              initial={calm ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={calm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              className={cn(MOBILE_SPAN[mobile[index]], DESKTOP_SPAN[desktop[index]], "min-w-0")}
            >
              {tile.node}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}

/* ------------------------------------------------------------------------ */

interface TileSpec {
  key: string;
  /** Preferred column span: [phone (of 2), desktop (of 4)]. */
  span: [number, number];
  node: ReactNode;
}

// Literal class names, so Tailwind can see every one of them.
const MOBILE_SPAN: Record<number, string> = { 1: "col-span-1", 2: "col-span-2" };
const DESKTOP_SPAN: Record<number, string> = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4" };

/**
 * Lays tiles into rows in order and widens the last tile of every row to
 * close the gap. Order is preserved (unlike `grid-flow-dense`), so the
 * reading order and the visual order always agree.
 */
export function packRows(spans: number[], columns: number): number[] {
  const out = spans.map((span) => Math.min(span, columns));
  let used = 0;
  let last = -1;
  out.forEach((span, index) => {
    if (used + span > columns && last >= 0) {
      out[last] += columns - used;
      used = 0;
    }
    used += span;
    last = index;
    if (used === columns) used = 0;
  });
  if (used > 0 && last >= 0) out[last] += columns - used;
  return out;
}

type Field<T> = ReturnType<typeof useLiveField<T>>;

function Tile({
  icon,
  label,
  children,
  className,
  glow = false,
  aside,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  className?: string;
  glow?: boolean;
  aside?: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn("glass relative isolate flex h-full min-h-[148px] flex-col overflow-hidden rounded-3xl p-4 sm:p-5", className)}
    >
      {glow && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 -z-10 h-48 w-48 rounded-full bg-[var(--game-glow)] opacity-70 blur-3xl"
        />
      )}
      <header className="mb-3 flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
          <span className="shrink-0 text-[var(--game-accent)]">{icon}</span>
          <span className="truncate">{label}</span>
        </p>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** Fades fresh content in over where the skeleton sat. */
function Morph({ children, className }: { children: ReactNode; className?: string }) {
  const calm = useCalmMotion();
  return (
    <motion.div
      initial={calm ? false : { opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function LiveDot() {
  return (
    <span aria-hidden className="relative flex h-2 w-2">
      <span className="absolute inset-0 animate-ping rounded-full bg-flare/70 [animation-duration:1.8s]" />
      <span className="relative h-2 w-2 rounded-full bg-flare" />
    </span>
  );
}

const fullNumber = (n: number) => new Intl.NumberFormat("en-US").format(n);
const usd = (n: number) => (n === 0 ? "Free" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n));

function reviewTone(percent: number) {
  return percent >= 70 ? "var(--color-mint)" : percent >= 40 ? "var(--color-gold)" : "var(--color-flare)";
}

/* ------------------------------------------------------------------------ */

function CriticTile({ data, reviews }: { data: BentoData; reviews: Field<NonNullable<GameLiveData["steamReviews"]>> }) {
  const { critic, userRating } = data;
  return (
    <Tile icon={<Star size={13} />} label="Reviews" glow>
      <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        {(critic.score !== null || userRating) && (
          <div className="flex items-center gap-4">
            {critic.score !== null && <ScoreRing score={critic.score} size={84} strokeWidth={6} label={critic.label} />}
            <div className="min-w-0">
              {critic.score !== null && (
                <>
                  <p className="text-sm font-semibold text-text">{critic.label}</p>
                  <p className="text-xs text-muted">{critic.caption}</p>
                </>
              )}
              {userRating && (
                <p className={cn("flex items-center gap-1.5 whitespace-nowrap text-sm text-muted", critic.score !== null && "mt-2")}>
                  <Star size={13} className="shrink-0 fill-gold text-gold" />
                  <span className="font-semibold tabular-nums text-text">{userRating.rating.toFixed(1)}/5</span>
                  {userRating.count > 0 && <span className="text-faint">· {compactNumber(userRating.count)} players</span>}
                </p>
              )}
            </div>
          </div>
        )}

        {data.hasSteam && reviews.state !== "empty" && (
          <div className={cn("min-w-0 flex-1", (critic.score !== null || userRating) && "border-t border-line pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0")}>
            {reviews.state === "loading" ? (
              <div aria-hidden className="space-y-2.5">
                <Skeleton className="h-3 w-24 rounded-full" />
                <Skeleton className="h-5 w-36 rounded-full" />
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ) : (
              <Morph>
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
                  <BrandIcon name="steam" size={11} title={null} /> Steam players
                </p>
                <p className="mt-1 text-lg font-bold leading-tight" style={{ color: reviewTone(reviews.value.percent) }}>
                  {reviews.value.description || `${reviews.value.percent}% positive`}
                </p>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-fg/10" aria-hidden>
                  <div className="h-full rounded-full" style={{ width: `${reviews.value.percent}%`, background: reviewTone(reviews.value.percent) }} />
                </div>
                <p className="mt-1.5 text-xs text-muted tabular-nums">
                  {reviews.value.percent}% of {compactNumber(reviews.value.total)} reviews positive
                </p>
              </Morph>
            )}
          </div>
        )}
      </div>
    </Tile>
  );
}

function ReleaseTile({ release }: { release: BentoData["release"] }) {
  return (
    <Tile icon={<CalendarDays size={13} />} label={release.region ? `Release · ${release.region}` : "Release"}>
      <p className="font-display text-xl font-bold leading-tight text-text sm:text-2xl">{release.label}</p>
      {release.sublabel && <p className="mt-1 text-sm text-muted">{release.sublabel}</p>}
      {release.delays > 0 && (
        <a
          href="#release-dates"
          className="mt-auto inline-flex w-fit items-center gap-1 self-start rounded-full border border-flare/30 bg-flare/12 px-2.5 py-1 text-[11px] font-semibold text-flare"
        >
          Delayed {release.delays}×
        </a>
      )}
    </Tile>
  );
}

function PlayersTile({ players, hasStats }: { players: Field<number>; hasStats: boolean }) {
  return (
    <Tile icon={<Users size={13} />} label="Playing now" aside={players.state === "ready" ? <LiveDot /> : null}>
      {players.state === "ready" ? (
        <Morph className="flex flex-1 flex-col">
          <p className="font-display text-[28px] font-bold leading-none tabular-nums text-text sm:text-[32px]">
            {players.value >= 100_000 ? compactNumber(players.value) : fullNumber(players.value)}
          </p>
          <p className="mt-2 text-xs text-muted">
            in-game on Steam right now
          </p>
          {hasStats && (
            <a href="#stats" className="mt-auto pt-3 text-[12px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))] underline-offset-2 hover:underline">
              Player history
            </a>
          )}
        </Morph>
      ) : (
        <div aria-hidden className="space-y-2.5">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-3 w-28 rounded-full" />
        </div>
      )}
    </Tile>
  );
}

function TimeToBeatTile({ ttb, url }: { ttb: TimeToBeat; url: string | null }) {
  const rows = [
    { label: "Main story", hours: ttb.hastily },
    { label: "Main + extras", hours: ttb.normally },
    { label: "Completionist", hours: ttb.completely },
  ].filter((row): row is { label: string; hours: number } => typeof row.hours === "number" && row.hours > 0);
  const max = Math.max(...rows.map((row) => row.hours));
  const hours = (h: number) => (h >= 10 ? `${Math.round(h)} h` : `${Math.round(h * 2) / 2} h`);

  return (
    <Tile
      icon={<Hourglass size={13} />}
      label="Time to beat"
      aside={
        url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-muted transition-colors hover:text-text">
            HowLongToBeat <ExternalLink size={11} />
          </a>
        ) : null
      }
    >
      <ul className="flex flex-1 flex-col justify-center gap-3">
        {rows.map((row, index) => (
          <li key={row.label} className="grid grid-cols-[minmax(0,6.5rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-muted">{row.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-fg/[0.08]" aria-hidden>
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(6, (row.hours / max) * 100)}%`,
                  background: `color-mix(in oklab, var(--game-accent) ${100 - index * 22}%, transparent)`,
                }}
              />
            </span>
            <span className="font-semibold tabular-nums text-text">{hours(row.hours)}</span>
          </li>
        ))}
      </ul>
      {ttb.count > 0 && (
        <p className="mt-3 text-[11px] text-faint">
          From {fullNumber(ttb.count)} player {ttb.count === 1 ? "submission" : "submissions"} on IGDB
        </p>
      )}
    </Tile>
  );
}

function PriceSkeletonTile() {
  return (
    <Tile icon={<BadgePercent size={13} />} label="Price">
      <div aria-hidden className="space-y-2.5">
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-3 w-28 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </Tile>
  );
}

/** The cheapest local listing, in the store's own currency, with the buy/wait call. */
function LocalPriceTile({ price, market }: { price: LocalPrice; market: GameMarket }) {
  const free = price.price === 0;
  return (
    <Tile icon={<BadgePercent size={13} />} label={`Price · ${countryName(market.country)}`}>
      <Morph className="flex flex-1 flex-col">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-display text-[26px] font-bold leading-none text-text sm:text-[28px]">
            {free ? "Free" : formatMoney(price.price, price.currency, price.country)}
          </span>
          {!free && <DiscountTag percent={price.discount} />}
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-muted">
          <StoreMark store={price.store} size={12} />
          {STORE_LABEL[price.store]}
          {!free && price.initial !== null && price.initial > price.price && (
            <s className="text-faint">{formatMoney(price.initial, price.currency, price.country)}</s>
          )}
        </p>
        {!free && market.verdict.kind !== "unknown" && <VerdictChip kind={market.verdict.kind} short className="mt-3 w-fit" />}
        <a href="#prices" className="mt-auto pt-3 text-[12px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))] underline-offset-2 hover:underline">
          {free ? "Store details" : "Price history"}
        </a>
      </Morph>
    </Tile>
  );
}

function PriceTile({ deals, name }: { deals: Field<NonNullable<GameLiveData["deals"]>>; name: string }) {
  const [open, setOpen] = useState(false);
  // Mounted on first open, then kept so the sheet can animate out.
  const [sheetMounted, setSheetMounted] = useState(false);
  if (deals.state !== "ready") {
    return (
      <Tile icon={<BadgePercent size={13} />} label="Best price">
        <div aria-hidden className="space-y-2.5">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-3 w-28 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
      </Tile>
    );
  }
  const { cheapest, stores, historicalLow } = deals.value;
  if (!cheapest) return null;

  return (
    <Tile icon={<BadgePercent size={13} />} label="Best PC price · US">
      <Morph className="flex flex-1 flex-col">
        <a href={cheapest.url} target="_blank" rel="noopener noreferrer sponsored" className="group">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-[28px] font-bold leading-none tabular-nums text-text">{usd(cheapest.price)}</span>
            {cheapest.savings >= 1 && (
              <span className="rounded-md bg-mint/15 px-1.5 py-0.5 text-[11px] font-bold text-mint">−{Math.round(cheapest.savings)}%</span>
            )}
          </p>
          <p className="mt-1.5 truncate text-xs text-muted group-hover:text-text">
            at {cheapest.store}
            {cheapest.retail > cheapest.price && <span className="text-faint"> · <s>{usd(cheapest.retail)}</s></span>}
          </p>
        </a>
        {historicalLow && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-faint">
            <TrendingDown size={12} className="shrink-0" />
            Lowest ever {usd(historicalLow.price)}
            {historicalLow.date && <span className="hidden sm:inline">· {formatDate(historicalLow.date)}</span>}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {stores.length > 1 ? (
            <button
              type="button"
              onClick={() => {
                setSheetMounted(true);
                setOpen(true);
              }}
              className="press rounded-full bg-fg/[0.07] px-3 py-1.5 text-xs font-semibold text-text transition-colors fine:hover:bg-fg/[0.12]"
            >
              All {stores.length} stores
            </button>
          ) : <span />}
          <span className="text-[10px] text-faint">via CheapShark</span>
        </div>
      </Morph>
      {/* Portalled: the tile is a transformed, clipped layout item, which
          would trap a fixed-position sheet inside it. */}
      {sheetMounted && createPortal(
      <Sheet open={open} onClose={() => setOpen(false)} title={`${name} prices`} description="PC store prices in USD. Prices via CheapShark.">
        <ul className="space-y-1.5 pb-2">
          {stores.map((deal) => (
            <li key={`${deal.store}-${deal.url}`}>
              <a
                href={deal.url}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 text-sm transition-colors hover:border-line-strong hover:bg-fg/[0.04]"
              >
                <Store size={15} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate font-medium">{deal.store}</span>
                {deal.savings >= 1 && <span className="rounded-md bg-mint/15 px-1.5 py-0.5 text-[11px] font-bold text-mint">−{Math.round(deal.savings)}%</span>}
                <span className="font-semibold tabular-nums">{usd(deal.price)}</span>
                <ExternalLink size={13} className="shrink-0 text-faint" />
              </a>
            </li>
          ))}
        </ul>
        <p className="pt-2 text-[11px] text-faint">
          Prices via <a href="https://www.cheapshark.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">CheapShark</a>. Links go through CheapShark&rsquo;s store redirect.
        </p>
      </Sheet>,
      document.body,
      )}
    </Tile>
  );
}

function HypeTile({ hype }: { hype: HypeIndex }) {
  const score = Math.max(0, Math.min(100, Math.round(hype.score)));
  // A 240° gauge: the gap at the bottom is where the eye expects "empty".
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * (240 / 360);
  const calm = useCalmMotion();
  return (
    <Tile icon={<Flame size={13} />} label="Hype index" glow>
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="relative h-[92px] w-[100px]" role="img" aria-label={`Hype index ${score} out of 100`}>
          <svg viewBox="0 0 100 100" className="h-[100px] w-[100px] rotate-[150deg]" aria-hidden>
            <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${arc} ${circumference}`} className="text-fg/10" />
            <motion.circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="var(--game-accent)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${arc} ${circumference}`}
              initial={calm ? false : { strokeDashoffset: arc }}
              whileInView={{ strokeDashoffset: arc * (1 - score / 100) }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: calm ? 0 : 1.2, ease: [0.16, 1, 0.3, 1] }}
              style={{ filter: "drop-shadow(0 0 6px var(--game-glow))" }}
            />
          </svg>
          <span className="absolute inset-x-0 top-[34px] text-center font-display text-[28px] font-bold leading-none tabular-nums text-text">{score}</span>
        </div>
        <p className="mt-1 text-center text-[11px] text-muted">
          {hype.signals.hypes > 0 ? `${compactNumber(hype.signals.hypes)} following on IGDB` : "Attention across IGDB"}
        </p>
      </div>
    </Tile>
  );
}

function TwitchTile({ twitch }: { twitch: Field<NonNullable<GameLiveData["twitch"]>> }) {
  if (twitch.state !== "ready") {
    return (
      <Tile icon={<Radio size={13} />} label="Live on Twitch">
        <div aria-hidden className="flex gap-4">
          <div className="space-y-2.5">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-3 w-24 rounded-full" />
          </div>
          <Skeleton className="ml-auto aspect-video w-28 rounded-xl" />
        </div>
      </Tile>
    );
  }
  const { viewers, streams, top } = twitch.value;
  return (
    <Tile icon={<BrandIcon name="twitch" size={12} title={null} />} label="Live on Twitch" aside={<LiveDot />}>
      <Morph className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex gap-6">
          <div>
            <p className="font-display text-[28px] font-bold leading-none tabular-nums text-text">{compactNumber(viewers)}</p>
            <p className="mt-1.5 text-xs text-muted">watching</p>
          </div>
          <div>
            <p className="font-display text-[28px] font-bold leading-none tabular-nums text-text">{compactNumber(streams)}</p>
            <p className="mt-1.5 text-xs text-muted">{streams === 1 ? "stream" : "streams"}</p>
          </div>
        </div>
        {top.length > 0 && (
          <ul className="grid min-w-0 flex-1 grid-cols-3 gap-2">
            {top.slice(0, 3).map((stream) => (
              <li key={stream.url} className="min-w-0">
                <a href={stream.url} target="_blank" rel="noopener noreferrer" title={`${stream.user}: ${stream.title}`} className="group block">
                  <span className="relative block aspect-video overflow-hidden rounded-lg bg-fg/[0.06]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- Twitch's preview CDN isn't a configured image host and these refresh every few minutes. */}
                    <img src={stream.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 fine:group-hover:scale-105" />
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[9px] font-semibold tabular-nums text-white">{compactNumber(stream.viewers)}</span>
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-muted group-hover:text-text">{stream.user}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Morph>
    </Tile>
  );
}

function WhereToPlayTile({ stores, gamePass }: { stores: StoreRef[]; gamePass: Field<NonNullable<GameLiveData["gamePass"]>> }) {
  const pass = gamePass.state === "ready" ? gamePass.value : null;
  const passOn = Boolean(pass && (pass.console || pass.pc));
  return (
    <Tile icon={<Gamepad2 size={13} />} label="Where to play">
      <div className="flex flex-1 flex-col gap-3">
        {passOn && pass && (
          <Morph className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-mint/30 bg-mint/10 px-3 py-1.5 text-xs font-semibold text-text">
              <BrandIcon name="xbox" size={13} title={null} tinted />
              Game Pass
              <span className="text-muted">
                {pass.console && pass.pc ? "Console & PC" : pass.console ? "Console" : "PC"}
              </span>
            </span>
            {pass.recentlyAdded && (
              <span className="inline-flex items-center gap-1 rounded-full bg-neon/12 px-2.5 py-1 text-[11px] font-semibold text-neon">
                <Sparkles size={11} /> Just added
              </span>
            )}
            {pass.leavingSoon && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/12 px-2.5 py-1 text-[11px] font-semibold text-gold">
                <AlertTriangle size={11} /> Leaving Game Pass soon
              </span>
            )}
          </Morph>
        )}
        {gamePass.state === "loading" && stores.length === 0 && (
          <Skeleton className="h-8 w-44 rounded-full" />
        )}
        {stores.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {stores.map((store) => (
              <li key={`${store.slug}-${store.id}`}>
                <a
                  href={store.url ?? `https://${store.domain ?? ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="press inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-fg/[0.04] px-3.5 text-[13px] font-medium text-text transition-colors fine:hover:border-line-strong fine:hover:bg-fg/[0.08]"
                >
                  {brandIcon(store.slug) ? <BrandIcon name={store.slug} size={14} tinted title={null} /> : <Store size={14} className="text-faint" />}
                  {store.name}
                  <ExternalLink size={11} className="text-faint" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Tile>
  );
}

function PlatformsTile({ platforms, upcoming }: { platforms: Ref[]; upcoming: boolean }) {
  return (
    <Tile icon={<MonitorSmartphone size={13} />} label={upcoming ? "Coming to" : "Platforms"}>
      <PlatformIcons platforms={platforms} size={20} max={8} tinted />
      <p className="mt-3 text-sm leading-snug text-muted">{platforms.map((platform) => platform.name).join(", ")}</p>
    </Tile>
  );
}
