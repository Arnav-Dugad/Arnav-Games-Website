"use client";

/**
 * Month-grouped release calendar.
 *
 * Desktop draws a genuine timeline — a vertical rule with a node per month and
 * dated rows to its right. Touch drops the rule entirely (it would eat ~60px of
 * a 390px viewport for pure decoration) and uses sticky month headers instead,
 * which is the more useful wayfinding aid when scrolling with a thumb.
 */

import Link from "next/link";
import { CalendarDays, Clock } from "lucide-react";
import { GameCover } from "./GameCover";
import { CountdownInline } from "./Countdown";
import { PlatformIcons } from "./PlatformIcons";
import { WatchButton } from "./WatchButton";
import { ScorePill } from "@/components/ui/ScoreRing";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils/cn";
import { parseISO, releaseLabel } from "@/lib/utils/format";
import type { GameSummary } from "@/lib/games/types";
import { releaseState, releaseWindowInfo } from "@/lib/games/release-state";

interface MonthGroup {
  key: string;
  label: string;
  games: GameSummary[];
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  timeZone: "UTC",
});

const WEEKDAY_LABEL = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});

/**
 * Buckets releases for the calendar.
 *
 * Three tiers, in order: exact dates grouped by calendar month, then titles
 * with a known window grouped under that window's own label ("Q4 2026"), then
 * everything genuinely undated. Windowed titles get their own headings rather
 * than being lumped into "TBA" — the studio has said something, and the
 * calendar should reflect exactly how much.
 */
export function groupByMonth(games: GameSummary[]): MonthGroup[] {
  const months = new Map<string, MonthGroup>();
  const windows = new Map<string, MonthGroup>();
  const undated: GameSummary[] = [];

  for (const game of games) {
    // Defense in depth: this component is a future calendar, never a generic
    // game list. A stale server cache or provider inconsistency must not turn
    // it into a recent-releases feed.
    if (releaseState(game) !== "upcoming") continue;
    const date = parseISO(game.released);

    if (date && game.released) {
      const key = game.released.slice(0, 7);
      if (!months.has(key)) {
        months.set(key, { key, label: MONTH_LABEL.format(date), games: [] });
      }
      months.get(key)!.games.push(game);
      continue;
    }

    if (game.releaseWindow) {
      const key = `w:${game.releaseWindow}`;
      if (!windows.has(key)) {
        windows.set(key, { key, label: game.releaseWindow, games: [] });
      }
      windows.get(key)!.games.push(game);
      continue;
    }

    undated.push(game);
  }

  const ordered = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
  ordered.push(...[...windows.values()].sort((a, b) => {
    const aStart = releaseWindowInfo(a.label)?.start ?? "9999";
    const bStart = releaseWindowInfo(b.label)?.start ?? "9999";
    return aStart.localeCompare(bStart) || a.label.localeCompare(b.label);
  }));
  if (undated.length > 0) {
    ordered.push({ key: "tba", label: "Date to be announced", games: undated });
  }
  return ordered;
}

function groupId(key: string) {
  return `month-${key.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`;
}

export function ReleaseTimeline({ games }: { games: GameSummary[] }) {
  const groups = groupByMonth(games);

  if (groups.length === 0) {
    return (
      <p className="py-20 text-center text-muted">
        Nothing scheduled in this window.
      </p>
    );
  }

  return (
    <div className="relative">
      {groups.length > 1 && (
        <nav aria-label="Jump to release month" className="mask-fade-x mb-8 flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          {groups.map((group, index) => (
            <a key={group.key} href={`#${groupId(group.key)}`} className={cn("shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors", index === 0 ? "border-brand/40 bg-brand/12 text-white" : "border-line bg-white/[0.03] text-muted hover:border-line-strong hover:text-text")}>{group.label}<span className="ml-2 text-faint tabular-nums">{group.games.length}</span></a>
          ))}
        </nav>
      )}
      {/* Timeline rule — desktop only. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-[7px] hidden w-px bg-gradient-to-b from-brand/50 via-line to-transparent lg:block"
      />

      {groups.map((group) => (
        <section id={groupId(group.key)} key={group.key} className="relative scroll-mt-28 lg:pl-12">
          {/*
            The backdrop is kept at every breakpoint: rows scroll underneath
            this header, so without it the month label and the first row's
            title render on top of each other.
          */}
          <div
            className={cn(
              "sticky top-16 z-20 -mx-4 mb-4 flex items-center gap-3 bg-bg/95 px-4 py-3 backdrop-blur-xl lg:top-[72px] lg:-mx-3 lg:px-3",
            )}
          >
            <span
              aria-hidden
              // Aligns the node onto the timeline rule, which sits 7px from the
              // section's padded left edge.
              className="absolute top-1/2 hidden h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-bg bg-brand lg:block"
              style={{ left: "-2.85rem" }}
            />
            <h2 className="font-display text-lg font-bold tracking-tight lg:text-2xl">
              {group.label}
            </h2>
            <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] font-medium text-muted tabular-nums">
              {group.games.length}
            </span>
          </div>

          <ul className="mb-10 space-y-2.5 lg:mb-14 lg:space-y-3">
            {group.games.map((game, i) => (
              <li key={game.id}>
                {/* Mount-based: the calendar is paginated, so rows routinely
                    arrive while the reader is already scrolled past where a
                    scroll trigger would fire. */}
                <Reveal delay={Math.min(i, 5) * 0.04} blur={false} onMount>
                  <ReleaseRow game={game} />
                </Reveal>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ReleaseRow({ game }: { game: GameSummary }) {
  const date = parseISO(game.released);

  return (
    <div data-release-date={game.released ?? ""} data-release-window={game.releaseWindow ?? ""} data-release-tba={game.tba ? "true" : "false"} className="group relative flex items-stretch gap-3 overflow-hidden rounded-2xl border border-line bg-panel/60 p-2.5 transition-colors duration-400 fine:hover:border-line-strong fine:hover:bg-panel sm:gap-4 sm:p-3">
      {/* Date block — the timeline's anchor on desktop. */}
      <div className="flex w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-white/[0.04] py-2 sm:w-14">
        {date ? (
          <>
            <span className="font-display text-lg font-bold leading-none tabular-nums sm:text-xl">
              {DAY_LABEL.format(date)}
            </span>
            <span className="mt-1 text-[10px] uppercase tracking-[0.06em] text-faint">
              {WEEKDAY_LABEL.format(date)}
            </span>
          </>
        ) : (
          <CalendarDays size={17} className="text-faint" />
        )}
      </div>

      <Link
        href={`/game/${game.slug}`}
        className="relative h-[74px] w-14 shrink-0 overflow-hidden rounded-xl sm:h-20 sm:w-16"
        aria-hidden
        tabIndex={-1}
      >
        <GameCover
          name={game.name}
          slug={game.slug}
          image={game.image}
          imageFallback={game.imageFallback}
          width={160}
          sizes="64px"
        />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 py-1">
        <div className="flex items-start gap-2">
          <Link href={`/game/${game.slug}`} className="min-w-0 flex-1">
            <h3 className="truncate font-semibold leading-snug sm:text-[15px]">{game.name}</h3>
          </Link>
          <ScorePill score={game.metacritic} className="mt-0.5 shrink-0" />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted sm:text-xs">
          <span className="truncate">{releaseLabel(game)}</span>
          {game.released && (
            <span className="flex items-center gap-1 text-brand-soft">
              <Clock size={10} />
              <CountdownInline date={game.released} />
            </span>
          )}
          <PlatformIcons platforms={game.parentPlatforms} size={12} max={4} />
        </div>

        {game.genres.length > 0 && (
          <p className="truncate text-[11px] text-faint">
            {game.genres.slice(0, 3).map((g) => g.name).join(" · ")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center pr-0.5">
        <WatchButton game={game} />
      </div>
    </div>
  );
}
