"use client";

/**
 * The release calendar's list view, and the shared pieces its Week and Month
 * views are built from.
 *
 * The list reads like Apple Calendar's list mode: a large month title, then
 * one grouped panel per release day under a sticky day header ("Thursday 23
 * October · In 4 days"). The day header carries the date, so rows don't
 * repeat it — that frees the row for the things that differ between games:
 * art, platforms, hype and delay history.
 *
 * Three honesty tiers are kept apart, never blended: exact days, a known
 * window ("Q4 2026", or "November 2026" listed as "Sometime in November"),
 * and genuinely undated announcements.
 */

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ROW_DATE,
  DAY_MONTH,
  WEEKDAY_SHORT,
  groupCalendar,
  isoOf,
  relativeDay,
  sectionId,
  utcDate,
  type CalendarSection,
  type DayGroup,
  type ReleaseSignals,
} from "@/app/upcoming/_lib/calendar";
import { Flame, History } from "lucide-react";
import { GameCover } from "./GameCover";
import { PlatformIcons } from "./PlatformIcons";
import { WatchButton } from "./WatchButton";
import { ScorePill } from "@/components/ui/ScoreRing";
import { cn } from "@/lib/utils/cn";
import type { GameSummary } from "@/lib/games/types";

export type { ReleaseSignals } from "@/app/upcoming/_lib/calendar";

/** Client-only clock; see `useUtcToday`. */
const noopSubscribe = () => () => {};
/**
 * Today's UTC date — but only on the client. Relative labels ("Tomorrow")
 * are time-dependent and the page is cached for an hour, so the server never
 * prints them; they appear right after hydration instead of hydrating stale.
 */
export function useUtcToday(): string | null {
  return useSyncExternalStore(noopSubscribe, () => isoOf(new Date()), () => null);
}

/* -------------------------------------------------------------------------- */
/* List view                                                                  */
/* -------------------------------------------------------------------------- */

export function ReleaseTimeline({ games, signals }: { games: GameSummary[]; signals?: ReleaseSignals }) {
  const sections = groupCalendar(games);
  const today = useUtcToday();

  if (sections.length === 0) {
    return <p className="py-20 text-center text-muted">Nothing scheduled in this window.</p>;
  }

  return (
    <div>
      {sections.length > 1 && <SectionJump sections={sections} />}

      <div className="space-y-12 sm:space-y-16">
        {sections.map((section) => (
          <section key={section.key} id={sectionId(section.key)} aria-labelledby={`${sectionId(section.key)}-title`} className="scroll-mt-32">
            <div className="mb-4 flex items-baseline justify-between gap-3 sm:mb-5">
              <h2 id={`${sectionId(section.key)}-title`} className="font-display text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">
                {section.kind === "window" ? `Window: ${section.label}` : section.label}
              </h2>
              <span className="shrink-0 text-[13px] tabular-nums text-faint">
                {section.count} {section.count === 1 ? "release" : "releases"}
              </span>
            </div>

            {section.kind === "month" ? (
              <div className="space-y-5 sm:space-y-6">
                {section.days.map((day) => (
                  <DayBlock key={day.key} day={day} today={today} signals={signals} />
                ))}
              </div>
            ) : (
              <>
                {section.kind === "window" && (
                  <p className="-mt-2 mb-4 text-[13px] text-muted">The studio has named a window, not a day.</p>
                )}
                <ReleaseList games={section.days[0].games} signals={signals} />
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function DayBlock({ day, today, signals }: { day: DayGroup; today: string | null; signals?: ReleaseSignals }) {
  const relative = day.date ? relativeDay(day.date, today) : null;
  const date = day.date ? utcDate(day.date) : null;

  return (
    <div role="group" aria-label={day.label}>
      {/*
        Sticky under the floating header. The backdrop is opaque enough that
        rows scrolling beneath never collide with the date text.
      */}
      <div className="sticky top-(--chrome-top) z-20 -mx-4 flex items-center gap-3 bg-bg/90 px-4 py-2.5 backdrop-blur-xl sm:-mx-2 sm:px-2 lg:top-[72px]">
        {date ? (
          <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-fg/[0.06] text-center leading-none">
            <span>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.08em] text-flare">{WEEKDAY_SHORT.format(date)}</span>
              <span className="mt-0.5 block font-display text-[17px] font-bold tabular-nums">{date.getUTCDate()}</span>
            </span>
          </span>
        ) : (
          <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-dashed border-line-strong text-[15px] text-faint">≈</span>
        )}
        {/* Phones drop the weekday (the badge beside it already says "TUE")
            and the relative day never truncates — "Tomorrow" is the part
            people read; at 320px it used to end up as "Tom…". */}
        <h3 className="flex min-w-0 flex-1 items-baseline gap-2 text-[15px] font-semibold sm:text-[17px]">
          <span className="min-w-0 truncate">
            {date ? (
              <>
                <span className="sm:hidden">{DAY_MONTH.format(date)}</span>
                <span className="max-sm:hidden">{day.label}</span>
              </>
            ) : (
              day.label
            )}
          </span>
          {relative && <span className="shrink-0 font-medium text-brand-soft">{relative}</span>}
        </h3>
        <span className="shrink-0 rounded-full bg-fg/[0.06] px-2 py-0.5 text-[12px] font-medium tabular-nums text-muted">
          {day.games.length}
        </span>
      </div>
      <ReleaseList games={day.games} signals={signals} className="mt-2" />
    </div>
  );
}

/** One iOS-style grouped panel of rows. */
export function ReleaseList({
  games,
  signals,
  showDate = false,
  className,
}: {
  games: GameSummary[];
  signals?: ReleaseSignals;
  /** Show the release date in each row (when no day header carries it). */
  showDate?: boolean;
  className?: string;
}) {
  return (
    // Two columns on wide screens: a single column of rows stretched across
    // 1400px is mostly empty space. Hairlines are drawn per cell so the
    // grouped-panel look survives the reflow.
    <ul className={cn("grid grid-cols-1 overflow-hidden rounded-2xl border border-line bg-panel/55 light:bg-panel lg:grid-cols-2", className)}>
      {games.map((game) => (
        <li key={game.id} className="border-line max-lg:[&:not(:first-child)]:border-t lg:even:border-l lg:[&:nth-child(n+3)]:border-t">
          <ReleaseRow game={game} signal={signals?.[game.id]} showDate={showDate} />
        </li>
      ))}
    </ul>
  );
}

export function ReleaseRow({
  game,
  signal,
  showDate = false,
}: {
  game: GameSummary;
  signal?: ReleaseSignals[number];
  showDate?: boolean;
}) {
  const genres = game.genres.slice(0, 2).map((genre) => genre.name.replace(/ \(.+\)$/, "")).join(" · ");
  const windowLabel = !game.released && game.releaseWindow ? game.releaseWindow : null;

  return (
    <div
      data-release-date={game.released ?? ""}
      data-release-window={game.releaseWindow ?? ""}
      data-release-tba={game.tba ? "true" : "false"}
      className="group relative flex items-center gap-3 px-2.5 py-2.5 transition-colors duration-300 fine:hover:bg-fg/[0.035] sm:gap-4 sm:px-3"
    >
      <Link
        href={`/game/${game.slug}`}
        className="relative h-[68px] w-[51px] shrink-0 overflow-hidden rounded-[10px] shadow-[0_6px_16px_-10px_rgba(0,0,0,0.8)] ring-1 ring-inset ring-fg/10 sm:h-[76px] sm:w-[57px]"
        aria-hidden
        tabIndex={-1}
      >
        <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={160} sizes="57px" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={`/game/${game.slug}`} className="min-w-0 truncate text-[15px] font-semibold leading-snug fine:hover:text-brand-soft sm:text-base">
            {game.name}
          </Link>
          <ScorePill score={game.metacritic} className="shrink-0" />
        </div>

        <div className="flex min-w-0 items-center gap-2.5 text-[12px] text-muted">
          {showDate && game.released && <span className="shrink-0 font-medium text-text/80">{ROW_DATE.format(utcDate(game.released))}</span>}
          {windowLabel && <span className="shrink-0 font-medium text-text/80">{windowLabel}</span>}
          <PlatformIcons platforms={game.parentPlatforms} size={12} max={4} className="shrink-0" />
          {genres && <span className="min-w-0 truncate text-faint">{genres}</span>}
        </div>

        {(signal?.delays || signal?.hype !== undefined) && (
          <div className="flex items-center gap-1.5">
            {signal?.hype !== undefined && <HypeBadge value={signal.hype} />}
            {signal?.delays ? <DelayBadge count={signal.delays} /> : null}
          </div>
        )}
      </div>

      <WatchButton game={game} className="shrink-0" />
    </div>
  );
}

export function HypeBadge({ value, className }: { value: number; className?: string }) {
  return (
    <span
      title="Hype index: anticipation and attention signals, 0–100"
      className={cn("relative inline-flex shrink-0 items-center gap-1 rounded-full bg-gold/12 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-gold", className)}
    >
      <Flame size={11} aria-hidden />
      <span className="sr-only">Hype index </span>
      {value}
    </span>
  );
}

export function DelayBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      title="Release date moved later since Arnav Games began tracking it"
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-flare/12 px-1.5 py-0.5 text-[11px] font-semibold text-flare", className)}
    >
      <History size={11} aria-hidden />
      Delayed {count}×
    </span>
  );
}

/**
 * Section chips that follow the reader.
 *
 * The active chip tracks whichever section sits under the sticky header (an
 * IntersectionObserver band just below it), and the chip row scrolls itself —
 * never the page — so the active chip stays in view on a phone.
 */
function SectionJump({ sections }: { sections: CalendarSection[] }) {
  const [active, setActive] = useState(sections[0]?.key ?? "");
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nodes = sections
      .map((section) => document.getElementById(sectionId(section.key)))
      .filter((element): element is HTMLElement => element !== null);
    if (nodes.length === 0) return;
    const visible = new Set<HTMLElement>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target as HTMLElement);
          else visible.delete(entry.target as HTMLElement);
        }
        const first = nodes.find((node) => visible.has(node));
        const section = first && sections.find((item) => sectionId(item.key) === first.id);
        if (section) setActive(section.key);
        // Scrolled back above the first month: nothing is in the band, and
        // the last month seen (e.g. November) used to stay highlighted over
        // October's heading.
        else if (nodes[0].getBoundingClientRect().top > window.innerHeight * 0.22) setActive(sections[0].key);
      },
      { rootMargin: "-22% 0px -70% 0px" },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [sections]);

  useEffect(() => {
    const nav = navRef.current;
    const chip = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!nav || !chip) return;
    const navBox = nav.getBoundingClientRect();
    const chipBox = chip.getBoundingClientRect();
    if (chipBox.left >= navBox.left + 24 && chipBox.right <= navBox.right - 24) return;
    const left = nav.scrollLeft + (chipBox.left - navBox.left) - navBox.width / 2 + chipBox.width / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [active]);

  return (
    <nav ref={navRef} aria-label="Jump to month" className="no-scrollbar -mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {sections.map((section) => {
        const current = section.key === active;
        return (
          <a
            key={section.key}
            href={`#${sectionId(section.key)}`}
            onClick={() => setActive(section.key)}
            aria-current={current ? "true" : undefined}
            className={cn(
              "press inline-flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors coarse:min-h-11",
              current ? "bg-fg text-bg" : "bg-fg/[0.06] text-muted fine:hover:bg-fg/[0.1] fine:hover:text-text",
            )}
          >
            {section.kind === "month" ? section.label.replace(/ \d{4}$/, "") : section.label}
            <span className={cn("ml-1.5 tabular-nums", current ? "text-bg/60" : "text-faint")}>{section.count}</span>
          </a>
        );
      })}
    </nav>
  );
}
