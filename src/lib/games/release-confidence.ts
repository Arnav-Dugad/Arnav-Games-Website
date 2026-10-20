/**
 * Release-date confidence: how likely an upcoming game's current date is to
 * hold, 0–100, with the reasons. Pure — the game page runs it with the
 * studio's track record once that arrives, the release calendar with what
 * its rows already carry — and pinned down in `scripts/check-providers.ts`.
 *
 * A heuristic, said plainly in the UI: there is no public dataset of "dates
 * that held", so the weights encode well-known patterns rather than a fitted
 * model. Each adjustment becomes a visible reason, so the reader can judge
 * the number by what went into it:
 *
 *  - Precision: an exact day is a commitment; "2027" is an intention.
 *  - Time left: dates rarely move in the last weeks, often a year out.
 *  - Past delays (our own tracker): a game that slipped once slips again
 *    more often than one that never has.
 *  - The studio's record (our tracker, its other games), when there's
 *    enough of it to mean something.
 *  - IGDB's status: a "rumored" game has no committed date at all.
 *  - The last weeks of a 31 March financial year, where publishers decide
 *    which side of the line a game lands.
 *  - Heavy attention: a big, firmly dated launch has marketing booked
 *    around it.
 */

import type { ReleaseWindowPrecision } from "./release-state";

export type DatePrecision = "day" | ReleaseWindowPrecision;
export type ConfidenceLabel = "Very likely" | "Could slip" | "Shaky";

export interface ConfidenceReason {
  /** Points this signal added or took away (0 for context). */
  effect: number;
  text: string;
}

export interface ReleaseConfidence {
  score: number;
  label: ConfidenceLabel;
  tone: "good" | "fair" | "poor";
  reasons: ConfidenceReason[];
}

export interface ReleaseConfidenceInput {
  /** YYYY-MM-DD, UTC. */
  today: string;
  precision: DatePrecision;
  /** The day, or a window's last day (the date the promise expires). */
  date: string;
  /** Times the date has moved later, from our tracker. */
  delays: number;
  /** The developer's record from our tracker, null when unknown. */
  studio: { name: string; tracked: number; delayed: number } | null;
  status?: "alpha" | "beta" | "early-access" | "rumored" | null;
  /** Publishers, for the financial-year check. */
  publishers?: string[];
  /** IGDB follows ("hypes"). */
  follows?: number;
}

/** Starting points by precision: how firm the promise is before anything else. */
const BASE: Record<DatePrecision, number> = { day: 78, month: 60, quarter: 50, period: 44, year: 36 };
const PRECISION_TEXT: Record<DatePrecision, string> = {
  day: "It has an exact release day.",
  month: "Only the month is announced, not the day.",
  quarter: "Only a quarter is announced.",
  period: "Only a rough window is announced (early, mid or late in the year).",
  year: "Only the year is announced.",
};
/**
 * A studio's record counts once we've watched this many of its games for
 * this long — the same bar as the studio page's "Does it ship on time?": a
 * date can only slip while we're looking, so a week of watching proves
 * nothing.
 */
export const MIN_STUDIO_GAMES = 3;
export const MIN_STUDIO_DAYS = 30;

/** The record's on-time numbers when they mean something by that bar, else null. */
export function usableStudioRecord(
  reliability: { tracked: number; delayed: number; since: string | null } | null | undefined,
  today: string,
): { tracked: number; delayed: number } | null {
  if (!reliability?.since || reliability.tracked < MIN_STUDIO_GAMES) return null;
  const watched = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${reliability.since}T00:00:00Z`)) / 86_400_000;
  return watched >= MIN_STUDIO_DAYS ? { tracked: reliability.tracked, delayed: reliability.delayed } : null;
}
/** The on-time rate that counts as ordinary; better adds, worse subtracts. */
const TYPICAL_ON_TIME = 0.75;

/*
 * Publishers whose financial year ends on 31 March (Japan's convention, and
 * several Western publishers). Dates in the year's last six weeks are where a
 * slip into the next financial year most often happens.
 */
const MARCH_YEAR_END = /\b(nintendo|sony|capcom|square enix|sega|bandai namco|konami|koei tecmo|electronic arts|take-two|2k|rockstar|ubisoft|kadokawa|atlus|level-5|spike chunsoft|nis america|marvelous)\b/i;

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export function confidenceLabel(score: number): { label: ConfidenceLabel; tone: ReleaseConfidence["tone"] } {
  if (score >= 75) return { label: "Very likely", tone: "good" };
  if (score >= 50) return { label: "Could slip", tone: "fair" };
  return { label: "Shaky", tone: "poor" };
}

/** Null when the date is already here (or past): there's nothing left to hold. */
export function releaseConfidence(input: ReleaseConfidenceInput): ReleaseConfidence | null {
  const days = daysBetween(input.today, input.date);
  if (!Number.isFinite(days) || days < 0 || (input.precision === "day" && days === 0)) return null;

  const reasons: ConfidenceReason[] = [];
  let score = BASE[input.precision];
  const adjust = (effect: number, text: string) => {
    score += effect;
    reasons.push({ effect, text });
  };
  reasons.push({ effect: 0, text: PRECISION_TEXT[input.precision] });

  // Time left (for a window, until it closes).
  const until = input.precision === "day" ? `${days} ${days === 1 ? "day" : "days"} away` : `the window closes in ${days} days`;
  if (days <= 14) adjust(16, `Very close: ${until}. Dates this near rarely move.`);
  else if (days <= 45) adjust(10, `Close: ${until}.`);
  else if (days <= 90) adjust(5, `${days} days to go — inside the stretch where most delays have already been announced.`);
  else if (days > 365) adjust(-12, "More than a year away — plenty of time for plans to change.");
  else if (days > 180) adjust(-6, `${Math.round(days / 30)} months away — most delays are announced in this stretch.`);
  else reasons.push({ effect: 0, text: `About ${Math.round(days / 30)} months to go — delays are still announced at this distance, but less often.` });

  // Past delays.
  if (input.delays > 0) {
    adjust(-Math.min(21, input.delays * 7), `Already delayed ${input.delays === 1 ? "once" : `${input.delays} times`} since we started watching it.`);
  }

  // The studio's record.
  const studio = input.studio;
  if (studio && studio.tracked >= MIN_STUDIO_GAMES) {
    const onTime = (studio.tracked - studio.delayed) / studio.tracked;
    const effect = Math.max(-12, Math.min(8, Math.round((onTime - TYPICAL_ON_TIME) * 32)));
    const rate = `${studio.tracked - studio.delayed} of ${studio.tracked} watched games`;
    if (effect > 0) adjust(effect, `${studio.name} usually ships on time: ${rate} kept their date.`);
    else if (effect < 0) adjust(effect, `${studio.name}'s dates often move: only ${rate} kept their date.`);
    else reasons.push({ effect: 0, text: `${studio.name}'s record is typical: ${rate} kept their date.` });
  }

  // IGDB's status.
  if (input.status === "rumored") adjust(-15, "IGDB lists it as rumoured — not officially committed.");
  else if (input.status === "early-access") adjust(-6, "It's in early access; full-release dates move often.");

  // The end of a March financial year.
  const month = Number(input.date.slice(5, 7));
  const dayOfMonth = Number(input.date.slice(8, 10));
  const yearEnd = month === 3 || (month === 2 && dayOfMonth >= 15);
  if (yearEnd && days > 30 && (input.publishers ?? []).some((name) => MARCH_YEAR_END.test(name))) {
    adjust(-4, "It lands in the last weeks of its publisher's financial year, when dates are often reshuffled.");
  }

  // A big, firmly dated launch.
  if (input.precision === "day" && (input.follows ?? 0) >= 300 && days <= 180) {
    adjust(3, "A heavily followed game with an exact date — launch marketing is booked around it.");
  }

  score = Math.max(5, Math.min(97, Math.round(score)));
  // An exact day within a week is as good as out.
  if (input.precision === "day" && days <= 7) score = Math.max(score, 90);
  return { score, ...confidenceLabel(score), reasons };
}
