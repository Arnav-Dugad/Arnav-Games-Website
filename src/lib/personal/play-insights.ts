/**
 * Personal play analytics that need more than the library snapshot: what the
 * reader actually finishes (by genre, theme and platform) and when they play
 * (a day × hour heatmap and a year of play days).
 *
 * Pure and deterministic — the browser passes in the library, its own hours
 * and journal, and a clock/time-zone function, and `scripts/check-providers.ts`
 * pins the rules down with a fixed zone. Nothing here reads the device clock
 * or zone by itself, because both differ between the server render and the
 * reader's browser; the components call these only after mount.
 *
 * The library has no "abandoned" status, and inventing one would mean asking
 * people to admit defeat in a menu. The outcome is inferred instead, and the
 * UI says how:
 *  - finished: marked Played;
 *  - playing: marked Playing and touched in the last `STALL_DAYS`;
 *  - stalled: marked Playing but untouched for longer, or never given a status
 *    yet with hours on record (started, then shelved — Steam imports land here);
 *  - untouched: owned, released, no hours, no status beyond a wish.
 */

import type { WatchlistEntry } from "@/lib/firebase/db";
import { releaseState } from "@/lib/games/release-state";
import { platformLabel, playPlatform } from "@/lib/games/stats";

export const STALL_DAYS = 90;
/** A row says a rate only once this many of its games have an outcome. */
export const MIN_RESOLVED = 3;
const DAY_MS = 86_400_000;

export type FinishOutcome = "finished" | "playing" | "stalled" | "untouched";

/** A journal session, as far as these analytics care. */
export interface PlaySession {
  gameId: number;
  /** Epoch ms the session was logged — usually just after it ended. */
  at: number;
  /** Session length in hours, when given. */
  hours: number | null;
}

export interface FinishContext {
  /** gameId → the reader's own hours (journal, manual or Steam import). */
  playtime?: Record<number, number>;
  journal?: PlaySession[];
  now?: number;
}

/** Released (or evidently playable) — pre-orders can't be finished yet. */
function playable(entry: WatchlistEntry): boolean {
  const state = releaseState(entry);
  return state === "released" || (state === "unknown" && (entry.status === "playing" || entry.status === "played"));
}

export function finishOutcome(entry: WatchlistEntry, context: FinishContext & { lastSession?: number | null } = {}): FinishOutcome {
  const now = context.now ?? Date.now();
  if (entry.status === "played") return "finished";
  if (entry.status === "playing") {
    const last = Math.max(entry.startedAt ?? 0, context.lastSession ?? 0, entry.addedAt ?? 0);
    return last > 0 && now - last > STALL_DAYS * DAY_MS ? "stalled" : "playing";
  }
  return (context.playtime?.[entry.gameId] ?? 0) > 0 ? "stalled" : "untouched";
}

export interface FinishRow {
  key: string;
  label: string;
  finished: number;
  playing: number;
  stalled: number;
  untouched: number;
  total: number;
  /** finished ÷ (finished + stalled): of the games with an outcome, how many were seen through. */
  rate: number | null;
}

export interface FinishHighlight {
  best: FinishRow;
  worst: FinishRow;
}

export interface FinishRates {
  /** Games considered: owned or played, and released. */
  base: number;
  totals: Omit<FinishRow, "key" | "label">;
  genres: FinishRow[];
  themes: FinishRow[];
  platforms: FinishRow[];
  /** The sharpest contrast worth a sentence, per dimension; null when nothing clears the bar. */
  highlight: { genres: FinishHighlight | null; themes: FinishHighlight | null; platforms: FinishHighlight | null };
}

const emptyCounts = () => ({ finished: 0, playing: 0, stalled: 0, untouched: 0, total: 0 });

function rateOf(row: { finished: number; stalled: number }): number | null {
  const resolved = row.finished + row.stalled;
  return resolved >= 1 ? row.finished / resolved : null;
}

function rowsFrom(map: Map<string, { label: string; counts: ReturnType<typeof emptyCounts> }>, limit: number): FinishRow[] {
  return [...map]
    .map(([key, { label, counts }]) => ({ key, label, ...counts, rate: rateOf(counts) }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Best and worst rate among rows with enough outcomes, when they're far enough apart to say so. */
export function finishHighlight(rows: FinishRow[], gap = 0.2): FinishHighlight | null {
  const ranked = rows
    .filter((row) => row.finished + row.stalled >= MIN_RESOLVED && row.rate !== null && row.key !== "unassigned")
    .sort((a, b) => b.rate! - a.rate! || b.total - a.total);
  if (ranked.length < 2) return null;
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  return best.rate! - worst.rate! >= gap ? { best, worst } : null;
}

export function finishRates(
  entries: WatchlistEntry[],
  context: FinishContext & { themes?: Record<number, Array<{ id: number; name: string }>> } = {},
): FinishRates {
  const lastSession = new Map<number, number>();
  for (const session of context.journal ?? []) {
    lastSession.set(session.gameId, Math.max(lastSession.get(session.gameId) ?? 0, session.at));
  }

  const seen = new Set<number>();
  const games = entries.filter((entry) => {
    if (seen.has(entry.gameId)) return false;
    seen.add(entry.gameId);
    const counts = (entry.ownedOn ?? []).length > 0 || entry.status === "playing" || entry.status === "played";
    return counts && playable(entry);
  });

  const totals = emptyCounts();
  const genres = new Map<string, { label: string; counts: ReturnType<typeof emptyCounts> }>();
  const themes = new Map<string, { label: string; counts: ReturnType<typeof emptyCounts> }>();
  const platforms = new Map<string, { label: string; counts: ReturnType<typeof emptyCounts> }>();
  const bump = (map: typeof genres, key: string, label: string, outcome: FinishOutcome) => {
    const row = map.get(key) ?? { label, counts: emptyCounts() };
    row.counts[outcome]++;
    row.counts.total++;
    map.set(key, row);
  };

  for (const game of games) {
    const outcome = finishOutcome(game, { ...context, lastSession: lastSession.get(game.gameId) ?? null });
    totals[outcome]++;
    totals.total++;
    for (const genre of game.genres ?? []) bump(genres, `g${genre.id}`, genre.name, outcome);
    for (const theme of context.themes?.[game.gameId] ?? []) bump(themes, `t${theme.id}`, theme.name, outcome);
    const platform = playPlatform(game);
    bump(platforms, platform ?? "unassigned", platform ? platformLabel(platform) : "Platform not set", outcome);
  }

  const genreRows = rowsFrom(genres, 10);
  const themeRows = rowsFrom(themes, 10);
  const platformRows = rowsFrom(platforms, 8);
  return {
    base: games.length,
    totals: { ...totals, rate: rateOf(totals) },
    genres: genreRows,
    themes: themeRows,
    platforms: platformRows,
    highlight: {
      genres: finishHighlight(genreRows),
      themes: finishHighlight(themeRows),
      platforms: finishHighlight(platformRows),
    },
  };
}

/* ---------------------------------------------------------------------------
 * When you play
 * ------------------------------------------------------------------------ */

/** A moment in the reader's own zone. `weekday`: 0 = Monday … 6 = Sunday. */
export interface LocalMoment {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

/** The device's own zone. Only ever called after mount. */
export function deviceMoment(at: number): LocalMoment {
  const date = new Date(at);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    weekday: (date.getDay() + 6) % 7,
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/** A fixed UTC offset, for the checks (and nothing else). */
export function offsetMoment(offsetMinutes: number): (at: number) => LocalMoment {
  return (at) => {
    const date = new Date(at + offsetMinutes * 60_000);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      weekday: (date.getUTCDay() + 6) % 7,
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    };
  };
}

export const dayKey = (moment: Pick<LocalMoment, "year" | "month" | "day">) =>
  `${moment.year}-${String(moment.month).padStart(2, "0")}-${String(moment.day).padStart(2, "0")}`;

/** A session without a length counts as this many hours, at the hour it was logged. */
export const UNTIMED_SESSION_HOURS = 1;

export interface DayHourGrid {
  /** [weekday 0–6, Monday first][hour 0–23] → hours. */
  cells: number[][];
  max: number;
  sessions: number;
  hours: number;
  /** The single busiest cell. */
  peak: { weekday: number; hour: number; hours: number } | null;
  /** Hours per weekday and per hour, for the margins. */
  byWeekday: number[];
  byHour: number[];
}

/**
 * Hours played by weekday and hour of day. A session is logged when it ends,
 * so its hours are laid backwards from `at`, an hour per cell — a three-hour
 * evening session lights 19:00, 20:00 and 21:00, not just 22:00.
 */
export function dayHourGrid(sessions: PlaySession[], zone: (at: number) => LocalMoment = deviceMoment): DayHourGrid {
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let hours = 0;
  for (const session of sessions) {
    let remaining = session.hours && session.hours > 0 ? Math.min(48, session.hours) : UNTIMED_SESSION_HOURS;
    hours += remaining;
    // Walk back from the log time (an exclusive end), filling the partial
    // hour first. Local minutes, not epoch maths: half-hour zones (India) have
    // their hour boundaries at :30 UTC.
    let cursor = session.at;
    while (remaining > 1e-9) {
      const moment = zone(cursor - 1);
      const elapsed = (moment.minute * 60_000 + (((cursor - 1) % 60_000) + 60_000) % 60_000 + 1) / 3_600_000;
      const slice = Math.min(remaining, elapsed);
      cells[moment.weekday][moment.hour] += slice;
      remaining -= slice;
      cursor -= slice * 3_600_000;
    }
  }
  let peak: DayHourGrid["peak"] = null;
  let max = 0;
  cells.forEach((row, weekday) =>
    row.forEach((value, hour) => {
      if (value > max) {
        max = value;
        peak = { weekday, hour, hours: value };
      }
    }),
  );
  return {
    cells,
    max,
    sessions: sessions.length,
    hours,
    peak,
    byWeekday: cells.map((row) => row.reduce((sum, value) => sum + value, 0)),
    byHour: Array.from({ length: 24 }, (_, hour) => cells.reduce((sum, row) => sum + row[hour], 0)),
  };
}

export interface CalendarDay {
  key: string;
  /** Hours logged that day (sessions without a length count one hour). */
  hours: number;
  sessions: number;
  /** Started or finished a game that day. */
  milestones: number;
}

export interface PlayCalendar {
  /** Oldest first, `weeks × 7` days, Monday-first columns ending with the week of `today`. */
  days: Array<CalendarDay & { weekday: number; future: boolean }>;
  weeks: number;
  activeDays: number;
  longestStreak: number;
  currentStreak: number;
  /** Month labels: the column where each month starts. */
  months: Array<{ column: number; month: number; year: number }>;
}

/**
 * A year of play days, GitHub-style. Sessions give a day its hours; starting
 * or finishing a game marks it active too (a lighter cell), because the day
 * you finished something is a day you played it.
 */
export function playCalendar(
  sessions: PlaySession[],
  milestones: number[],
  { now = Date.now(), weeks = 53, zone = deviceMoment }: { now?: number; weeks?: number; zone?: (at: number) => LocalMoment } = {},
): PlayCalendar {
  const byDay = new Map<string, CalendarDay>();
  const day = (key: string) => {
    const existing = byDay.get(key);
    if (existing) return existing;
    const created = { key, hours: 0, sessions: 0, milestones: 0 };
    byDay.set(key, created);
    return created;
  };
  for (const session of sessions) {
    const cell = day(dayKey(zone(session.at)));
    cell.hours += session.hours && session.hours > 0 ? session.hours : UNTIMED_SESSION_HOURS;
    cell.sessions++;
  }
  for (const at of milestones) if (at > 0) day(dayKey(zone(at))).milestones++;

  // Walk the calendar in local dates. Noon anchors avoid DST edges: stepping
  // a day from local noon always lands on the next local date.
  const today = zone(now);
  const todayNoon = Date.UTC(today.year, today.month - 1, today.day, 12);
  const firstMonday = todayNoon - (today.weekday + (weeks - 1) * 7) * DAY_MS;
  const days: PlayCalendar["days"] = [];
  const months: PlayCalendar["months"] = [];
  let run = 0;
  let longestStreak = 0;
  let activeDays = 0;
  for (let index = 0; index < weeks * 7; index++) {
    const date = new Date(firstMonday + index * DAY_MS);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    const future = date.getTime() > todayNoon;
    const cell = byDay.get(key) ?? { key, hours: 0, sessions: 0, milestones: 0 };
    days.push({ ...cell, weekday: index % 7, future });
    if (date.getUTCDate() === 1 || index === 0) {
      const column = Math.floor(index / 7);
      if (!months.some((month) => month.column === column)) months.push({ column, month: date.getUTCMonth() + 1, year: date.getUTCFullYear() });
    }
    if (future) continue;
    const active = cell.sessions + cell.milestones > 0;
    if (active) {
      activeDays++;
      run++;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 0;
    }
  }
  // Today not played yet doesn't break a streak that ran through yesterday.
  const past = days.filter((cell) => !cell.future);
  let currentStreak = 0;
  for (let index = past.length - 1; index >= 0; index--) {
    const active = past[index].sessions + past[index].milestones > 0;
    if (active) currentStreak++;
    else if (index === past.length - 1) continue;
    else break;
  }
  return { days, weeks, activeDays, longestStreak, currentStreak, months };
}
