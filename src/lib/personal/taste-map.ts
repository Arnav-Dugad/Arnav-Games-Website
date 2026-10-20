/**
 * The taste map: what the reader's games have in common, weighted by how much
 * each game actually says about them, and how that has moved over time.
 *
 * Built on the recommendation engine's own per-game weights
 * (`gameTasteWeights` — status, ownership, hours played, the reader's rating,
 * recency), so the map and "For you" never disagree about what you like. On
 * top of that:
 *
 *  - Facets are genres (stored with every library record) plus IGDB themes
 *    and player perspectives (fetched once per game and kept on the device).
 *    A game spreads its weight across its facets *within each kind*, so a
 *    game with six themes doesn't count six times as loud as one with one.
 *  - The play journal stands in for a rating where there isn't one: a run of
 *    "Loved it" sessions says as much as a 9/10.
 *  - Drift compares shares, never counts, per quarter: whether a facet is a
 *    bigger part of what you play now than it was a year ago.
 *
 * Pure; pinned in `scripts/check-providers.ts`.
 */

import { gameTasteWeights, type TasteEntry, type TasteReview } from "@/lib/recs/profile";

export type FacetKind = "genre" | "theme" | "perspective";

export interface FacetRef {
  id: number;
  name: string;
}

/** Themes and perspectives for one game (IGDB). */
export interface GameFacets {
  themes: FacetRef[];
  perspectives: FacetRef[];
}

export interface TasteMapEntry extends TasteEntry {
  genres?: FacetRef[];
}

export interface TasteNode {
  key: string;
  kind: FacetKind;
  id: number;
  label: string;
  /** Share of this kind's positive weight, 0–1. */
  share: number;
  /** Raw weight, for sizing against every node. */
  weight: number;
  games: number;
  /** Share now (last four quarters) minus share before, in points; null without enough history. */
  delta: number | null;
  /** Share per drift period, oldest first (empty without drift). */
  trend: number[];
}

export interface TasteMap {
  unlocked: boolean;
  /** Games that carried any weight and any facet. */
  games: number;
  required: number;
  nodes: TasteNode[];
  /** Quarter labels for `trend`, oldest first. */
  periods: string[];
  rising: TasteNode[];
  fading: TasteNode[];
  /** Why drift is missing, when it is. */
  driftNote: string | null;
}

export const TASTE_MAP_MIN_GAMES = 5;
const KIND_LIMIT: Record<FacetKind, number> = { genre: 8, theme: 7, perspective: 3 };
const DRIFT_QUARTERS = 8;
/** Points of share a facet must gain or lose to be called rising or fading. */
const DRIFT_THRESHOLD = 0.05;

/** Journal mood → an implied 1–10 score, for games the reader hasn't rated. */
const MOOD_SCORE: Record<string, number> = { great: 9, good: 7.5, okay: 6, meh: 4.5, frustrated: 3.5 };

/** Implied ratings from journal moods (games with at least one mood, not already rated). */
export function moodRatings(journal: Array<{ gameId: number; mood: string }>, rated: Set<number>): TasteReview[] {
  const sums = new Map<number, { total: number; count: number }>();
  for (const entry of journal) {
    const score = MOOD_SCORE[entry.mood];
    if (score === undefined || rated.has(entry.gameId)) continue;
    const sum = sums.get(entry.gameId) ?? { total: 0, count: 0 };
    sum.total += score;
    sum.count++;
    sums.set(entry.gameId, sum);
  }
  return [...sums].map(([gameId, { total, count }]) => ({ gameId, rating: Math.round((total / count) * 10) / 10 }));
}

function quarterOf(at: number): { key: string; label: string } {
  const date = new Date(at);
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return { key: `${date.getUTCFullYear()}-Q${quarter}`, label: `Q${quarter} ’${String(date.getUTCFullYear()).slice(2)}` };
}

function facetsOf(entry: TasteMapEntry, facets: Record<number, GameFacets>): Array<{ kind: FacetKind; ref: FacetRef }> {
  const extra = facets[entry.gameId];
  return [
    ...(entry.genres ?? []).map((ref) => ({ kind: "genre" as const, ref })),
    ...(extra?.themes ?? []).map((ref) => ({ kind: "theme" as const, ref })),
    ...(extra?.perspectives ?? []).map((ref) => ({ kind: "perspective" as const, ref })),
  ];
}

/** Adds one game's weight to `into`, split evenly across its facets of each kind. */
function spread(into: Map<string, number>, items: Array<{ kind: FacetKind; ref: FacetRef }>, weight: number) {
  const perKind = new Map<FacetKind, number>();
  for (const item of items) perKind.set(item.kind, (perKind.get(item.kind) ?? 0) + 1);
  for (const item of items) {
    const key = `${item.kind}:${item.ref.id}`;
    into.set(key, (into.get(key) ?? 0) + weight / (perKind.get(item.kind) ?? 1));
  }
}

export function buildTasteMap(
  entries: TasteMapEntry[],
  {
    reviews = [],
    journal = [],
    facets = {},
    playtime = {},
    now = Date.now(),
  }: {
    reviews?: TasteReview[];
    journal?: Array<{ gameId: number; mood: string }>;
    facets?: Record<number, GameFacets>;
    playtime?: Record<number, number>;
    now?: number;
  } = {},
): TasteMap {
  const withHours = entries.map((entry) => ({ ...entry, hoursPlayed: entry.hoursPlayed ?? playtime[entry.gameId] ?? null }));
  const opinions = [...reviews, ...moodRatings(journal, new Set(reviews.map((review) => review.gameId)))];
  const weights = gameTasteWeights(withHours, opinions, { now });
  const undecayed = gameTasteWeights(withHours, opinions, { now, decay: false });

  const labels = new Map<string, { kind: FacetKind; ref: FacetRef }>();
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  let games = 0;
  const byId = new Map(withHours.map((entry) => [entry.gameId, entry]));
  for (const [gameId, weight] of weights) {
    const entry = byId.get(gameId);
    if (!entry || weight <= 0) continue;
    const items = facetsOf(entry, facets);
    if (items.length === 0) continue;
    games++;
    for (const item of items) {
      const key = `${item.kind}:${item.ref.id}`;
      labels.set(key, item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    spread(totals, items, weight);
  }
  // Low ratings subtract: a genre you keep scoring 3/10 shouldn't bloom.
  for (const [gameId, weight] of weights) {
    const entry = byId.get(gameId);
    if (!entry || weight >= 0) continue;
    spread(totals, facetsOf(entry, facets), weight);
  }

  // Drift: per-quarter shares from full-strength weights, keyed by when the
  // game last meant something (finished, else started, else added).
  const periods = new Map<string, { label: string; totals: Map<string, number>; sum: number }>();
  for (const [gameId, weight] of undecayed) {
    const entry = byId.get(gameId);
    if (!entry || weight <= 0) continue;
    const items = facetsOf(entry, facets);
    if (items.length === 0) continue;
    const quarter = quarterOf(entry.finishedAt ?? entry.startedAt ?? entry.addedAt);
    const period = periods.get(quarter.key) ?? { label: quarter.label, totals: new Map(), sum: 0 };
    spread(period.totals, items, weight);
    period.sum += weight;
    periods.set(quarter.key, period);
  }
  const ordered = [...periods].sort((a, b) => a[0].localeCompare(b[0])).slice(-DRIFT_QUARTERS);
  const hasDrift = ordered.length >= 3;
  const nowQuarter = quarterOf(now).key;
  const yearAgo = quarterOf(now - 365 * 86_400_000).key;
  const recent = ordered.filter(([key]) => key > yearAgo && key <= nowQuarter);
  const before = ordered.filter(([key]) => key <= yearAgo);
  const shareIn = (rows: typeof ordered, key: string) => {
    const sum = rows.reduce((total, [, period]) => total + period.sum, 0);
    return sum > 0 ? rows.reduce((total, [, period]) => total + (period.totals.get(key) ?? 0), 0) / sum : 0;
  };
  const canCompare = hasDrift && recent.length > 0 && before.length > 0;

  const nodes: TasteNode[] = [];
  for (const kind of ["genre", "theme", "perspective"] as const) {
    const ofKind = [...totals].filter(([key, weight]) => key.startsWith(`${kind}:`) && weight > 0);
    const kindSum = ofKind.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [key, weight] of ofKind.sort((a, b) => b[1] - a[1]).slice(0, KIND_LIMIT[kind])) {
      const { ref } = labels.get(key)!;
      nodes.push({
        key,
        kind,
        id: ref.id,
        label: ref.name,
        share: kindSum > 0 ? weight / kindSum : 0,
        weight,
        games: counts.get(key) ?? 0,
        delta: canCompare ? shareIn(recent, key) - shareIn(before, key) : null,
        trend: hasDrift ? ordered.map(([, period]) => (period.sum > 0 ? (period.totals.get(key) ?? 0) / period.sum : 0)) : [],
      });
    }
  }

  const movers = nodes.filter((node) => node.delta !== null && node.games >= 2);
  return {
    unlocked: games >= TASTE_MAP_MIN_GAMES && nodes.length >= 3,
    games,
    required: TASTE_MAP_MIN_GAMES,
    nodes,
    periods: hasDrift ? ordered.map(([, period]) => period.label) : [],
    rising: movers.filter((node) => node.delta! >= DRIFT_THRESHOLD).sort((a, b) => b.delta! - a.delta!).slice(0, 3),
    fading: movers.filter((node) => node.delta! <= -DRIFT_THRESHOLD).sort((a, b) => a.delta! - b.delta!).slice(0, 3),
    driftNote: !hasDrift
      ? "Your games all landed within a couple of quarters, so there's no drift to show yet."
      : !canCompare
        ? "Drift needs games from both the last year and before it."
        : null,
  };
}
