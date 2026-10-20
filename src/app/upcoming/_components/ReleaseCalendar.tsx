"use client";

/**
 * The release calendar — always a calendar.
 *
 * Desktop: the month as a grid of days, each showing its releases as a small
 * fan of covers (dense days stack three and say "+N"), with the selected
 * day's releases in a rich panel beside it that stays in view while you pick.
 *
 * Phones: a compact week strip (swipe or use the arrows to move a week) with
 * each day's lead cover under its date; the full month grid is one tap away
 * and the choice is remembered. The selected day's releases follow below.
 *
 * Under the grid, two trays keep the honesty tiers apart: titles with only a
 * window ("Nov 2026", "Q4 2026") under "Also expected", and undated
 * announcements under "Date to be announced". Neither is ever placed on a day.
 *
 * Changing month turns the page like a desk calendar (see PAGE below);
 * reduced motion crossfades instead. The selected day is mirrored into the
 * URL (`?day=`) with `replaceState`, so Back from a game lands on it again.
 */

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, type PanInfo, type Variants } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Flame, History, Loader2 } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { GameLogo } from "@/components/game/GameLogo";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { WatchButton } from "@/components/game/WatchButton";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";
import type { GameSummary } from "@/lib/games/types";
import {
  DAY_LONG,
  DAY_MONTH_SHORT,
  MONTH_NAME,
  MONTH_TITLE,
  WEEKDAY_SHORT,
  addDays,
  bucketMonth,
  isoOf,
  monthLength,
  relativeDay,
  utcDate,
  weekStartOf,
  type ReleaseSignals,
} from "../_lib/calendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MODE_KEY = `${STORAGE_PREFIX}calendar-mode`;
const MODE_EVENT = "arnav-games:calendar-mode";

/** Client-only clock. Relative labels are time-dependent and the page is cached for an hour. */
const noopSubscribe = () => () => {};
function useUtcToday(): string | null {
  return useSyncExternalStore(noopSubscribe, () => isoOf(new Date()), () => null);
}

/** Phones' remembered choice between the week strip and the month grid. */
function usePhoneMode(): ["week" | "month", (mode: "week" | "month") => void] {
  const mode = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(MODE_EVENT, onChange);
      return () => window.removeEventListener(MODE_EVENT, onChange);
    },
    () => {
      try {
        return window.localStorage.getItem(MODE_KEY) === "month" ? "month" : "week";
      } catch {
        return "week";
      }
    },
    () => "week" as const,
  );
  const set = (next: "week" | "month") => {
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      /* storage blocked: the choice lasts this view only */
    }
    window.dispatchEvent(new Event(MODE_EVENT));
  };
  return [mode, set];
}

export interface ReleaseCalendarProps {
  games: GameSummary[];
  undated: GameSummary[];
  signals: ReleaseSignals;
  /** `YYYY-MM`. */
  month: string;
  thisMonth: string;
  /** Today (UTC) on the server, standing in for the client clock until hydration. */
  serverToday: string;
  initialDay: string | null;
  /** Filter params every calendar link carries. */
  query: string;
  /** Total in range when the fetch was capped below it. */
  truncated: number | null;
  undatedOpen: boolean;
  filtered: boolean;
}

const shiftMonth = (month: string, delta: number) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1)).toISOString().slice(0, 7);

export function ReleaseCalendar(props: ReleaseCalendarProps) {
  const { games, undated, signals, month, thisMonth, serverToday, initialDay, query, truncated, undatedOpen, filtered } = props;
  const router = useRouter();
  const clientToday = useUtcToday();
  // Before hydration the server's clock stands in, so markup matches.
  const today = clientToday ?? serverToday;
  const calm = useCalmMotion();
  const { days, windowed } = bucketMonth(games, signals);
  const first = `${month}-01`;
  const dates = Array.from({ length: monthLength(month) }, (_, index) => addDays(first, index));
  const open = (day: string) => !today || day >= today;
  const firstOpen = dates.find((day) => open(day) && (days.get(day)?.length ?? 0) > 0) ?? dates.find(open) ?? first;

  const [picked, setPicked] = useState<string | null>(initialDay);
  const selected = picked && dates.includes(picked) && open(picked) ? picked : firstOpen;
  const [mode, setMode] = usePhoneMode();

  const href = (target: string, day?: string) => {
    const params = new URLSearchParams(query);
    if (day) params.set("day", day);
    else if (target !== thisMonth) params.set("month", target);
    const qs = params.toString();
    return qs ? `/upcoming?${qs}` : "/upcoming";
  };
  const prevMonth = month > thisMonth ? href(shiftMonth(month, -1)) : null;
  const nextMonth = href(shiftMonth(month, 1));

  // Mirror the selection into the URL so Back from a game page restores it.
  useEffect(() => {
    if (!picked) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("day") === picked) return;
    url.searchParams.set("day", picked);
    url.searchParams.delete("month");
    url.searchParams.delete("week");
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams}`);
  }, [picked]);

  const choose = (day: string) => {
    haptic("selection");
    setPicked(day);
  };

  /** Phones: move the strip a week; leaving the month loads the neighbouring one. */
  const shiftWeek = (delta: 1 | -1) => {
    const target = addDays(selected, delta * 7);
    if (today && weekStartOf(target) < weekStartOf(today)) return;
    const day = today && target < today ? today : target;
    haptic("selection");
    if (day.slice(0, 7) !== month) router.push(href(day.slice(0, 7), day), { scroll: false });
    else setPicked(day);
  };
  const canGoBackWeek = !today || weekStartOf(selected) > weekStartOf(today);

  return (
    <>
      <div className="mx-auto w-full max-w-[1400px] px-4 lg:px-6 xl:px-10">
        {truncated !== null && (
          <p className="mb-4 rounded-2xl bg-gold/[0.08] px-4 py-3 text-[13px] text-muted">
            {truncated.toLocaleString("en-US")} releases this month; the calendar shows the first {games.length}. Narrow it with a filter.
          </p>
        )}

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:items-start lg:gap-8 xl:gap-10">
          <div className="min-w-0">
            <header className="mb-4 flex items-center gap-2 sm:mb-5">
              <h2 className="min-w-0 flex-1 truncate font-display text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">
                {MONTH_TITLE.format(utcDate(first))}
              </h2>
              {(month !== thisMonth || (clientToday && selected !== firstOpen)) && (
                <TodayButton
                  href={month !== thisMonth ? href(thisMonth) : null}
                  onSelect={() => choose(firstOpen)}
                />
              )}
              <button
                type="button"
                onClick={() => {
                  haptic("selection");
                  setMode(mode === "week" ? "month" : "week");
                }}
                aria-pressed={mode === "month"}
                aria-label={mode === "week" ? "Show the whole month" : "Show one week"}
                className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-fg/[0.06] text-text fine:hover:bg-fg/[0.1] sm:hidden"
              >
                {mode === "week" ? <CalendarDays size={18} /> : <CalendarRange size={18} />}
              </button>
              {/* Phones in week mode step by week; everywhere else by month. */}
              <div className={mode === "month" ? "hidden" : "flex gap-2 sm:hidden"}>
                <StepButton label="Previous week" disabled={!canGoBackWeek} onClick={() => shiftWeek(-1)} dir={-1} />
                <StepButton label="Next week" onClick={() => shiftWeek(1)} dir={1} />
              </div>
              <div className={mode === "month" ? "flex gap-2" : "hidden gap-2 sm:flex"}>
                <MonthArrow href={prevMonth} label="Previous month" dir={-1} />
                <MonthArrow href={nextMonth} label="Next month" dir={1} />
              </div>
            </header>

            <div className={cn("sm:hidden", mode === "month" && "hidden")}>
              <WeekStrip
                selected={selected}
                month={month}
                days={days}
                today={today}
                onSelect={choose}
                onSwipe={shiftWeek}
                monthHref={(day) => href(day.slice(0, 7), day)}
                calm={calm}
              />
            </div>
            <div className={cn(mode === "week" && "max-sm:hidden")}>
              <MonthGrid month={month} dates={dates} days={days} selected={selected} today={today} onSelect={choose} />
            </div>
          </div>

          <DayPanel
            day={selected}
            games={days.get(selected) ?? []}
            signals={signals}
            today={clientToday}
            next={dates.find((day) => day > selected && (days.get(day)?.length ?? 0) > 0) ?? null}
            nextCount={(day) => days.get(day)?.length ?? 0}
            onSelect={choose}
            nextMonthHref={nextMonth}
            filtered={filtered}
            empty={days.size === 0}
          />
        </div>
      </div>

      {windowed.length > 0 && (
        <Tray
          id="also-expected"
          title={`Also expected in ${MONTH_NAME.format(utcDate(first))}`}
          caption="No exact day yet"
          games={windowed}
          signals={signals}
          label={(game) => game.releaseWindow}
        />
      )}
      {undated.length > 0 && (
        <Tray
          id="tba"
          title="Date to be announced"
          caption="Announced, not yet scheduled"
          games={undated}
          signals={signals}
          grid={undatedOpen}
          more={undatedOpen ? null : `/upcoming?${new URLSearchParams([...new URLSearchParams(query), ["window", "tba"]])}#tba`}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

function TodayButton({ href, onSelect }: { href: string | null; onSelect: () => void }) {
  const className =
    "press inline-flex min-h-11 shrink-0 items-center rounded-full bg-fg/[0.06] px-4 text-[14px] font-semibold text-text fine:hover:bg-fg/[0.1]";
  return href ? (
    <Link href={href} scroll={false} className={className}>
      Today
    </Link>
  ) : (
    <button type="button" onClick={onSelect} className={className}>
      Today
    </button>
  );
}

const ARROW = "grid h-11 w-11 shrink-0 place-items-center rounded-full bg-fg/[0.06] transition-colors";

function StepButton({ label, onClick, dir, disabled = false }: { label: string; onClick: () => void; dir: 1 | -1; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(ARROW, "press text-text disabled:text-faint disabled:opacity-50 fine:hover:bg-fg/[0.1]")}
    >
      {dir < 0 ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
    </button>
  );
}

function MonthArrow({ href, label, dir }: { href: string | null; label: string; dir: 1 | -1 }) {
  const icon = dir < 0 ? <ChevronLeft size={18} /> : <ChevronRight size={18} />;
  if (!href) {
    return (
      <span aria-disabled="true" aria-label={label} role="link" className={cn(ARROW, "text-faint opacity-50")}>
        {icon}
      </span>
    );
  }
  return (
    <Link href={href} scroll={false} aria-label={label} className={cn(ARROW, "press text-text fine:hover:bg-fg/[0.1]")}>
      <ArrowContent>{icon}</ArrowContent>
    </Link>
  );
}

/** Each month is a fresh server render; the arrow says so while it runs. */
function ArrowContent({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 size={16} className="animate-spin text-muted" /> : <>{children}</>;
}

/* -------------------------------------------------------------------------- */
/* Week strip (phones)                                                        */
/* -------------------------------------------------------------------------- */

/** A week slides in from the side it was asked for; reduced motion crossfades. */
const SLIDE: Variants = {
  enter: ({ dir, calm }: Turn) => (calm ? { x: 0, opacity: 0 } : { x: `${dir * 100}%`, opacity: 0.4 }),
  center: ({ calm }: Turn) => ({
    x: 0,
    opacity: 1,
    transition: calm ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 40 },
  }),
  exit: ({ dir, calm }: Turn) =>
    calm ? { x: 0, opacity: 0, transition: { duration: 0.1 } } : { x: `${-dir * 100}%`, opacity: 0.4, transition: { duration: 0.22 } },
};

function WeekStrip({
  selected,
  month,
  days,
  today,
  onSelect,
  onSwipe,
  monthHref,
  calm,
}: {
  selected: string;
  month: string;
  days: Map<string, GameSummary[]>;
  today: string | null;
  onSelect: (day: string) => void;
  onSwipe: (delta: 1 | -1) => void;
  monthHref: (day: string) => string;
  calm: boolean;
}) {
  const start = weekStartOf(selected);
  const week = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const [shown, setShown] = useState({ start, dir: 0 });
  if (shown.start !== start) setShown({ start, dir: start > shown.start ? 1 : -1 });
  const slide: Turn = { dir: shown.start === start ? shown.dir : start > shown.start ? 1 : -1, calm };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) < 48 || Math.abs(info.offset.x) < Math.abs(info.offset.y)) return;
    onSwipe(info.offset.x < 0 ? 1 : -1);
  };

  return (
    <div className="overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout" custom={slide}>
        <motion.div
          key={start}
          role="group"
          aria-label={`Week of ${DAY_LONG.format(utcDate(start))}`}
          custom={slide}
          variants={SLIDE}
          initial="enter"
          animate="center"
          exit="exit"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.25}
          onDragEnd={onDragEnd}
          className="grid touch-pan-y grid-cols-7 gap-1"
        >
          {week.map((day) => {
            const list = days.get(day) ?? [];
            const inMonth = day.slice(0, 7) === month;
            const past = Boolean(today && day < today);
            const isSelected = day === selected;
            const label = `${DAY_LONG.format(utcDate(day))}, ${list.length} ${list.length === 1 ? "release" : "releases"}`;
            const body = (
              <>
                <span className={cn("text-[11px] font-semibold uppercase", isSelected ? "text-bg/70" : "text-faint")}>
                  {WEEKDAY_SHORT.format(utcDate(day)).slice(0, 1)}
                </span>
                <span
                  className={cn(
                    "font-display text-[18px] font-bold leading-none tabular-nums",
                    day === today && !isSelected && "text-flare",
                  )}
                >
                  {utcDate(day).getUTCDate()}
                </span>
                <span aria-hidden className="relative mt-0.5 h-[34px] w-[26px]">
                  {list[0] ? (
                    <>
                      <span className="absolute inset-0 overflow-hidden rounded-[5px] ring-1 ring-fg/15">
                        <GameCover name={list[0].name} slug={list[0].slug} image={list[0].image} imageFallback={list[0].imageFallback} width={80} sizes="26px" />
                      </span>
                      {list.length > 1 && (
                        <span className="absolute -bottom-1 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold tabular-nums text-white">
                          {list.length}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className={cn("absolute inset-x-[9px] top-[15px] h-1 rounded-full", isSelected ? "bg-bg/25" : "bg-fg/10")} />
                  )}
                </span>
              </>
            );
            const className = cn(
              "press flex min-h-[92px] flex-col items-center justify-start gap-1.5 rounded-2xl pt-2 transition-colors",
              isSelected ? "bg-fg text-bg" : "fine:hover:bg-fg/[0.06]",
              (past || !inMonth) && !isSelected && "opacity-40",
            );
            if (!inMonth && !past) {
              return (
                <Link key={day} href={monthHref(day)} scroll={false} aria-label={label} draggable={false} className={className}>
                  {body}
                </Link>
              );
            }
            return (
              <button
                key={day}
                type="button"
                aria-pressed={isSelected}
                aria-label={label}
                disabled={past}
                onClick={() => onSelect(day)}
                className={className}
              >
                {body}
              </button>
            );
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Month grid                                                                 */
/* -------------------------------------------------------------------------- */

interface Turn {
  /** 1 forward, -1 back, 0 first paint. */
  dir: number;
  calm: boolean;
}

const TURN_S = 0.45;

/*
 * Pages hinge on their top edge. rotateX goes negative so a turning page
 * folds *away* from the reader (a desk calendar) and never balloons over the
 * controls above it; past -90° the back face is hidden, so it simply leaves.
 * Every variant names every value — motion would otherwise animate an omitted
 * one back to `initial`.
 */
const PAGE: Variants = {
  enter: ({ dir, calm }: Turn) =>
    calm ? { opacity: 0, rotateX: 0, zIndex: 1 } : dir < 0 ? { opacity: 1, rotateX: -100, zIndex: 2 } : { opacity: 1, rotateX: 0, zIndex: 1 },
  center: ({ dir, calm }: Turn) => ({
    opacity: 1,
    rotateX: 0,
    zIndex: dir < 0 ? 2 : 1,
    transition: calm ? { duration: 0.2 } : dir < 0 ? { duration: TURN_S, ease: [0.3, 0.75, 0.35, 1] } : { duration: 0 },
  }),
  exit: ({ dir, calm }: Turn) =>
    calm
      ? { opacity: 0, rotateX: 0, zIndex: 1, transition: { duration: 0.2 } }
      : dir > 0
        ? { opacity: 1, rotateX: -100, zIndex: 2, transition: { duration: TURN_S, ease: [0.5, 0, 0.75, 0.35] } }
        : { opacity: 1, rotateX: 0, zIndex: 1, transition: { duration: TURN_S } },
};

/** Light on the paper: the page underneath sits in the turning page's shadow. */
const SHADE: Variants = {
  enter: ({ dir, calm }: Turn) => ({ opacity: calm || dir === 0 ? 0 : 0.4 }),
  center: { opacity: 0, transition: { duration: TURN_S, ease: "easeOut" } },
  exit: ({ dir, calm }: Turn) => ({ opacity: calm ? 0 : dir > 0 ? 0.3 : 0.4, transition: { duration: TURN_S, ease: "easeIn" } }),
};

function MonthGrid({
  month,
  dates,
  days,
  selected,
  today,
  onSelect,
}: {
  month: string;
  dates: string[];
  days: Map<string, GameSummary[]>;
  selected: string;
  today: string | null;
  onSelect: (day: string) => void;
}) {
  const calm = useCalmMotion();
  const lead = (utcDate(dates[0]).getUTCDay() + 6) % 7;
  // Direction comes from comparing months, adjusted during render so the
  // very first frame of the new month already knows which way to turn.
  const [shown, setShown] = useState({ month, dir: 0 });
  if (shown.month !== month) setShown({ month, dir: month > shown.month ? 1 : -1 });
  const turn: Turn = { dir: shown.month === month ? shown.dir : month > shown.month ? 1 : -1, calm };

  return (
    <div className="relative" style={{ perspective: 2200 }}>
      <AnimatePresence initial={false} mode="popLayout" custom={turn}>
        <motion.div
          key={month}
          custom={turn}
          variants={PAGE}
          initial="enter"
          animate="center"
          exit="exit"
          style={{ transformOrigin: "50% 0%", backfaceVisibility: "hidden" }}
          className="relative rounded-2xl bg-bg [&:not(:last-child)]:pointer-events-none"
        >
          <div role="group" aria-label={MONTH_TITLE.format(utcDate(dates[0]))} className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {WEEKDAYS.map((name) => (
              <div key={name} aria-hidden className="pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                <span className="sm:hidden">{name.slice(0, 1)}</span>
                <span className="hidden sm:inline">{name}</span>
              </div>
            ))}
            {Array.from({ length: lead }, (_, index) => <div key={`lead-${index}`} aria-hidden />)}
            {dates.map((day) => (
              <DayCell
                key={day}
                day={day}
                list={days.get(day) ?? []}
                selected={day === selected}
                today={day === today}
                past={Boolean(today && day < today)}
                // A week that is wholly over shrinks on phones: no reason to scroll past it.
                spent={Boolean(today && addDays(weekStartOf(day), 6) < today)}
                onSelect={onSelect}
              />
            ))}
          </div>
          <motion.span aria-hidden custom={turn} variants={SHADE} className="pointer-events-none absolute inset-0 rounded-2xl bg-black" />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function DayCell({
  day,
  list,
  selected,
  today,
  past,
  spent,
  onSelect,
}: {
  day: string;
  list: GameSummary[];
  selected: boolean;
  today: boolean;
  past: boolean;
  spent: boolean;
  onSelect: (day: string) => void;
}) {
  const lead = list[0];
  const number = (
    <span
      className={cn(
        "relative z-[1] grid h-6 min-w-6 place-items-center self-start rounded-full px-1 text-[13px] font-semibold tabular-nums sm:text-[14px]",
        today ? "bg-flare text-white" : lead ? "text-white sm:text-text" : "text-faint",
      )}
    >
      {utcDate(day).getUTCDate()}
    </span>
  );
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${DAY_LONG.format(utcDate(day))}, ${list.length} ${list.length === 1 ? "release" : "releases"}`}
      disabled={past}
      onClick={() => onSelect(day)}
      className={cn(
        "press group relative flex aspect-[4/5] min-h-11 flex-col overflow-hidden rounded-xl p-1 text-left transition-[background-color,box-shadow] sm:aspect-auto sm:min-h-[112px] sm:rounded-2xl sm:p-2 lg:min-h-[120px]",
        selected ? "sm:bg-fg/[0.1]" : lead ? "sm:bg-fg/[0.05] sm:fine:hover:bg-fg/[0.09]" : "fine:hover:bg-fg/[0.04]",
        past && "opacity-35",
        spent && "max-sm:aspect-auto max-sm:items-center",
      )}
    >
      {/* Phones: the lead cover is the cell, like a photo calendar. */}
      {lead && (
        <span aria-hidden className="absolute inset-0 sm:hidden">
          <GameCover name={lead.name} slug={lead.slug} image={lead.image} imageFallback={lead.imageFallback} width={120} sizes="56px" />
          <span className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/5 to-black/30" />
        </span>
      )}
      {number}
      {/* Drawn over the cover, which would hide an inset ring on the button itself. */}
      {selected && <span aria-hidden className="pointer-events-none absolute inset-0 z-[2] rounded-[inherit] ring-2 ring-inset ring-fg" />}
      {lead && list.length > 1 && (
        <span aria-hidden className="absolute bottom-1 right-1 z-[1] grid h-4 min-w-4 place-items-center rounded-full bg-black/70 px-1 text-[10px] font-bold tabular-nums text-white sm:hidden">
          {list.length}
        </span>
      )}
      {/* Wider screens: a fan of up to three covers, and how many more. */}
      {lead && (
        <span aria-hidden className="mt-auto hidden items-end sm:flex">
          {list.slice(0, 3).map((game, index) => (
            <span
              key={game.id}
              style={{ zIndex: 3 - index }}
              className={cn(
                "relative h-[54px] w-10 shrink-0 overflow-hidden rounded-[6px] shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] ring-1 ring-bg transition-transform duration-300 ease-out lg:h-[60px] lg:w-[45px]",
                index > 0 && "-ml-6 lg:-ml-7",
                index === 1 && "rotate-[5deg] fine:group-hover:translate-x-3 fine:group-hover:rotate-[8deg]",
                index === 2 && "rotate-[10deg] fine:group-hover:translate-x-6 fine:group-hover:rotate-[14deg]",
              )}
            >
              <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={100} sizes="45px" />
            </span>
          ))}
          {list.length > 3 && <span className="ml-auto pb-0.5 pl-1 text-[12px] font-semibold tabular-nums text-muted">+{list.length - 3}</span>}
        </span>
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* The selected day                                                           */
/* -------------------------------------------------------------------------- */

function DayPanel({
  day,
  games,
  signals,
  today,
  next,
  nextCount,
  onSelect,
  nextMonthHref,
  filtered,
  empty,
}: {
  day: string;
  games: GameSummary[];
  signals: ReleaseSignals;
  today: string | null;
  next: string | null;
  nextCount: (day: string) => number;
  onSelect: (day: string) => void;
  nextMonthHref: string;
  filtered: boolean;
  empty: boolean;
}) {
  const relative = relativeDay(day, today);
  const [lead, ...rest] = games;
  return (
    <section
      aria-live="polite"
      aria-labelledby="day-panel-title"
      className="mt-6 lg:sticky lg:top-[calc(var(--chrome-top)+1rem)] lg:mt-0 lg:max-h-[calc(100dvh-var(--chrome-top)-2rem)] lg:overflow-y-auto lg:overscroll-contain lg:rounded-3xl lg:border lg:border-line lg:bg-panel/40 lg:p-4 light:lg:bg-panel"
    >
      <h3 id="day-panel-title" className="flex items-baseline gap-2 px-0.5 text-[17px] font-semibold">
        <span className="min-w-0 truncate">{DAY_LONG.format(utcDate(day))}</span>
        {relative && <span className="shrink-0 text-[15px] font-medium text-brand-soft">{relative}</span>}
      </h3>

      {lead ? (
        <div className="mt-3 space-y-2">
          <LeadCard game={lead} signal={signals[lead.id]} />
          {rest.length > 0 && (
            <ul className="overflow-hidden rounded-2xl border border-line bg-panel/55 light:bg-panel">
              {rest.map((game) => (
                <li key={game.id} className="border-line [&:not(:first-child)]:border-t">
                  <ReleaseRow game={game} signal={signals[game.id]} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-line px-4 py-8 text-center">
          <p className="text-[15px] text-muted">
            {empty ? (filtered ? "Nothing matches your filters this month." : "Nothing dated this month yet.") : "Nothing launches this day."}
          </p>
          {next ? (
            <button
              type="button"
              onClick={() => onSelect(next)}
              className="press mt-3 inline-flex min-h-11 items-center gap-1 rounded-full bg-fg/[0.06] px-4 text-[14px] font-semibold text-text fine:hover:bg-fg/[0.1]"
            >
              Next: {DAY_MONTH_SHORT.format(utcDate(next))} · {nextCount(next)} {nextCount(next) === 1 ? "release" : "releases"}
              <ChevronRight size={15} aria-hidden />
            </button>
          ) : (
            <Link
              href={nextMonthHref}
              scroll={false}
              className="press mt-3 inline-flex min-h-11 items-center gap-1 rounded-full bg-fg/[0.06] px-4 text-[14px] font-semibold text-text fine:hover:bg-fg/[0.1]"
            >
              Next month <ChevronRight size={15} aria-hidden />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

/** The day's most anticipated release, over its own art. */
function LeadCard({ game, signal }: { game: GameSummary; signal?: ReleaseSignals[number] }) {
  const art = game.screenshots[0] ?? null;
  return (
    <article
      data-stage="dark"
      data-release-date={game.released ?? ""}
      className="relative isolate overflow-hidden rounded-2xl bg-panel text-white ring-1 ring-inset ring-white/10"
    >
      <Link prefetch={false} href={`/game/${game.slug}`} aria-label={game.name} className="absolute inset-0 -z-10">
        <GameCover
          name={game.name}
          slug={game.slug}
          image={art ?? game.image}
          imageFallback={art ? game.image : game.imageFallback}
          width={720}
          sizes="(max-width: 1024px) 100vw, 400px"
          className="object-cover"
        />
      </Link>
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-[5] bg-gradient-to-t from-black/90 via-black/45 to-black/10" />
      <div className="pointer-events-none flex min-h-[184px] items-end gap-3 p-3.5 sm:min-h-[200px]">
        <span className="relative h-[92px] w-[69px] shrink-0 overflow-hidden rounded-[10px] shadow-[0_10px_24px_-10px_rgba(0,0,0,0.9)] ring-1 ring-white/15">
          <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={160} sizes="69px" />
        </span>
        <div className="min-w-0 flex-1">
          {game.logo ? (
            <GameLogo name={game.name} logo={game.logo} surface="dark" height={36} className="max-w-[200px]" />
          ) : (
            <p className="line-clamp-2 font-display text-[20px] font-bold leading-[1.1] tracking-[-0.02em]">{game.name}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-white/80">
            <PlatformIcons platforms={game.parentPlatforms} size={13} max={4} />
            {signal?.hype !== undefined && <HypeBadge value={signal.hype} className="bg-black/45! text-[#ffd60a]!" />}
            {signal?.delays ? <DelayBadge count={signal.delays} className="bg-black/45! text-[#ff8aa0]!" /> : null}
          </div>
        </div>
        <WatchButton game={game} compact className="pointer-events-auto shrink-0" />
      </div>
    </article>
  );
}

function ReleaseRow({ game, signal }: { game: GameSummary; signal?: ReleaseSignals[number] }) {
  const genres = game.genres.slice(0, 2).map((genre) => genre.name.replace(/ \(.+\)$/, "")).join(" · ");
  return (
    <div data-release-date={game.released ?? ""} className="relative flex items-center gap-3 px-2.5 py-2.5 transition-colors fine:hover:bg-fg/[0.035]">
      <Link
        prefetch={false}
        href={`/game/${game.slug}`}
        aria-hidden
        tabIndex={-1}
        className="relative h-[64px] w-12 shrink-0 overflow-hidden rounded-[9px] ring-1 ring-inset ring-fg/10"
      >
        <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={120} sizes="48px" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link prefetch={false} href={`/game/${game.slug}`} className="truncate text-[15px] font-semibold leading-snug fine:hover:text-brand-soft">
          {game.name}
        </Link>
        <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted">
          <PlatformIcons platforms={game.parentPlatforms} size={12} max={4} className="shrink-0" />
          {genres && <span className="min-w-0 truncate text-faint">{genres}</span>}
        </div>
        {(signal?.hype !== undefined || signal?.delays) && (
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

function HypeBadge({ value, className }: { value: number; className?: string }) {
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

function DelayBadge({ count, className }: { count: number; className?: string }) {
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

/* -------------------------------------------------------------------------- */
/* Trays                                                                      */
/* -------------------------------------------------------------------------- */

function Tray({
  id,
  title,
  caption,
  games,
  signals,
  label,
  grid = false,
  more = null,
}: {
  id: string;
  title: string;
  caption: string;
  games: GameSummary[];
  signals: ReleaseSignals;
  label?: (game: GameSummary) => string | null;
  grid?: boolean;
  more?: string | null;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-12 scroll-mt-32 sm:mt-14">
      <div className="mx-auto mb-4 flex w-full max-w-[1400px] items-end justify-between gap-4 px-4 lg:px-6 xl:px-10">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">
            {title}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">{caption}</p>
        </div>
        {more && (
          <Link href={more} className="press inline-flex min-h-11 shrink-0 items-center gap-0.5 text-[15px] font-medium text-brand-soft fine:hover:text-text">
            See all <ChevronRight size={15} aria-hidden />
          </Link>
        )}
      </div>
      <ul
        className={cn(
          grid
            ? "mx-auto grid w-full max-w-[1400px] grid-cols-3 gap-x-3 gap-y-5 px-4 sm:grid-cols-4 lg:grid-cols-6 lg:px-6 xl:grid-cols-8 xl:px-10"
            : "snap-rail rail-gutter gap-3 pb-1 sm:gap-4",
        )}
      >
        {games.map((game) => (
          <li key={game.id} className={grid ? undefined : "w-[118px] sm:w-[140px]"}>
            <TrayCard game={game} hype={signals[game.id]?.hype} label={label?.(game) ?? null} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TrayCard({ game, hype, label }: { game: GameSummary; hype?: number; label: string | null }) {
  return (
    <article data-release-date={game.released ?? ""} className="group">
      <div data-stage="dark" className="relative aspect-[3/4] overflow-hidden rounded-[14px] bg-panel ring-1 ring-inset ring-fg/10">
        <Link prefetch={false} href={`/game/${game.slug}`} aria-label={game.name} className="absolute inset-0">
          <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={300} sizes="140px" />
        </Link>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1 p-1.5">
          {label ? (
            <span className="material-thin inline-flex h-6 min-w-0 items-center truncate rounded-full px-2 text-[11px] font-semibold text-white">{label}</span>
          ) : (
            <span />
          )}
          <WatchButton game={game} compact className="pointer-events-auto" />
        </div>
      </div>
      <Link prefetch={false} href={`/game/${game.slug}`} className="mt-2 line-clamp-2 block text-[13px] font-semibold leading-snug fine:group-hover:text-brand-soft">
        {game.name}
      </Link>
      {hype !== undefined && <HypeBadge value={hype} className="mt-1" />}
    </article>
  );
}
