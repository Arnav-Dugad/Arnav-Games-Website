/**
 * Pure date maths and grouping for the release calendar. Shared by the
 * server page (week/month ranges) and the client views, so it must stay free
 * of "use client".
 */

import type { GameSummary } from "@/lib/games/types";
import { releaseState, releaseWindowInfo } from "@/lib/games/release-state";

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

/*
 * Release dates are UTC calendar days (that is how IGDB stores them and how
 * `releaseState` judges them), so every formatter and every bit of day maths
 * here is pinned to UTC. Mixing in the viewer's zone would file a midnight
 * launch under the wrong day for half the planet.
 */
// en-US like the rest of the site (`lib/utils/format.ts`): the calendar used
// to say "Tuesday 20 October" next to the home page's "Oct 20, 2026".
const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
export const MONTH_TITLE = fmt({ month: "long", year: "numeric" });
export const MONTH_NAME = fmt({ month: "long" });
export const WEEKDAY_LONG = fmt({ weekday: "long" });
export const WEEKDAY_SHORT = fmt({ weekday: "short" });
export const DAY_MONTH = fmt({ day: "numeric", month: "long" });
/** "Tuesday, October 20" — a day heading. */
export const DAY_LONG = fmt({ weekday: "long", day: "numeric", month: "long" });
export const DAY_MONTH_SHORT = fmt({ day: "numeric", month: "short" });
export const ROW_DATE = fmt({ weekday: "short", day: "numeric", month: "short" });

export const utcDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
export const isoOf = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => isoOf(new Date(utcDate(iso).getTime() + days * 86_400_000));
export const dayDiff = (from: string, to: string) => Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000);
/** Monday of the ISO week containing `iso`. */
export const weekStartOf = (iso: string) => addDays(iso, -((utcDate(iso).getUTCDay() + 6) % 7));

/** "October 20–26", or "Oct 28 – Nov 3" across a month boundary. */
export function rangeLabel(from: string, to: string): string {
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${DAY_MONTH.format(utcDate(from))}–${utcDate(to).getUTCDate()}`
    : `${DAY_MONTH_SHORT.format(utcDate(from))} – ${DAY_MONTH_SHORT.format(utcDate(to))}`;
}

export function relativeDay(iso: string, today: string | null): string | null {
  if (!today) return null;
  const days = dayDiff(today, iso);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7) return `In ${days} days`;
  if (days >= 7 && days < 14) return "Next week";
  if (days >= 14) return `In ${Math.round(days / 7)} weeks`;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Grouping                                                                   */
/* -------------------------------------------------------------------------- */

export interface DayGroup {
  /** ISO day, or `window:<month key>` for "sometime this month". */
  key: string;
  date: string | null;
  label: string;
  games: GameSummary[];
}

export interface CalendarSection {
  key: string;
  label: string;
  /** "month" sections hold day groups; "window"/"tba" sections hold rows. */
  kind: "month" | "window" | "tba";
  days: DayGroup[];
  count: number;
}

/**
 * Buckets releases for the calendar.
 *
 * Exact dates become day groups inside month sections. A month-level window
 * ("Nov 2026") joins that month as a trailing "Sometime in November" group,
 * so the calendar never shows two headings for one month. Wider windows get
 * their own sections under their own label, and anything genuinely undated
 * comes last.
 */
export function groupCalendar(games: GameSummary[]): CalendarSection[] {
  const months = new Map<string, { label: string; days: Map<string, DayGroup> }>();
  const windows = new Map<string, GameSummary[]>();
  const undated: GameSummary[] = [];

  const monthOf = (key: string) => {
    let month = months.get(key);
    if (!month) {
      month = { label: MONTH_TITLE.format(utcDate(`${key}-01`)), days: new Map() };
      months.set(key, month);
    }
    return month;
  };

  for (const game of games) {
    // Defense in depth: this is a future calendar, never a generic list. A
    // stale cache or provider inconsistency must not turn it into a feed of
    // recent releases.
    if (releaseState(game) !== "upcoming") continue;

    if (game.released) {
      const day = game.released.slice(0, 10);
      const month = monthOf(day.slice(0, 7));
      let group = month.days.get(day);
      if (!group) {
        const date = utcDate(day);
        group = { key: day, date: day, label: DAY_LONG.format(date), games: [] };
        month.days.set(day, group);
      }
      group.games.push(game);
      continue;
    }

    const window = releaseWindowInfo(game.releaseWindow);
    if (window?.precision === "month") {
      const key = window.start.slice(0, 7);
      const month = monthOf(key);
      const groupKey = `window:${key}`;
      let group = month.days.get(groupKey);
      if (!group) {
        group = { key: groupKey, date: null, label: `Sometime in ${MONTH_NAME.format(utcDate(window.start))}`, games: [] };
        month.days.set(groupKey, group);
      }
      group.games.push(game);
      continue;
    }

    if (game.releaseWindow) {
      const list = windows.get(game.releaseWindow) ?? [];
      list.push(game);
      windows.set(game.releaseWindow, list);
      continue;
    }

    undated.push(game);
  }

  const sections: CalendarSection[] = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, month]) => {
      // Dated days in order, then the month's "sometime" group.
      const days = [...month.days.values()].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
      return { key, label: month.label, kind: "month", days, count: days.reduce((sum, day) => sum + day.games.length, 0) };
    });

  const windowSections = [...windows.entries()]
    .sort(([a], [b]) => {
      const aStart = releaseWindowInfo(a)?.start ?? "9999";
      const bStart = releaseWindowInfo(b)?.start ?? "9999";
      return aStart.localeCompare(bStart) || a.localeCompare(b);
    })
    .map(([label, list]): CalendarSection => ({
      key: `w:${label}`,
      label,
      kind: "window",
      days: [{ key: `w:${label}`, date: null, label, games: list }],
      count: list.length,
    }));
  sections.push(...windowSections);

  if (undated.length > 0) {
    sections.push({
      key: "tba",
      label: "Date to be announced",
      kind: "tba",
      days: [{ key: "tba", date: null, label: "Date to be announced", games: undated }],
      count: undated.length,
    });
  }
  return sections;
}

export function sectionId(key: string) {
  return `cal-${key.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`;
}

/** Per-game list signals, keyed by game id. Plain data so it crosses the server/client boundary. */
export type ReleaseSignals = Record<number, { delays?: number; hype?: number }>;

