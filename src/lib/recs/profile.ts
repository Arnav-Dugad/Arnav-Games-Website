/**
 * The anonymous taste profile for recommendations v2, built in the browser
 * from the reader's own library, reviews and feedback. Only game ids, weights
 * and coarse preferences leave the device (`RecsProfile`) — no uid, no names,
 * no timestamps. Pure: safe to import from client components and checked in
 * `scripts/check-providers.ts`.
 *
 * Usage (UI):
 *   const profile = buildTasteProfile(entries, reviews, feedback, { ownedPlatforms, subscriptions });
 *   if (hasEnoughTaste(profile)) fetch("/api/recommendations/v2", { method: "POST", body: JSON.stringify(profile) });
 *
 * The server validates it again with `parseRecsProfile`.
 */

import { platformKey } from "@/lib/utils/format";
import type { RecsProfile } from "@/lib/games/types";

/** The parts of a `WatchlistEntry` the profile uses (structurally compatible). */
export interface TasteEntry {
  gameId: number;
  status: "none" | "want" | "playing" | "played";
  following?: boolean;
  watchlisted?: boolean;
  ownedOn?: string[];
  platform?: string | null;
  addedAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  /** Main-story hours to beat, when known (`WatchlistEntry.playtime`). */
  playtime?: number;
  /** Hours the user actually played, when imported (e.g. from Steam). */
  hoursPlayed?: number | null;
  subscriptionAccess?: Array<{ service: string }>;
}

/** The parts of a `Review` the profile uses: the reader's own 1–10 score. */
export interface TasteReview {
  gameId: number;
  rating: number;
}

/**
 * Feedback on recommendations, stored on the device by the UI:
 *  - "up": more like this (a positive seed)
 *  - "down": thumbs-down (excluded and a negative seed)
 *  - "not-interested": excluded, mild negative
 *  - "ignored": shown at least twice and never opened (penalised, not excluded)
 */
export interface RecFeedback {
  gameId: number;
  kind: "up" | "down" | "not-interested" | "ignored";
  at: number;
}

const STATUS_WEIGHT: Record<TasteEntry["status"], number> = { played: 3, playing: 2.2, want: 1.2, none: 0.4 };
const HALF_LIFE_DAYS = 240;
const DAY_MS = 86_400_000;
export const RECS_LIMITS = { positive: 16, negative: 8, exclude: 600, dismissed: 200, ignored: 200, platforms: 12 } as const;
/** Services that change where a game can be played. */
export const RECS_SERVICES = ["game-pass", "geforce-now"] as const;

/** Exact IGDB system slugs the engine understands besides family keys. */
const SYSTEMS = new Set(["ps5", "ps4--1", "ps3", "series-x-s", "xboxone", "xbox360", "switch-2", "switch", "3ds", "win", "mac", "linux", "ios", "android"]);
const PC_STORES = new Set(["steam", "epic", "gog", "pc", "windows", "battlenet", "ea-app", "ubisoft-connect"]);

/** A platform/store slug the user owns → a system slug or family key, or null. */
export function normaliseOwnedPlatform(slug: string): string | null {
  const s = slug.toLowerCase().trim();
  if (SYSTEMS.has(s)) return s;
  if (PC_STORES.has(s)) return "pc";
  return platformKey(s);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rating 1–10 → multiplier: 10 → 1.5, 7 → 1.2, 5 → 0.2 (barely a signal), ≤ 4 → negative. */
export function ratingMultiplier(rating: number | undefined): number {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return 1;
  const r = Math.min(10, Math.max(1, rating));
  if (r >= 6) return 0.5 + r / 10;
  if (r > 4) return 0.2;
  return -(5 - r) / 4;
}

export function buildTasteProfile(
  entries: TasteEntry[],
  reviews: TasteReview[] = [],
  feedback: RecFeedback[] = [],
  options: { ownedPlatforms?: string[]; subscriptions?: string[]; now?: number } = {},
): RecsProfile {
  const now = options.now ?? Date.now();
  const rating = new Map(reviews.filter((r) => r.gameId > 0).map((r) => [r.gameId, r.rating]));
  const weights = new Map<number, number>();

  for (const entry of entries) {
    if (!(entry.gameId > 0)) continue; // Steam-only titles (negative ids) aren't in IGDB.
    const personal = entry.status !== "none" || entry.following || entry.watchlisted || (entry.ownedOn?.length ?? 0) > 0;
    if (!personal) continue;
    let w = STATUS_WEIGHT[entry.status] ?? 0.4;
    if (entry.following) w += 0.3;
    if ((entry.ownedOn?.length ?? 0) > 0) w += 0.3;
    const hours = entry.hoursPlayed ?? 0;
    if (hours > 0) w *= 1 + Math.min(0.5, Math.log10(1 + hours) / 4);
    w *= ratingMultiplier(rating.get(entry.gameId));
    const stamp = entry.finishedAt ?? entry.startedAt ?? entry.addedAt;
    // Old signals fade but never vanish: a favourite from years ago still counts a quarter.
    w *= Math.max(0.25, Math.pow(0.5, Math.max(0, now - stamp) / DAY_MS / HALF_LIFE_DAYS));
    weights.set(entry.gameId, w);
  }
  // A review without a library entry is still the reader's opinion.
  for (const [gameId, score] of rating) if (!weights.has(gameId)) weights.set(gameId, 1.5 * ratingMultiplier(score));

  const latest = new Map<number, RecFeedback>();
  for (const item of [...feedback].sort((a, b) => a.at - b.at)) if (item.gameId > 0) latest.set(item.gameId, item);
  const dismissed: number[] = [];
  const ignored: number[] = [];
  for (const item of [...latest.values()].sort((a, b) => b.at - a.at)) {
    if (item.kind === "up") weights.set(item.gameId, (weights.get(item.gameId) ?? 0) + 1.5);
    if (item.kind === "down") {
      dismissed.push(item.gameId);
      weights.set(item.gameId, Math.min(weights.get(item.gameId) ?? 0, -1.5));
    }
    if (item.kind === "not-interested") {
      dismissed.push(item.gameId);
      weights.set(item.gameId, Math.min(weights.get(item.gameId) ?? 0, -0.6));
    }
    if (item.kind === "ignored") ignored.push(item.gameId);
  }

  const seeds = [...weights].map(([id, w]) => ({ id, w: round2(Math.max(-3, Math.min(3, w))) })).filter((s) => s.w !== 0);
  const positive = seeds.filter((s) => s.w > 0).sort((a, b) => b.w - a.w || a.id - b.id).slice(0, RECS_LIMITS.positive);
  const negative = seeds.filter((s) => s.w < 0).sort((a, b) => a.w - b.w || a.id - b.id).slice(0, RECS_LIMITS.negative);

  const exclude = entries
    .filter((e) => e.gameId > 0 && (e.status !== "none" || e.following || e.watchlisted || (e.ownedOn?.length ?? 0) > 0))
    .sort((a, b) => b.addedAt - a.addedAt || a.gameId - b.gameId)
    .map((e) => e.gameId)
    .slice(0, RECS_LIMITS.exclude);

  const platforms = new Set<string>();
  for (const slug of options.ownedPlatforms ?? []) {
    const p = normaliseOwnedPlatform(slug);
    if (p) platforms.add(p);
  }
  for (const entry of entries) {
    for (const slug of [...(entry.ownedOn ?? []), ...(entry.platform ? [entry.platform] : [])]) {
      const p = normaliseOwnedPlatform(slug);
      if (p) platforms.add(p);
    }
  }

  const services = new Set<string>();
  for (const slug of [...(options.subscriptions ?? []), ...entries.flatMap((e) => (e.subscriptionAccess ?? []).map((a) => a.service))]) {
    if ((RECS_SERVICES as readonly string[]).includes(slug)) services.add(slug);
  }

  // Typical length of what they finish: the median main-story time of played games (needs two).
  const lengths = entries.filter((e) => e.status === "played" && (e.playtime ?? 0) > 0).map((e) => e.playtime!).sort((a, b) => a - b);
  const lengthHours = lengths.length >= 2 ? Math.round(lengths[Math.floor((lengths.length - 1) / 2)] * 2) / 2 : null;

  return {
    v: 2,
    seeds: [...positive, ...negative],
    exclude,
    dismissed: [...new Set(dismissed)].slice(0, RECS_LIMITS.dismissed),
    ignored: [...new Set(ignored)].filter((id) => !dismissed.includes(id)).slice(0, RECS_LIMITS.ignored),
    platforms: [...platforms].sort().slice(0, RECS_LIMITS.platforms),
    services: [...services].sort(),
    lengthHours,
  };
}

/** Below this total positive weight, picks would be noise dressed up as insight. */
export const MIN_RECS_STRENGTH = 1.5;

export function hasEnoughTaste(profile: RecsProfile): boolean {
  return profile.seeds.reduce((sum, seed) => sum + Math.max(0, seed.w), 0) >= MIN_RECS_STRENGTH;
}

/** A stable cache key for a profile (the browser can use it for its local cache too). */
export function profileKey(profile: RecsProfile): string {
  const ids = (list: number[]) => [...list].sort((a, b) => a - b).join(",");
  return [
    profile.seeds.map((s) => `${s.id}:${s.w}`).sort().join(","),
    ids(profile.exclude),
    ids(profile.dismissed),
    ids(profile.ignored),
    profile.platforms.join(","),
    profile.services.join(","),
    profile.lengthHours ?? "",
  ].join("|");
}

/** Server-side validation of a posted profile; an error string when malformed. */
export function parseRecsProfile(raw: unknown): RecsProfile | string {
  if (typeof raw !== "object" || raw === null) return "body must be a JSON object";
  const body = raw as Record<string, unknown>;
  if (body.v !== 2) return "v must be 2";
  const intList = (value: unknown, max: number, name: string): number[] | string => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > max) return `${name} must be an array of at most ${max}`;
    if (!value.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0 && id < 1e9)) return `${name} must hold positive integer ids`;
    return [...new Set(value as number[])];
  };
  if (!Array.isArray(body.seeds) || body.seeds.length > RECS_LIMITS.positive + RECS_LIMITS.negative) return "seeds must be an array of at most 24";
  const seeds: RecsProfile["seeds"] = [];
  for (const seed of body.seeds) {
    const s = seed as { id?: unknown; w?: unknown };
    if (typeof s?.id !== "number" || !Number.isInteger(s.id) || s.id <= 0 || s.id >= 1e9) return "seed ids must be positive integers";
    if (typeof s.w !== "number" || !Number.isFinite(s.w) || s.w < -3 || s.w > 3) return "seed weights must be within -3…3";
    if (!seeds.some((x) => x.id === s.id)) seeds.push({ id: s.id, w: round2(s.w) });
  }
  const exclude = intList(body.exclude, RECS_LIMITS.exclude, "exclude");
  const dismissed = intList(body.dismissed, RECS_LIMITS.dismissed, "dismissed");
  const ignored = intList(body.ignored, RECS_LIMITS.ignored, "ignored");
  if (typeof exclude === "string") return exclude;
  if (typeof dismissed === "string") return dismissed;
  if (typeof ignored === "string") return ignored;
  const strings = (value: unknown, max: number, pattern: RegExp, name: string): string[] | string => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > max || !value.every((v) => typeof v === "string" && pattern.test(v))) return `${name} must be up to ${max} slugs`;
    return [...new Set(value as string[])].sort();
  };
  const platforms = strings(body.platforms, RECS_LIMITS.platforms, /^[a-z0-9-]{1,24}$/, "platforms");
  if (typeof platforms === "string") return platforms;
  const services = strings(body.services, 4, /^[a-z-]{1,24}$/, "services");
  if (typeof services === "string") return services;
  const length = body.lengthHours;
  if (length !== undefined && length !== null && (typeof length !== "number" || !Number.isFinite(length) || length <= 0 || length > 500)) {
    return "lengthHours must be a positive number of hours or null";
  }
  return {
    v: 2,
    seeds,
    exclude,
    dismissed,
    ignored,
    platforms,
    services: services.filter((s) => (RECS_SERVICES as readonly string[]).includes(s)),
    lengthHours: typeof length === "number" ? Math.round(length * 2) / 2 : null,
  };
}
