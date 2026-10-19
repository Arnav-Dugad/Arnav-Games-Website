"use client";

/**
 * Week and Month views of the release calendar.
 *
 * Both are "pick a day, see its releases": a grid of days that shows how busy
 * each one is at a glance, and below it the selected day as the same grouped
 * list the List view uses. Each view is fetched for exactly its own date
 * range (see the page), so a quiet Tuesday really is quiet — it is never an
 * artefact of pagination.
 *
 * On a desktop the Week view becomes a seven-column board instead, because
 * there is room to show every day at once and that is what a week planner is.
 */

import Link, { useLinkStatus } from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { HypeBadge, ReleaseList, useUtcToday } from "@/components/game/ReleaseTimeline";
import {
  DAY_LONG,
  MONTH_TITLE,
  WEEKDAY_SHORT,
  addDays,
  groupCalendar,
  rangeLabel,
  relativeDay,
  utcDate,
  type ReleaseSignals,
} from "../_lib/calendar";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import type { GameSummary } from "@/lib/games/types";

interface Nav {
  prevHref: string | null;
  nextHref: string | null;
}

/** Exact-day releases keyed by ISO day; windowed titles kept separately. */
function byDay(games: GameSummary[]) {
  const days = new Map<string, GameSummary[]>();
  const windowed: GameSummary[] = [];
  for (const section of groupCalendar(games)) {
    for (const day of section.days) {
      if (day.date) days.set(day.date, day.games);
      else windowed.push(...day.games);
    }
  }
  return { days, windowed };
}

function firstBusyDay(days: Map<string, GameSummary[]>, candidates: string[], today: string | null): string {
  const upcoming = candidates.filter((day) => !today || day >= today);
  return upcoming.find((day) => (days.get(day)?.length ?? 0) > 0) ?? upcoming[0] ?? candidates[0];
}

/* -------------------------------------------------------------------------- */
/* Week                                                                       */
/* -------------------------------------------------------------------------- */

export function WeekView({
  games,
  signals,
  weekStart,
  ...nav
}: { games: GameSummary[]; signals: ReleaseSignals; weekStart: string } & Nav) {
  const today = useUtcToday();
  const { days, windowed } = byDay(games);
  const week = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked && week.includes(picked) ? picked : firstBusyDay(days, week, today);
  const title = rangeLabel(weekStart, week[6]);

  return (
    <div>
      <ViewNav title={title} unit="week" {...nav} />

      {/* Phones and tablets: the iOS week strip, then the chosen day. */}
      <div className="lg:hidden">
        <div role="group" aria-label="Days of the week" className="grid grid-cols-7 gap-1">
          {week.map((day) => {
            const count = days.get(day)?.length ?? 0;
            const isSelected = day === selected;
            const past = Boolean(today && day < today);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${DAY_LONG.format(utcDate(day))}, ${count} ${count === 1 ? "release" : "releases"}`}
                onClick={() => {
                  haptic("selection");
                  setPicked(day);
                }}
                className={cn(
                  "press flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl transition-colors",
                  isSelected ? "bg-fg text-bg" : "fine:hover:bg-fg/[0.06]",
                  past && !isSelected && "opacity-40",
                )}
              >
                <span className={cn("text-[11px] font-semibold uppercase", isSelected ? "text-bg/70" : "text-faint")}>
                  {WEEKDAY_SHORT.format(utcDate(day)).slice(0, 1)}
                </span>
                <span className={cn("font-display text-[19px] font-bold tabular-nums leading-none", day === today && !isSelected && "text-flare")}>
                  {utcDate(day).getUTCDate()}
                </span>
                <BusyDots count={count} inverted={isSelected} />
              </button>
            );
          })}
        </div>
        <SelectedDay day={selected} games={days.get(selected) ?? []} signals={signals} today={today} />
      </div>

      {/* Desktop: every day at once. */}
      <div className="hidden grid-cols-7 gap-2 lg:grid">
        {week.map((day) => {
          const list = days.get(day) ?? [];
          const past = Boolean(today && day < today);
          return (
            <section key={day} aria-label={DAY_LONG.format(utcDate(day))} className={cn("min-w-0 rounded-2xl border border-line bg-panel/45 p-2 light:bg-panel", past && "opacity-50")}>
              <header className="flex items-baseline justify-between px-1.5 pb-2 pt-1">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{WEEKDAY_SHORT.format(utcDate(day))}</span>
                <span className={cn("font-display text-[22px] font-bold tabular-nums", day === today && "text-flare")}>{utcDate(day).getUTCDate()}</span>
              </header>
              {list.length === 0 ? (
                <p className="px-1.5 pb-2 text-[12px] text-faint">{past ? "Already out" : "No releases"}</p>
              ) : (
                <ul className="space-y-1">
                  {list.map((game) => (
                    <li key={game.id}>
                      <BoardCard game={game} hype={signals[game.id]?.hype} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <WindowNote games={windowed} signals={signals} scope="week" />
    </div>
  );
}

function BoardCard({ game, hype }: { game: GameSummary; hype?: number }) {
  return (
    <Link
      href={`/game/${game.slug}`}
      data-release-date={game.released ?? ""}
      className="press group flex items-center gap-2 rounded-xl p-1.5 transition-colors fine:hover:bg-fg/[0.06]"
    >
      <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md ring-1 ring-inset ring-fg/10">
        <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={96} sizes="36px" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[12px] font-semibold leading-tight">{game.name}</span>
        {hype !== undefined && <HypeBadge value={hype} className="mt-1 px-1 py-0 text-[10px]" />}
      </span>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Month                                                                      */
/* -------------------------------------------------------------------------- */

export function MonthView({
  games,
  signals,
  month,
  truncated,
  ...nav
}: {
  games: GameSummary[];
  signals: ReleaseSignals;
  /** `YYYY-MM`. */
  month: string;
  /** Total in range when the fetch was capped below it. */
  truncated: number | null;
} & Nav) {
  const today = useUtcToday();
  const { days, windowed } = byDay(games);
  const first = `${month}-01`;
  const length = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const dates = Array.from({ length }, (_, index) => addDays(first, index));
  const lead = (utcDate(first).getUTCDay() + 6) % 7;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked && dates.includes(picked) ? picked : firstBusyDay(days, dates, today);
  const max = Math.max(1, ...[...days.values()].map((list) => list.length));

  return (
    <div>
      <ViewNav title={MONTH_TITLE.format(utcDate(first))} unit="month" {...nav} />

      {truncated !== null && (
        <p className="mb-4 rounded-2xl bg-gold/[0.08] px-4 py-3 text-[13px] text-muted">
          This month has {truncated.toLocaleString("en-US")} releases; the grid shows the first {games.length}. The List view has every one.
        </p>
      )}

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => (
          <div key={name} aria-hidden className="pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
            <span className="sm:hidden">{name.slice(0, 1)}</span>
            <span className="hidden sm:inline">{name}</span>
          </div>
        ))}
        {Array.from({ length: lead }, (_, index) => <div key={`lead-${index}`} aria-hidden />)}
        {dates.map((day) => {
          const list = days.get(day) ?? [];
          const isSelected = day === selected;
          const past = Boolean(today && day < today);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${DAY_LONG.format(utcDate(day))}, ${list.length} ${list.length === 1 ? "release" : "releases"}`}
              onClick={() => {
                haptic("selection");
                setPicked(day);
              }}
              className={cn(
                "press relative flex aspect-square min-h-11 flex-col rounded-xl p-1 text-left transition-colors sm:aspect-auto sm:min-h-[104px] sm:rounded-2xl sm:p-2",
                isSelected ? "bg-fg/[0.12] ring-2 ring-inset ring-fg/70" : list.length ? "bg-fg/[0.05] fine:hover:bg-fg/[0.09]" : "fine:hover:bg-fg/[0.04]",
                past && "opacity-40",
              )}
            >
              <span
                className={cn(
                  "grid h-6 min-w-6 place-items-center self-center rounded-full px-1 text-[13px] font-semibold tabular-nums sm:self-start sm:text-[14px]",
                  day === today ? "bg-flare text-white" : list.length ? "text-text" : "text-faint",
                )}
              >
                {utcDate(day).getUTCDate()}
              </span>
              {list.length > 0 && (
                <>
                  {/* Phones: a busyness bar. Wider screens: the covers themselves. */}
                  <span aria-hidden className="mt-auto flex justify-center pb-0.5 sm:hidden">
                    <span className="h-1 rounded-full bg-brand" style={{ width: `${Math.max(18, (list.length / max) * 100)}%` }} />
                  </span>
                  <span aria-hidden className="mt-auto hidden items-end sm:flex">
                    {list.slice(0, 3).map((game, index) => (
                      <span key={game.id} className={cn("relative h-10 w-[30px] shrink-0 overflow-hidden rounded-[5px] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.6)] ring-1 ring-bg", index > 0 && "-ml-2.5")}>
                        <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={80} sizes="30px" />
                      </span>
                    ))}
                    {list.length > 3 && <span className="ml-1.5 pb-0.5 text-[11px] font-semibold tabular-nums text-muted">+{list.length - 3}</span>}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>

      <SelectedDay day={selected} games={days.get(selected) ?? []} signals={signals} today={today} />
      <WindowNote games={windowed} signals={signals} scope="month" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

function SelectedDay({ day, games, signals, today }: { day: string; games: GameSummary[]; signals: ReleaseSignals; today: string | null }) {
  const relative = relativeDay(day, today);
  const past = Boolean(today && day < today);
  return (
    <section aria-live="polite" className="mt-6">
      <h3 className="flex items-baseline gap-2 text-[17px] font-semibold">
        {DAY_LONG.format(utcDate(day))}
        {relative && <span className="text-[15px] font-medium text-brand-soft">{relative}</span>}
      </h3>
      {games.length > 0 ? (
        <ReleaseList games={games} signals={signals} className="mt-3" />
      ) : (
        <p className="mt-3 rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[14px] text-muted">
          {past ? "This day has passed — anything that launched is out now." : "Nothing launches this day."}
        </p>
      )}
    </section>
  );
}

function WindowNote({ games, signals, scope }: { games: GameSummary[]; signals: ReleaseSignals; scope: "week" | "month" }) {
  if (games.length === 0) return null;
  return (
    <section className="mt-8">
      <h3 className="text-[17px] font-semibold">Also expected this {scope}</h3>
      <p className="mt-1 text-[13px] text-muted">These have a release window rather than a day, so they aren&apos;t pinned to the grid.</p>
      <ReleaseList games={games} signals={signals} className="mt-3" />
    </section>
  );
}

function BusyDots({ count, inverted }: { count: number; inverted: boolean }) {
  return (
    <span aria-hidden className="flex h-1.5 items-center gap-0.5">
      {Array.from({ length: Math.min(3, count) }, (_, index) => (
        <span key={index} className={cn("h-1 w-1 rounded-full", inverted ? "bg-bg/70" : "bg-brand")} />
      ))}
    </span>
  );
}

// No count under the title: the toolbar above already says "18 releases",
// and the week/month boards printed it a second time a few lines below.
function ViewNav({ title, unit, prevHref, nextHref }: { title: string; unit: "week" | "month" } & Nav) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-display text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">{title}</h2>
      </div>
      <NavArrow href={prevHref} label={`Previous ${unit}`}>
        <ChevronLeft size={18} />
      </NavArrow>
      <NavArrow href={nextHref} label={`Next ${unit}`}>
        <ChevronRight size={18} />
      </NavArrow>
    </div>
  );
}

function NavArrow({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const className = "grid h-11 w-11 shrink-0 place-items-center rounded-full bg-fg/[0.06] transition-colors";
  if (!href) {
    return (
      <span aria-disabled="true" aria-label={label} role="link" className={cn(className, "text-faint opacity-50")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} scroll={false} aria-label={label} className={cn(className, "press text-text fine:hover:bg-fg/[0.1]")}>
      <ArrowContent>{children}</ArrowContent>
    </Link>
  );
}

/** Each fetch is a fresh server render; the arrow says so while it runs. */
function ArrowContent({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 size={16} className="animate-spin text-muted" /> : <>{children}</>;
}
