/**
 * Pure date maths and grouping for the release calendar. Shared by the
 * server page and the client calendar, so it must stay free of "use client".
 */

import type { GameSummary } from "@/lib/games/types";
import { releaseState, releaseWindowInfo } from "@/lib/games/release-state";

/*
 * Release dates are UTC calendar days (that is how IGDB stores them and how
 * `releaseState` judges them), so every formatter and every bit of day maths
 * here is pinned to UTC. Mixing in the viewer's zone would file a midnight
 * launch under the wrong day for half the planet.
 */
// en-US like the rest of the site (`lib/utils/format.ts`).
const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
export const MONTH_TITLE = fmt({ month: "long", year: "numeric" });
export const MONTH_NAME = fmt({ month: "long" });
export const WEEKDAY_SHORT = fmt({ weekday: "short" });
/** "Tuesday, October 20" — a day heading. */
export const DAY_LONG = fmt({ weekday: "long", day: "numeric", month: "long" });
export const DAY_MONTH_SHORT = fmt({ day: "numeric", month: "short" });

export const utcDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
export const isoOf = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => isoOf(new Date(utcDate(iso).getTime() + days * 86_400_000));
export const dayDiff = (from: string, to: string) => Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000);
/** Monday of the ISO week containing `iso`. */
export const weekStartOf = (iso: string) => addDays(iso, -((utcDate(iso).getUTCDay() + 6) % 7));
/** Number of days in a `YYYY-MM` month. */
export const monthLength = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

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

/** Per-game list signals, keyed by game id. Plain data so it crosses the server/client boundary. */
export type ReleaseSignals = Record<number, { delays?: number; hype?: number }>;

export interface MonthBuckets {
  /** Exact-day releases keyed by ISO day, most anticipated first. */
  days: Map<string, GameSummary[]>;
  /** Known window but no day ("November 2026", "Q4 2026"), soonest window first. */
  windowed: GameSummary[];
}

/**
 * Buckets one month's releases. Three honesty tiers are kept apart, never
 * blended: exact days go on the grid; a known window goes in the "also
 * expected" tray under its own label; undated titles are fetched separately.
 *
 * Within a day the most anticipated game leads (its cover is the one the grid
 * shows), so a busy Friday is represented by the release people care about.
 */
export function bucketMonth(games: GameSummary[], signals: ReleaseSignals): MonthBuckets {
  const days = new Map<string, GameSummary[]>();
  const windowed: GameSummary[] = [];
  for (const game of games) {
    // Defense in depth: this is a future calendar, never a generic list.
    if (releaseState(game) !== "upcoming") continue;
    if (game.released) {
      const day = game.released.slice(0, 10);
      const list = days.get(day) ?? [];
      list.push(game);
      days.set(day, list);
    } else if (game.releaseWindow) {
      windowed.push(game);
    }
  }
  const hype = (game: GameSummary) => signals[game.id]?.hype ?? -1;
  for (const list of days.values()) list.sort((a, b) => hype(b) - hype(a) || (b.popScore ?? 0) - (a.popScore ?? 0) || a.name.localeCompare(b.name));
  const start = (game: GameSummary) => releaseWindowInfo(game.releaseWindow)?.start ?? "9999";
  windowed.sort((a, b) => start(a).localeCompare(start(b)) || hype(b) - hype(a));
  return { days, windowed };
}
