/**
 * Pure rules behind the review-velocity, Twitch and critic-score histories
 * (`reviews.ts`, `twitch-history.ts`, `scores.ts`). No network, D1 or Next,
 * so `scripts/check-providers.ts` can pin them down.
 *
 * Every series is our own sampling, so every summary is careful to claim
 * only what the samples cover: a 72-hour launch figure needs samples that
 * actually bracket the launch window, a per-day rate needs at least half a
 * day of span, and nothing is extrapolated.
 */

import type { ReviewVelocity, ScoreTimeline, TwitchHistory } from "./types";

const HOUR = 3600;
const DAY = 24 * HOUR;
const BUCKET = 6 * HOUR;

const isoDay = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/* ---------------------------------------------------------------------------
 * Review velocity
 * ------------------------------------------------------------------------ */

/** How far after launch the first sample may be and still count as "at launch". */
export const LAUNCH_SLACK = 6 * HOUR;
/** How far either side of launch + 72 h the closing sample may be. */
const WINDOW_SLACK = 6 * HOUR;

/**
 * Hourly Steam review totals → `ReviewVelocity`.
 *
 *  - first72h: reviews and % positive added between launch and launch + 72 h,
 *    from our own samples. The opening figure is the last sample at or before
 *    launch, or failing that one within 6 h after it (reviews a few hours in
 *    are then slightly undercounted, never inflated); the closing figure is
 *    the sample nearest launch + 72 h within ±6 h. Null when we didn't
 *    sample both ends — e.g. the game was first tracked a week after launch.
 *  - perDay: new reviews per day over the last 7 days of samples, from the
 *    first and last sample in that window; null below 12 h of span.
 *
 * `launch` is unix seconds (UTC midnight of the release date) or null.
 */
export function reviewVelocity(
  appId: number,
  samples: Array<{ hour: number; total: number; positive: number }>,
  launch: number | null,
  now: number,
): ReviewVelocity {
  const ordered = samples
    .filter((s) => Number.isFinite(s.total) && Number.isFinite(s.positive) && s.total >= 0)
    .sort((a, b) => a.hour - b.hour);
  const points = ordered.map((s) => ({ t: s.hour, total: s.total, positive: s.positive }));
  if (ordered.length === 0) return { appId, points, first72h: null, perDay: null, since: null };

  let first72h: ReviewVelocity["first72h"] = null;
  if (launch !== null && Number.isFinite(launch)) {
    const before = ordered.filter((s) => s.hour <= launch).pop();
    const open = before ?? ordered.find((s) => s.hour > launch && s.hour <= launch + LAUNCH_SLACK);
    const target = launch + 72 * HOUR;
    const close = ordered
      .filter((s) => Math.abs(s.hour - target) <= WINDOW_SLACK)
      .sort((a, b) => Math.abs(a.hour - target) - Math.abs(b.hour - target))[0];
    if (open && close && close.hour > open.hour) {
      const reviews = Math.max(0, close.total - open.total);
      const positive = Math.max(0, close.positive - open.positive);
      first72h = { reviews, positivePct: reviews > 0 ? Math.round((positive / reviews) * 100) : 0 };
    }
  }

  const recent = ordered.filter((s) => s.hour >= now - 7 * DAY);
  let perDay: number | null = null;
  if (recent.length >= 2) {
    const span = recent[recent.length - 1].hour - recent[0].hour;
    if (span >= 12 * HOUR) {
      const added = Math.max(0, recent[recent.length - 1].total - recent[0].total);
      perDay = Math.round((added / (span / DAY)) * 10) / 10;
    }
  }

  return { appId, points, first72h, perDay, since: isoDay(ordered[0].hour) };
}

/* ---------------------------------------------------------------------------
 * Twitch
 * ------------------------------------------------------------------------ */

/**
 * Samples (any order) → a chart series, the same shape of downsampling the
 * player chart uses: hourly for the 7 days before `now`, 6-hour means beyond.
 * Peaks come from the raw samples, so downsampling never hides one.
 */
export function downsampleTwitch(
  samples: Array<{ hour: number; viewers: number; streams: number }>,
  now: number,
): Omit<TwitchHistory, "twitchId"> {
  const ordered = samples
    .filter((s) => Number.isFinite(s.viewers) && Number.isFinite(s.streams))
    .sort((a, b) => a.hour - b.hour);
  if (ordered.length === 0) return { points: [], peak24h: null, peakTracked: null, since: null };

  const recentFrom = now - 7 * DAY;
  const buckets = new Map<number, { viewers: number; streams: number; n: number }>();
  for (const s of ordered) {
    if (s.hour >= recentFrom) continue;
    const start = s.hour - (s.hour % BUCKET);
    const bucket = buckets.get(start) ?? { viewers: 0, streams: 0, n: 0 };
    bucket.viewers += s.viewers;
    bucket.streams += s.streams;
    bucket.n += 1;
    buckets.set(start, bucket);
  }
  const points: TwitchHistory["points"] = [...buckets]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({ t, viewers: Math.round(b.viewers / b.n), streams: Math.round(b.streams / b.n) }));
  for (const s of ordered) {
    if (s.hour >= recentFrom) points.push({ t: s.hour, viewers: s.viewers, streams: s.streams });
  }

  const last24 = ordered.filter((s) => s.hour >= now - DAY);
  return {
    points,
    peak24h: last24.length ? Math.max(...last24.map((s) => s.viewers)) : null,
    peakTracked: Math.max(...ordered.map((s) => s.viewers)),
    since: isoDay(ordered[0].hour),
  };
}

/** Helix `streams` page → totals across the page (at most the top 100 streams). */
export function sumStreams(data: Array<{ viewer_count?: unknown }> | undefined): { viewers: number; streams: number } {
  let viewers = 0;
  let streams = 0;
  for (const stream of data ?? []) {
    const count = typeof stream.viewer_count === "number" && stream.viewer_count >= 0 ? stream.viewer_count : 0;
    viewers += count;
    streams += 1;
  }
  return { viewers, streams };
}

/* ---------------------------------------------------------------------------
 * Critic scores
 * ------------------------------------------------------------------------ */

/** Rows → `ScoreTimeline`, oldest first, scores to one decimal. */
export function scoreTimeline(rows: Array<{ observed_on: string; score: number; count: number }>): ScoreTimeline {
  const points = rows
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.observed_on) && Number.isFinite(r.score))
    .sort((a, b) => a.observed_on.localeCompare(b.observed_on))
    .map((r) => ({ date: r.observed_on, score: Math.round(r.score * 10) / 10, count: Math.max(0, Math.round(r.count)) }));
  return { points, since: points[0]?.date ?? null };
}
