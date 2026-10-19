/**
 * Which games the crons look after: one Firestore document,
 * `trackedGames/index` (server-only; clients can't read it).
 *
 * A game joins when someone opens its page (`trackGameView`, called from
 * `getGame` after the response) and, while the set is small, from the
 * trending / top-rated / Steam-chart / upcoming shelves (`seedTrackedGames`).
 * `seen` orders the crons' work, so what people actually look at is sampled
 * first.
 *
 * Why one document of maps rather than a document per game: every cron run
 * needs the whole queue, and a collection query would bill one read per game
 * per run (~300 games × ~220 runs a day ≈ 66k reads — over the Spark quota on
 * its own). As maps keyed by game it is one read per run, and every update is
 * a field-level write (no read first): `seen` uses a `maximum` transform, so
 * concurrent writers can't move it backwards, and ids are only ever set when
 * known, so a view without an id never erases one.
 *
 *   slug.{key}    game slug                steam.{key}  Steam appid
 *   ms.{key}      Microsoft Store id        seen.{key}   last view, unix s
 *   twitch.{key}  Twitch category id, "" = Twitch had none when asked
 *   plAt.{appid}  hour of the app's latest stored player sample
 *   twAt.{twitchId} hour of the category's latest viewer sample
 *   cc.{country}  market views per country (picks the price cron's countries)
 *
 * Keys: IGDB games use their IGDB id. Steam-only titles (served by the Steam
 * provider, whose ids are appids) use the *negated* appid, because the two id
 * spaces overlap and a Steam appid must never be mistaken for an IGDB record.
 *
 * Capped at MAX_TRACKED games (least recently seen are evicted by the players
 * cron) to keep the document small: ~1,500 games × 6 fields is ~150 KB and
 * ~9k index entries, far inside Firestore's 1 MiB / 40k limits.
 *
 * Everything is a quiet no-op without a service account.
 */

import { asNumber, asRecord, commitWrites, fieldPath, getDocument, type Budget, type Write } from "@/lib/firebase/server";
import { externalIdsFor } from "./providers/igdb-extras";
import { TRACKED_DOC } from "./stats-docs";
import type { GameSummary } from "./types";

export interface TrackedGame {
  gameId: number;
  slug: string;
  steamApp: number | null;
  microsoft: string | null;
  /** Twitch category: undefined = never looked up, "" = Twitch had none. */
  twitch?: string;
  /** Last view, unix seconds (0 when unknown). */
  seen: number;
}

export type TrackedField = "slug" | "steam" | "ms" | "seen" | "twitch" | "plAt" | "twAt" | "cc";

export interface TrackedIndex {
  /** Most recently seen first. */
  games: TrackedGame[];
  playerSampledAt: Map<number, number>;
  twitchSampledAt: Map<string, number>;
  countries: Map<string, number>;
}

export const MAX_TRACKED = 1500;
const BIG_ID = /^[0-9A-Z]{12}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,159}$/;
/**
 * One view write per game per isolate per 6 hours. The crons order by
 * recency at hour granularity at best, so more often would only spend the
 * daily write quota.
 */
const VIEW_THROTTLE_MS = 6 * 60 * 60 * 1000;
const lastWrite = new Map<number, number>();

function clean(game: { gameId: number; slug: string; steamApp: number | null; microsoft: string | null }) {
  if (!Number.isInteger(game.gameId) || game.gameId === 0 || !SLUG.test(game.slug)) return null;
  const steamApp = game.steamApp && Number.isInteger(game.steamApp) && game.steamApp > 0 ? game.steamApp : null;
  const microsoft = game.microsoft && BIG_ID.test(game.microsoft.toUpperCase()) ? game.microsoft.toUpperCase() : null;
  return { gameId: game.gameId, slug: game.slug, steamApp, microsoft };
}

function numberMap(value: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, raw] of Object.entries(asRecord(value))) {
    const n = asNumber(raw);
    if (n !== null) out.set(key, n);
  }
  return out;
}

/**
 * The tracked set, reading only `fields` (a field mask keeps the response —
 * and its parse on a 10 ms CPU budget — small). One read, one subrequest.
 * Null when Firestore couldn't be asked; an empty index when nothing is
 * tracked yet.
 */
export async function readTrackedIndex(fields: TrackedField[], budget?: Budget): Promise<TrackedIndex | null> {
  const mask = [...new Set<TrackedField>(["slug", ...fields])];
  const doc = await getDocument(TRACKED_DOC, { mask, budget });
  if (doc === undefined) return null;
  const data = doc?.data ?? {};
  const slugs = asRecord(data.slug);
  const steam = numberMap(data.steam);
  const ms = asRecord(data.ms);
  const seen = numberMap(data.seen);
  const twitch = asRecord(data.twitch);

  const games: TrackedGame[] = [];
  for (const [key, slug] of Object.entries(slugs)) {
    const gameId = Number(key);
    if (!Number.isInteger(gameId) || gameId === 0 || typeof slug !== "string") continue;
    const microsoft = typeof ms[key] === "string" && BIG_ID.test(ms[key] as string) ? (ms[key] as string) : null;
    games.push({
      gameId,
      slug,
      steamApp: steam.get(key) ?? null,
      microsoft,
      twitch: typeof twitch[key] === "string" ? (twitch[key] as string) : undefined,
      seen: seen.get(key) ?? 0,
    });
  }
  games.sort((a, b) => b.seen - a.seen || a.gameId - b.gameId);

  const playerSampledAt = new Map<number, number>();
  for (const [key, hour] of numberMap(data.plAt)) playerSampledAt.set(Number(key), hour);
  return { games, playerSampledAt, twitchSampledAt: numberMap(data.twAt), countries: numberMap(data.cc) };
}

/**
 * The write marking a game as just viewed (bundle it into another commit
 * where one is happening anyway). `country` also counts a market view.
 */
export function trackedViewWrite(
  game: { gameId: number; slug: string; steamApp: number | null; microsoft: string | null },
  options: { country?: string | null; now?: number } = {},
): Write | null {
  const row = clean(game);
  if (!row) return null;
  const key = String(row.gameId);
  const data: Record<string, Record<string, unknown>> = { slug: { [key]: row.slug } };
  const mask = [fieldPath("slug", key)];
  if (row.steamApp) {
    data.steam = { [key]: row.steamApp };
    mask.push(fieldPath("steam", key));
  }
  if (row.microsoft) {
    data.ms = { [key]: row.microsoft };
    mask.push(fieldPath("ms", key));
  }
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const transforms: NonNullable<Extract<Write, { type: "update" }>["transforms"]> = [
    { field: fieldPath("seen", key), op: "maximum", value: now },
  ];
  if (options.country && /^[A-Z]{2}$/.test(options.country)) {
    transforms.push({ field: fieldPath("cc", options.country), op: "increment", value: 1 });
  }
  return { type: "update", path: TRACKED_DOC, data, mask, transforms };
}

/** True (and the throttle armed) when this isolate should record a view of `gameId` now. */
export function claimViewWrite(gameId: number): boolean {
  const now = Date.now();
  if (now - (lastWrite.get(gameId) ?? 0) < VIEW_THROTTLE_MS) return false;
  lastWrite.set(gameId, now);
  if (lastWrite.size > 5000) lastWrite.clear();
  return true;
}

/** Marks a game as just viewed. Throttled per isolate; never throws. */
export async function trackGameView(game: TrackedGame | Omit<TrackedGame, "seen">): Promise<void> {
  const write = trackedViewWrite(game);
  if (!write || !claimViewWrite(game.gameId)) return;
  if ((await commitWrites([write])) === 0) lastWrite.delete(game.gameId);
}

/**
 * Adds shelf games (IGDB ids) that aren't tracked yet, in one write. Existing
 * entries keep their `seen` (the transform only raises it, and seeds sit a
 * second behind "now"), and only gain store ids they were missing. Returns
 * how many games were offered.
 */
export async function seedTrackedGames(games: GameSummary[], index: TrackedIndex): Promise<number> {
  const unique = [...new Map(games.filter((g) => g.id > 0).map((g) => [g.id, g])).values()];
  if (unique.length === 0) return 0;
  const known = new Map(index.games.map((game) => [game.gameId, game]));
  const ids = await externalIdsFor(unique.map((game) => game.id));
  const seenAt = Math.floor(Date.now() / 1000) - 1;

  const data: Record<string, Record<string, unknown>> = { slug: {}, steam: {}, ms: {} };
  const mask: string[] = [];
  const transforms: NonNullable<Extract<Write, { type: "update" }>["transforms"]> = [];
  let offered = 0;
  for (const game of unique) {
    const row = clean({
      gameId: game.id,
      slug: game.slug,
      steamApp: ids.get(game.id)?.steam ?? null,
      microsoft: ids.get(game.id)?.microsoft ?? null,
    });
    if (!row) continue;
    const key = String(row.gameId);
    const existing = known.get(row.gameId);
    if (!existing) {
      data.slug[key] = row.slug;
      mask.push(fieldPath("slug", key));
      transforms.push({ field: fieldPath("seen", key), op: "maximum", value: seenAt });
    }
    if (row.steamApp && !existing?.steamApp) {
      data.steam[key] = row.steamApp;
      mask.push(fieldPath("steam", key));
    }
    if (row.microsoft && !existing?.microsoft) {
      data.ms[key] = row.microsoft;
      mask.push(fieldPath("ms", key));
    }
    offered++;
  }
  if (mask.length === 0) return 0;
  const committed = await commitWrites([{ type: "update", path: TRACKED_DOC, data, mask, transforms }]);
  return committed > 0 ? offered : 0;
}

/**
 * The write evicting the least recently seen games beyond MAX_TRACKED (and
 * their sampling marks), or null when the set is within the cap.
 */
export function evictionWrite(index: TrackedIndex): Write | null {
  const stale = index.games.slice(MAX_TRACKED);
  if (stale.length === 0) return null;
  const mask: string[] = [];
  for (const game of stale) {
    const key = String(game.gameId);
    for (const field of ["slug", "steam", "ms", "seen", "twitch"]) mask.push(fieldPath(field, key));
    if (game.steamApp && !index.games.slice(0, MAX_TRACKED).some((kept) => kept.steamApp === game.steamApp)) {
      mask.push(fieldPath("plAt", game.steamApp));
    }
  }
  return { type: "update", path: TRACKED_DOC, data: {}, mask };
}

/** The most recently seen tracked games that have a store id, newest first. */
export function trackedWithStores(index: TrackedIndex, limit: number, need: "steam" | "any"): TrackedGame[] {
  return index.games
    .filter((game) => (need === "steam" ? game.steamApp !== null : game.steamApp !== null || game.microsoft !== null))
    .slice(0, Math.max(1, Math.min(1000, Math.floor(limit))));
}

const countryWrites = new Map<string, number>();

/**
 * Counts one market view from `country` (throttled per isolate, like views),
 * so the daily price snapshot covers the countries visitors actually use.
 * Null when throttled or not a country code.
 */
export function countryViewWrite(country: string): Write | null {
  if (!/^[A-Z]{2}$/.test(country)) return null;
  const now = Date.now();
  if (now - (countryWrites.get(country) ?? 0) < VIEW_THROTTLE_MS) return null;
  countryWrites.set(country, now);
  return {
    type: "update",
    path: TRACKED_DOC,
    data: {},
    mask: [],
    transforms: [{ field: fieldPath("cc", country), op: "increment", value: 1 }],
  };
}

