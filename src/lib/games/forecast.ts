/**
 * "At your pace you'll clear your backlog in March 2028."
 *
 * Pace comes from the reader's own history: the games they marked finished
 * (`finishedAt`) over the last twelve months — or all time, when the last
 * year is too thin — weighted by how long each one takes (their own logged
 * hours when they have them, else IGDB's time to beat). The backlog is the
 * same pile the library calls backlog: owned and unstarted, or "Want to
 * play", and out already; games in progress count half.
 *
 * Honest by construction: no forecast without at least three finished games
 * spread over six weeks, and every assumption is returned so the UI can say
 * what the date is built on. Pure; pinned by the self-checks.
 */

import type { TimeToBeatLike } from "./stats";
import { releaseState } from "./release-state";

export interface ForecastEntry {
  gameId: number;
  status: "none" | "want" | "playing" | "played";
  ownedOn?: string[];
  finishedAt?: number | null;
  released: string | null;
  releaseWindow?: string | null;
  tba?: boolean;
}

export interface BacklogForecast {
  /** Epoch ms of the projected clear date. */
  date: number;
  /** Games still to play (in-progress games count as one each here). */
  games: number;
  /** Hours still to play, estimated. */
  hours: number;
  /** Games whose length was unknown and were counted at the typical length. */
  estimatedGames: number;
  /** The typical length used for those, hours. */
  typicalHours: number;
  /** Finished games the pace is based on, and over how many days. */
  finished: number;
  windowDays: number;
  /** Hours finished per month at that pace. */
  hoursPerMonth: number;
  /** True when the projection is more than ten years out. */
  distant: boolean;
}

const DAY = 86_400_000;
const YEAR_DAYS = 365;
export const FORECAST_MIN_FINISHED = 3;
const MIN_WINDOW_DAYS = 42;

const lengthOf = (ttb: TimeToBeatLike | undefined) => ttb?.normally ?? ttb?.hastily ?? null;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function backlogForecast(
  entries: ForecastEntry[],
  timeToBeat: Record<number, TimeToBeatLike> | null,
  playtime: Record<number, number> = {},
  now = Date.now(),
): BacklogForecast | null {
  const finishedAll = entries.filter(
    (entry) => entry.status === "played" && (entry.ownedOn ?? []).length > 0 && typeof entry.finishedAt === "number" && entry.finishedAt <= now,
  );
  const lastYear = finishedAll.filter((entry) => now - (entry.finishedAt as number) <= YEAR_DAYS * DAY);
  const window = lastYear.length >= FORECAST_MIN_FINISHED ? lastYear : finishedAll;
  if (window.length < FORECAST_MIN_FINISHED) return null;
  const earliest = Math.min(...window.map((entry) => entry.finishedAt as number));
  // The window runs from the first finish to now (a year at most), so a
  // burst last week doesn't read as a lifetime pace.
  const windowDays = Math.min(window === lastYear ? YEAR_DAYS : Infinity, (now - earliest) / DAY);
  if (windowDays < MIN_WINDOW_DAYS) return null;

  const effort = (entry: ForecastEntry) => playtime[entry.gameId] ?? lengthOf(timeToBeat?.[entry.gameId]);
  const known = window.map(effort).filter((hours): hours is number => typeof hours === "number" && hours > 0);
  const lengths = entries
    .filter((entry) => (entry.ownedOn ?? []).length > 0)
    .map((entry) => lengthOf(timeToBeat?.[entry.gameId])).filter((hours): hours is number => typeof hours === "number" && hours > 0);
  const typicalHours = Math.round(median([...known, ...lengths]) ?? 15);
  // Finished games with no length at all are counted at the typical length too.
  const doneHours = window.reduce((sum, entry) => sum + (effort(entry) ?? typicalHours), 0);
  const hoursPerDay = doneHours / windowDays;
  if (!(hoursPerDay > 0)) return null;

  const released = (entry: ForecastEntry) => releaseState({ released: entry.released, releaseWindow: entry.releaseWindow ?? null, tba: entry.tba ?? false }, new Date(now)) !== "upcoming";
  const owned = (entry: ForecastEntry) => (entry.ownedOn ?? []).length > 0;
  // The same pile the backlog-hours figure counts (stats.ts `buildHours`):
  // everything in progress, plus owned games not started yet.
  const backlog = entries.filter(
    (entry) => released(entry) && (entry.status === "playing" || (owned(entry) && (entry.status === "want" || entry.status === "none"))),
  );
  if (backlog.length === 0) return null;

  let hours = 0;
  let estimatedGames = 0;
  for (const entry of backlog) {
    let length = lengthOf(timeToBeat?.[entry.gameId]);
    if (length === null) {
      length = typicalHours;
      estimatedGames++;
    }
    // In progress: the logged hours come off the length, or half when none are logged.
    if (entry.status === "playing") length = Math.max(length * 0.15, playtime[entry.gameId] ? length - playtime[entry.gameId] : length / 2);
    hours += length;
  }

  const days = hours / hoursPerDay;
  return {
    date: now + days * DAY,
    games: backlog.length,
    hours: Math.round(hours),
    estimatedGames,
    typicalHours,
    finished: window.length,
    windowDays: Math.round(windowDays),
    hoursPerMonth: Math.round(hoursPerDay * 30.44),
    distant: days > YEAR_DAYS * 10,
  };
}
