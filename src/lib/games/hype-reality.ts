/**
 * Hype vs reality: did the games people followed hardest before launch turn
 * out better than the ones nobody was watching?
 *
 * The data is IGDB's `hypes` (follows gathered before release) against the
 * score the game landed at — the critics' aggregate when at least three
 * critics reviewed it, otherwise the members' rating when enough members did.
 * Hype is spread over four orders of magnitude, so it is compared on a log
 * scale, with an ordinary least-squares line through the cloud: "what this
 * much hype usually lands at". Each game's distance from that line, in
 * standard deviations, is what makes it an over-hyped release or a sleeper
 * hit — not a raw score.
 *
 * Pure, so the stats page, the game page's note and the checks all agree.
 */

export interface HypeRow {
  id: number;
  slug: string;
  name: string;
  image: string | null;
  hypes: number;
  /** 0–100. */
  score: number;
  scoreKind: "critics" | "members";
  /** Reviews (critics) or ratings (members) behind `score`. */
  count: number;
  /** ISO date. */
  released: string;
}

export interface HypePoint extends HypeRow {
  /** log10(hypes). */
  x: number;
  expected: number;
  /** score − expected, in standard deviations of the residuals. */
  z: number;
  tag: "over" | "sleeper" | null;
}

export interface HypeModel {
  /** score ≈ intercept + slope · log10(hypes). */
  intercept: number;
  slope: number;
  /** Pearson correlation of log hype and score. */
  r: number;
  /** Standard deviation of the residuals, in points. */
  spread: number;
  /** Sorted hype counts of the sample, for percentiles. */
  hypes: number[];
  sample: number;
}

export interface HypeReality {
  model: HypeModel;
  points: HypePoint[];
  over: HypePoint[];
  sleepers: HypePoint[];
  from: string;
  to: string;
}

export const HYPE_MIN_SAMPLE = 12;
const OUTLIER_Z = 1.1;
const LABELLED = 3;

export function fitHype(rows: Array<{ hypes: number; score: number }>): HypeModel | null {
  const usable = rows.filter((row) => row.hypes > 0 && Number.isFinite(row.score));
  if (usable.length < HYPE_MIN_SAMPLE) return null;
  const xs = usable.map((row) => Math.log10(row.hypes));
  const ys = usable.map((row) => row.score);
  const n = usable.length;
  const mx = xs.reduce((sum, x) => sum + x, 0) / n;
  const my = ys.reduce((sum, y) => sum + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]));
  const spread = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(1, n - 2));
  return {
    intercept,
    slope,
    r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0,
    spread: spread || 1,
    hypes: usable.map((row) => row.hypes).sort((a, b) => a - b),
    sample: n,
  };
}

export const expectedScore = (model: HypeModel, hypes: number) => model.intercept + model.slope * Math.log10(Math.max(1, hypes));

/** Share of the sample with less hype than `hypes`, 0–1. */
export function hypePercentile(model: HypeModel, hypes: number): number {
  let below = 0;
  for (const value of model.hypes) if (value < hypes) below++;
  return model.hypes.length ? below / model.hypes.length : 0;
}

export function analyseHype(rows: HypeRow[]): HypeReality | null {
  const model = fitHype(rows);
  if (!model) return null;
  const median = model.hypes[Math.floor(model.hypes.length / 2)];
  const points: HypePoint[] = rows
    .filter((row) => row.hypes > 0)
    .map((row) => {
      const expected = expectedScore(model, row.hypes);
      const z = (row.score - expected) / model.spread;
      // Over-hyped needs real hype to be over; a sleeper needs to have been sleeping.
      const tag = z <= -OUTLIER_Z && row.hypes >= median ? "over" : z >= OUTLIER_Z && row.hypes <= median * 2 ? "sleeper" : null;
      return { ...row, x: Math.log10(row.hypes), expected, z, tag };
    });
  const over = points.filter((point) => point.tag === "over").sort((a, b) => a.z - b.z).slice(0, LABELLED);
  const sleepers = points.filter((point) => point.tag === "sleeper").sort((a, b) => b.z - a.z).slice(0, LABELLED);
  const dates = points.map((point) => point.released).sort();
  return { model, points, over, sleepers, from: dates[0], to: dates[dates.length - 1] };
}

export interface HypeNote {
  tone: "over" | "sleeper" | "met";
  headline: string;
  detail: string;
}

const compact = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

/**
 * The game page's one-paragraph verdict, or null when there isn't enough to
 * say (no model, no score, almost no hype). Judged against recent releases,
 * so the sentence says which.
 */
export function hypeNote(
  game: { hypes: number; score: number | null; scoreKind: "critics" | "members" },
  model: HypeModel | null,
): HypeNote | null {
  if (!model || game.score === null || game.hypes < 3) return null;
  const expected = expectedScore(model, game.hypes);
  const gap = Math.round(game.score - expected);
  const z = (game.score - expected) / model.spread;
  const percentile = Math.round(hypePercentile(model, game.hypes) * 100);
  const who = game.scoreKind === "critics" ? "Critics" : "IGDB members";
  const followers = `${compact(game.hypes)} ${game.hypes === 1 ? "person" : "people"} followed it on IGDB before launch`;
  const hype = percentile >= 50
    ? `${followers}, more than ${percentile}% of the recent releases we compared`
    : `${followers}, a quieter build-up than ${100 - percentile}% of the recent releases we compared`;
  if (z <= -0.75) {
    return {
      tone: "over",
      headline: "Hype outran the game",
      detail: `${hype}. ${who} scored it ${Math.round(game.score)}, about ${Math.abs(gap)} points below what that much hype usually brings.`,
    };
  }
  if (z >= 0.75) {
    return {
      tone: "sleeper",
      headline: game.hypes <= model.hypes[Math.floor(model.hypes.length / 2)] ? "A sleeper hit" : "Better than the hype",
      detail: `${hype}. ${who} scored it ${Math.round(game.score)}, about ${gap} points above what that much hype usually brings.`,
    };
  }
  return {
    tone: "met",
    headline: "Lived up to the hype",
    detail: `${hype}. ${who} scored it ${Math.round(game.score)}, right about where that much hype usually lands.`,
  };
}
