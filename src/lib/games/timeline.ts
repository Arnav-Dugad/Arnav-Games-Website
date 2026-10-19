/**
 * Release-timeline maths for studio, franchise and character pages.
 *
 * Everything here is pure and isomorphic: the stats bento runs it on the
 * server, the chart runs it again in the browser against the viewer's own
 * clock. Nothing is fetched — an `IgdbEntity` already carries every game as a
 * `GameSummary`, which has the date, critic score and engagement signals a
 * timeline needs. Re-fetching here would only duplicate IGDB traffic.
 *
 * Honesty rules, matching the rest of the release model:
 *  - A day-level date is plotted exactly.
 *  - A known window ("Q2 2027", "2027") is plotted at the window's midpoint
 *    and flagged `approximate`, and every label prints the window verbatim
 *    rather than an invented day.
 *  - A game with no date information at all is never placed on the axis; it is
 *    only counted, so the page can say how many were left off.
 */

import type { GameSummary } from "./types";
import { releaseState, releaseWindowInfo } from "./release-state";
import { formatDate, parseISO } from "@/lib/utils/format";

const DAY_MS = 86_400_000;
export const YEAR_MS = 365.2425 * DAY_MS;

/** The slim shape the chart needs — far smaller than a full `GameSummary` in the RSC payload. */
export interface TimelineGame {
  id: number;
  slug: string;
  name: string;
  image: string | null;
  imageFallback: string | null;
  /** Epoch ms of the plotted position: the exact day, or a window's midpoint. */
  t: number;
  /** Exact date ("Feb 25, 2022") or the window verbatim ("Q2 2027"). */
  label: string;
  /** True when `t` is a window midpoint rather than a real day. */
  approximate: boolean;
  /** Not out yet. Plotted hollow and never carries a score. */
  upcoming: boolean;
  /** 0–100 critic score; null when unscored or unreleased. */
  score: number | null;
  /**
   * Engagement signal for dot size. IGDB's rating count once a game is out,
   * its hype count before — the same proxy `GameSummary.added` documents.
   */
  weight: number;
}

/** Plots every game that has any date information, chronologically. */
export function toTimelineGames(games: GameSummary[], now: Date = new Date()): TimelineGame[] {
  const points: TimelineGame[] = [];

  for (const game of games) {
    const state = releaseState(game, now);
    let t: number | null = null;
    let label: string;
    let approximate = false;

    const exact = parseISO(game.released);
    if (exact) {
      t = exact.getTime();
      label = formatDate(game.released);
    } else {
      const window = releaseWindowInfo(game.releaseWindow);
      if (!window) continue;
      const start = parseISO(window.start)!.getTime();
      const end = parseISO(window.end)!.getTime();
      t = start + (end - start) / 2;
      label = game.releaseWindow!;
      approximate = true;
    }

    // "unknown" is a window that straddles today — it may or may not be out,
    // so it is drawn as not-yet-released rather than claimed as shipped.
    const upcoming = state !== "released";
    points.push({
      id: game.id,
      slug: game.slug,
      name: game.name,
      image: game.image,
      imageFallback: game.imageFallback,
      t,
      label,
      approximate,
      upcoming,
      score: upcoming ? null : game.metacritic,
      weight: Math.max(game.ratingsCount, game.added, 0),
    });
  }

  return points.sort((a, b) => a.t - b.t || a.name.localeCompare(b.name));
}

export interface CareerSummary {
  total: number;
  /** Released, day-dated games — the population every "career" figure is drawn from. */
  releasedCount: number;
  firstRelease: GameSummary | null;
  latestRelease: GameSummary | null;
  /** Whole calendar years from the first release to the latest, inclusive. */
  activeYears: number | null;
  averageScore: number | null;
  scoredCount: number;
  bestReviewed: GameSummary | null;
  /** Earliest future day-dated release; failing that, the nearest announced window. */
  nextUpcoming: GameSummary | null;
  upcomingCount: number;
  /** Mean days between consecutive distinct release dates. */
  cadenceDays: number | null;
  busiestYear: { year: string; count: number } | null;
}

export function summarizeCareer(games: GameSummary[], now: Date = new Date()): CareerSummary {
  const released = games
    .filter((game) => parseISO(game.released) && releaseState(game, now) === "released")
    .sort((a, b) => a.released!.localeCompare(b.released!));

  // Scores come from every released game, including the few IGDB dates only
  // to a month — the same population the chart plots — so the two agree.
  const scored = games.filter((game) => game.metacritic !== null && releaseState(game, now) === "released");
  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, game) => sum + game.metacritic!, 0) / scored.length)
    : null;

  // Ties broken by audience size: of two 96s, the one more people rated is the
  // one a reader is likelier to recognise.
  const bestReviewed =
    [...scored].sort(
      (a, b) => b.metacritic! - a.metacritic! || b.ratingsCount - a.ratingsCount,
    )[0] ?? null;

  // "unknown" with a window is a window that straddles today ("2026" in
  // October 2026): announced, not out, so it counts as upcoming — the same
  // call the chart makes when it draws it hollow.
  const upcoming = games.filter((game) => {
    const state = releaseState(game, now);
    return state === "upcoming" || (state === "unknown" && releaseWindowInfo(game.releaseWindow) !== null);
  });
  const datedUpcoming = upcoming
    .filter((game) => parseISO(game.released))
    .sort((a, b) => a.released!.localeCompare(b.released!));
  const windowedUpcoming = upcoming
    .map((game) => ({ game, window: releaseWindowInfo(game.releaseWindow) }))
    .filter((entry) => entry.window)
    .sort((a, b) => a.window!.start.localeCompare(b.window!.start));
  const nextUpcoming = datedUpcoming[0] ?? windowedUpcoming[0]?.game ?? null;

  // Same-day releases (a multi-platform launch IGDB splits into records, or a
  // bundle) are one release event, not a zero-day gap that drags the mean down.
  const days = [...new Set(released.map((game) => game.released!))];
  const cadenceDays =
    days.length >= 2
      ? (parseISO(days.at(-1))!.getTime() - parseISO(days[0])!.getTime()) / DAY_MS / (days.length - 1)
      : null;

  const perYear = new Map<string, number>();
  for (const game of released) {
    const year = game.released!.slice(0, 4);
    perYear.set(year, (perYear.get(year) ?? 0) + 1);
  }
  let busiestYear: CareerSummary["busiestYear"] = null;
  for (const [year, count] of perYear) {
    // Strictly greater keeps the earliest year on a tie — the one that set the record.
    if (!busiestYear || count > busiestYear.count) busiestYear = { year, count };
  }

  const firstRelease = released[0] ?? null;
  const latestRelease = released.at(-1) ?? null;

  return {
    total: games.length,
    releasedCount: released.length,
    firstRelease,
    latestRelease,
    activeYears:
      firstRelease && latestRelease
        ? Number(latestRelease.released!.slice(0, 4)) - Number(firstRelease.released!.slice(0, 4)) + 1
        : null,
    averageScore,
    scoredCount: scored.length,
    bestReviewed,
    nextUpcoming,
    upcomingCount: upcoming.length,
    cadenceDays,
    busiestYear: busiestYear && busiestYear.count > 1 ? busiestYear : null,
  };
}

/** "every 1.8 years" / "every 4 months" / "every 9 days". */
export function cadenceLabel(days: number): { value: string; unit: string } {
  if (days >= 365) {
    const years = Math.round((days / 365.2425) * 10) / 10;
    return { value: String(years), unit: years === 1 ? "year" : "years" };
  }
  if (days >= 45) {
    const months = Math.round(days / 30.44);
    return { value: String(months), unit: months === 1 ? "month" : "months" };
  }
  const whole = Math.max(1, Math.round(days));
  return { value: String(whole), unit: whole === 1 ? "day" : "days" };
}

export interface ScoreTrendPoint {
  t: number;
  score: number;
}

/**
 * A smoothed rolling average of critic scores, as polyline segments.
 *
 * A plain N-game moving average zig-zags wherever releases bunch up, and
 * connects across decade-long gaps as though the trend were known there. A
 * Gaussian kernel over time does neither: each sample is weighted by how close
 * in time the scored games are, and wherever there is too little nearby
 * evidence the line simply breaks instead of inventing a value.
 */
export function scoreTrend(points: TimelineGame[], start: number, end: number): ScoreTrendPoint[][] {
  const scored = points.filter((point) => point.score !== null).sort((a, b) => a.t - b.t);
  if (scored.length < 3 || end <= start) return [];

  // Never extrapolate: the line runs from the first scored game to the last,
  // so it can't drift past Today into releases nobody has reviewed.
  start = Math.max(start, scored[0].t);
  end = Math.min(end, scored.at(-1)!.t);
  if (end <= start) return [];

  const span = end - start;
  // Wide enough to smooth a single outlier, narrow enough that a studio's
  // decade-long arc still shows: ~1/14 of the range, never under a year and a half.
  const bandwidth = Math.max(1.5 * YEAR_MS, span / 14);
  const samples = Math.min(240, Math.max(60, Math.round(span / (YEAR_MS / 6))));

  const segments: ScoreTrendPoint[][] = [];
  let current: ScoreTrendPoint[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = start + (span * index) / samples;
    let weightSum = 0;
    let valueSum = 0;
    for (const point of scored) {
      const z = (point.t - t) / bandwidth;
      if (Math.abs(z) > 3) continue;
      const w = Math.exp(-0.5 * z * z);
      weightSum += w;
      valueSum += w * point.score!;
    }
    // ~0.6 is roughly one game within a single bandwidth; below that the
    // "average" would be one distant review stretched across empty years.
    if (weightSum >= 0.6) {
      current.push({ t, score: valueSum / weightSum });
    } else if (current.length) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  return segments.filter((segment) => segment.length >= 2);
}

/**
 * Console generations, as era bands behind the plot.
 *
 * Start dates are each generation's first major launch (Famicom, Mega Drive,
 * Saturn/PlayStation, Dreamcast, Xbox 360, Wii U, PS5/Series X). They are
 * industry history rather than per-entity data, so they are safe to hard-code.
 */
export const CONSOLE_ERAS: { label: string; title: string; start: string }[] = [
  { label: "Gen 2", title: "Atari 2600 · Intellivision", start: "1977-09-11" },
  { label: "Gen 3", title: "NES · Master System (8-bit)", start: "1983-07-15" },
  { label: "Gen 4", title: "SNES · Mega Drive (16-bit)", start: "1988-10-29" },
  { label: "Gen 5", title: "PlayStation · N64 · Saturn", start: "1994-11-22" },
  { label: "Gen 6", title: "PS2 · GameCube · Xbox · Dreamcast", start: "1998-11-27" },
  { label: "Gen 7", title: "PS3 · Xbox 360 · Wii", start: "2005-11-22" },
  { label: "Gen 8", title: "PS4 · Xbox One · Wii U · Switch", start: "2012-11-18" },
  { label: "Gen 9", title: "PS5 · Xbox Series X|S · Switch 2", start: "2020-11-10" },
];
