"use client";

/**
 * "At a glance": what a first-time visitor needs in five seconds.
 *
 * One plain sentence ("Acclaimed open-world action RPG from FromSoftware ·
 * 96 from critics · about 55 h to beat · ₹3,599 on Steam"), then three to five
 * big labelled facts, each with an ⓘ that says what the number means. It
 * replaces the old bento of nine tiles: that answered every question at the
 * same volume, so nothing stood out. The deep versions of each fact live in
 * the sections below; this block only answers "what is it, is it good, how
 * long, what does it cost, when/where can I play it".
 *
 * Server facts decide most of it. The live pieces (Steam reviews, players
 * now, the local price) hold their slot with a skeleton while loading, then
 * fill in or fold away — a missing source never leaves a "No data" cell.
 */

import { useMemo, type ReactNode } from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils/cn";
import { compactNumber, scoreColor } from "@/lib/utils/format";
import { valuePerHour } from "@/lib/games/market-rules";
import type { Ref } from "@/lib/games/types";
import type { GameIds } from "./endpoint";
import type { HelpTopic } from "./glossary";
import { InfoTip } from "./InfoTip";
import { useLiveField } from "./live";
import { DiscountTag, STORE_LABEL, useLocalMarket } from "./market-ui";
import { formatMoney, formatRate } from "./money";
import { hoursLabel, hoursParts } from "./summary";

export interface GlanceData {
  /** "Acclaimed open-world action RPG from FromSoftware" (see `describeGame`). */
  descriptor: string;
  critic: { score: number; label: string } | null;
  userRating: { rating: number; count: number } | null;
  hasSteam: boolean;
  release: { label: string; relative: string | null; upcoming: boolean; delays: number };
  /**
   * The length to quote: IGDB's main story, else main + extras, else a
   * median "typical playtime". Only the main story is used for cost per hour.
   */
  hours: { value: number; kind: "main" | "extras" | "typical" } | null;
  hype: { score: number; follows: number } | null;
  market: GameIds | null;
  platforms: Ref[];
}

interface FactSpec {
  key: string;
  label: string;
  help?: HelpTopic;
  /** null = still loading: the cell keeps its place with a skeleton. */
  value: ReactNode | null;
  caption?: ReactNode;
}

const reviewColor = (percent: number) =>
  percent >= 70 ? "var(--color-mint)" : percent >= 40 ? "var(--color-gold)" : "var(--color-flare)";

export function AtAGlance({ data }: { data: GlanceData }) {
  const reviews = useLiveField((live) => live.steamReviews);
  const players = useLiveField((live) => live.steamPlayers);
  const gamePass = useLiveField((live) => (live.gamePass && (live.gamePass.console || live.gamePass.pc) ? live.gamePass : null));
  const { best, pending } = useLocalMarket(data.market);
  const free = best?.price === 0;
  const perHour = best && !free && data.hours?.kind === "main" ? valuePerHour(best, data.hours.value)?.perHour ?? null : null;

  const facts = useMemo(() => {
    const list: FactSpec[] = [];
    const critic: FactSpec | null = data.critic
      ? {
          key: "critic",
          label: "Critics",
          help: "critic",
          value: <Score value={data.critic.score} unit="/100" colour={scoreColor(data.critic.score)} />,
          caption: data.critic.label,
        }
      : null;

    // Steam's own verdict is the larger, fresher crowd; IGDB's rating stands in without it.
    let crowd: FactSpec | null = null;
    if (data.hasSteam && reviews.state !== "empty") {
      crowd =
        reviews.state === "loading"
          ? { key: "players", label: "Players", help: "steamReviews", value: null }
          : {
              key: "players",
              label: "Players",
              help: "steamReviews",
              value: <Score value={`${reviews.value.percent}%`} colour={reviewColor(reviews.value.percent)} />,
              caption: `${reviews.value.description || "Positive"} · ${compactNumber(reviews.value.total)} Steam reviews`,
            };
    } else if (data.userRating) {
      crowd = {
        key: "players",
        label: "Players",
        help: "playerRating",
        value: <Score value={data.userRating.rating.toFixed(1)} unit="/5" />,
        caption: data.userRating.count > 0 ? `${compactNumber(data.userRating.count)} ratings` : "IGDB rating",
      };
    }

    const length: FactSpec | null = data.hours
      ? {
          key: "length",
          label: "Length",
          help: data.hours.kind === "typical" ? undefined : "timeToBeat",
          value: <Score value={hoursParts(data.hours.value)[0]} unit={hoursParts(data.hours.value)[1]} />,
          caption: { main: "main story", extras: "main + extras", typical: "typical playtime" }[data.hours.kind],
        }
      : null;

    let price: FactSpec | null = null;
    if (data.market && pending) price = { key: "price", label: "Price", value: null };
    else if (best) {
      price = {
        key: "price",
        label: "Price",
        help: perHour ? "valuePerHour" : undefined,
        value: (
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            <Score value={free ? "Free" : formatMoney(best.price, best.currency, best.country)} />
            {!free && <DiscountTag percent={best.discount} />}
          </span>
        ),
        caption: perHour ? `${STORE_LABEL[best.store]} · ≈ ${formatRate(perHour, best.currency, best.country)}/h` : STORE_LABEL[best.store],
      };
    }

    const release: FactSpec = {
      key: "release",
      label: data.release.upcoming ? "Release" : "Released",
      value: <Score value={data.release.label} small />,
      caption: data.release.delays > 0 ? (
        <a href="#prices" className="font-semibold text-flare">
          Delayed {data.release.delays}×{data.release.relative ? ` · ${data.release.relative}` : ""}
        </a>
      ) : (
        data.release.relative ?? undefined
      ),
    };

    const hype: FactSpec | null = data.hype
      ? {
          key: "hype",
          label: "Hype",
          help: "hype",
          value: <Score value={Math.round(data.hype.score)} unit="/100" />,
          caption: data.hype.follows > 0 ? `${compactNumber(data.hype.follows)} following` : "Attention on IGDB",
        }
      : null;

    const live: FactSpec | null =
      data.hasSteam && !data.release.upcoming && players.state !== "empty"
        ? {
            key: "live",
            label: "Playing now",
            help: "playingNow",
            value: players.state === "ready" ? <Score value={compactNumber(players.value)} /> : null,
            caption: "on Steam",
          }
        : null;

    const order = data.release.upcoming ? [release, hype, price, critic, crowd] : [critic, crowd, length, price, release, live];
    for (const fact of order) if (fact && list.length < 5) list.push(fact);
    return list;
  }, [data, reviews, players, best, pending, free, perHour]);

  // The sentence: the descriptor, then the headline numbers in words.
  const clauses: string[] = [];
  if (data.release.upcoming) clauses.push(`out ${data.release.label === "To be announced" ? "date to be announced" : data.release.label}`);
  if (data.critic) clauses.push(`${data.critic.score} from critics`);
  if (data.hours && !data.release.upcoming) clauses.push(`about ${hoursLabel(data.hours.value)} to beat`);
  if (best) clauses.push(free ? `free on ${STORE_LABEL[best.store]}` : `${formatMoney(best.price, best.currency, best.country)} on ${STORE_LABEL[best.store]}`);

  return (
    <div className="space-y-5 sm:space-y-6">
      <p className="max-w-4xl text-[19px] font-semibold leading-[1.35] tracking-[-0.012em] text-text sm:text-[24px]">
        {data.descriptor}
        {clauses.map((clause) => (
          <span key={clause}>
            <span aria-hidden className="text-faint">
              {" · "}
            </span>
            <span className="sr-only">, </span>
            <span className="text-muted">{clause}</span>
          </span>
        ))}
      </p>

      {facts.length > 0 && (
        <dl className={cn("grid gap-px overflow-hidden rounded-3xl border border-line bg-line", GRID[facts.length])}>
          {facts.map((fact, index) => (
            <div
              key={fact.key}
              className={cn(
                "min-w-0 bg-[color-mix(in_oklab,var(--color-panel)_92%,var(--game-tint,transparent))] px-4 py-4 sm:px-5",
                cellSpan(index, facts.length),
              )}
            >
              <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                {fact.label}
                {fact.help && <InfoTip topic={fact.help} />}
              </dt>
              <dd className="mt-2">
                {fact.value === null ? (
                  <span aria-hidden className="block space-y-2">
                    <Skeleton className="h-7 w-24 rounded-lg" />
                    <Skeleton className="h-3 w-28 rounded-full" />
                  </span>
                ) : (
                  <>
                    {fact.value}
                    {fact.caption && <span className="mt-1.5 line-clamp-2 block text-[13px] leading-snug text-muted">{fact.caption}</span>}
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {data.platforms.length > 0 && (
        // A div: PlatformIcons renders a list, which can't sit inside a <p>.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
          <span className="inline-flex items-center gap-2">
            <PlatformIcons platforms={data.platforms} size={15} max={8} tinted />
            <span>
              {data.release.upcoming ? "Coming to" : "On"} {data.platforms.map((platform) => platform.name).join(", ")}
            </span>
          </span>
          {gamePass.state === "ready" && (
            <a
              href="#prices"
              className="inline-flex items-center gap-1.5 rounded-full border border-mint/30 bg-mint/10 px-2.5 py-1 text-[12px] font-semibold text-text"
            >
              <BrandIcon name="xbox" size={12} title={null} tinted />
              In Game Pass{gamePass.value.leavingSoon ? " · leaving soon" : ""}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Columns per fact count: phones always 2 (or 1), wider screens one row when it fits. */
const GRID: Record<number, string> = {
  1: "grid-cols-1",
  // Few facts don't stretch across a desktop: wide empty cells read as missing data.
  2: "grid-cols-2 lg:max-w-2xl",
  3: "grid-cols-2 sm:grid-cols-3 lg:max-w-4xl",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-6 lg:grid-cols-5",
};

/** Spans that leave no hole: an odd last cell fills its phone row; five facts sit 3 + 2 on tablets. */
function cellSpan(index: number, count: number): string | false {
  if (count === 3) return index === 2 && "col-span-2 sm:col-span-1";
  if (count === 5) return index < 3 ? "sm:col-span-2 lg:col-span-1" : index === 4 ? "col-span-2 sm:col-span-3 lg:col-span-1" : "sm:col-span-3 lg:col-span-1";
  return false;
}

function Score({ value, unit, colour, small = false }: { value: ReactNode; unit?: string; colour?: string; small?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {colour && <span aria-hidden className="h-2.5 w-2.5 shrink-0 -translate-y-1 self-center rounded-full" style={{ background: colour }} />}
      <span
        className={cn(
          "font-display font-bold leading-none tracking-[-0.025em] tabular-nums text-text",
          small ? "text-[clamp(1.2rem,5.2vw,1.6rem)]" : "text-[clamp(1.6rem,7vw,2rem)]",
        )}
      >
        {value}
      </span>
      {unit && <span className="text-[13px] font-semibold text-muted">{unit}</span>}
    </span>
  );
}
