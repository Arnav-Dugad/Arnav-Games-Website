/**
 * Twitch viewership history: the cron (slots 1 and 4 of the 10-minute
 * schedule, so twice an hour) samples tracked games into
 * `twitchHistory/{twitchId}` (one document per category, one field per hour —
 * see `stats-docs.ts`); the game page reads that document straight from
 * Firestore in the browser.
 *
 * What a sample is, precisely: the summed `viewer_count` and number of
 * streams on the first Helix page for the category — the top 100 live
 * streams by viewers. Helix has no category total, and one page per game is
 * what fits the request budget; for all but the largest categories the top
 * 100 is effectively everyone, and where it isn't the figure is an
 * undercount, never an inflation.
 *
 * Twitch category ids live in the tracked index (`twitch.{key}`): absent =
 * not looked up yet, "" = Twitch had no category for the IGDB id when last
 * asked (re-asked on rotation, since categories appear as games approach
 * launch).
 */

import { commitWrites, fieldPath, type Budget, type Write } from "@/lib/firebase/server";
import type { FetchBudget } from "./fetch-budget";
import { sumStreams } from "./history-rules";
import { igdbAppAuth } from "./providers/igdb";
import { externalIdsFor } from "./providers/igdb-extras";
import { expiredHours, STATS_COLLECTIONS, TRACKED_DOC } from "./stats-docs";
import type { TrackedIndex } from "./tracked";

const HOUR = 3600;
const DAY = 24 * HOUR;
export const TWITCH_RETENTION_DAYS = 120;
const CONCURRENCY = 8;
/** Games in the most-recently-viewed pool get an hourly sample (two runs × 40). */
const HOURLY_POOL = 80;
const TWITCH_ID = /^\d{1,12}$/;

type Auth = { clientId: string; token: string };

async function helix<T>(auth: Auth, path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
      headers: { "Client-ID": auth.clientId, Authorization: `Bearer ${auth.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** One app token for the run (the IGDB token; charged as one request when cold). */
export async function twitchAuth(budget: FetchBudget): Promise<Auth | null> {
  if (!budget.take()) return null;
  return igdbAppAuth();
}

/**
 * Links up to 100 tracked games to their Twitch category with one Helix
 * request (`games?igdb_id=…` accepts 100 ids). Unlooked-up games go first;
 * when none are left, previously-unmatched ones are re-asked in rotation.
 * Returns the index write to commit (with the run's samples) and the links
 * found, so this run can sample newly linked categories.
 */
export async function linkTwitchIds(
  auth: Auth,
  index: TrackedIndex,
  budget: FetchBudget,
): Promise<{ asked: number; linked: number; write: Write | null; found: Map<number, string> }> {
  const found = new Map<number, string>();
  const igdb = index.games.filter((game) => game.gameId > 0);
  let ids = igdb.filter((game) => game.twitch === undefined).slice(0, 100).map((game) => game.gameId);
  if (ids.length === 0) {
    const unmatched = igdb.filter((game) => game.twitch === "").map((game) => game.gameId).sort((a, b) => a - b);
    if (unmatched.length > 0) {
      const turn = Math.floor(Date.now() / 1000 / HOUR);
      const start = (turn * 100) % unmatched.length;
      ids = [...unmatched.slice(start), ...unmatched.slice(0, start)].slice(0, 100);
    }
  }
  if (ids.length === 0 || !budget.take()) return { asked: 0, linked: 0, write: null, found };

  const json = await helix<{ data?: Array<{ id?: string; igdb_id?: string }> }>(
    auth,
    `games?${ids.map((id) => `igdb_id=${id}`).join("&")}`,
  );
  if (!json) return { asked: ids.length, linked: 0, write: null, found };
  for (const row of json.data ?? []) {
    const igdbId = Number(row.igdb_id);
    if (row.id && TWITCH_ID.test(row.id) && Number.isInteger(igdbId)) found.set(igdbId, row.id);
  }
  const data: Record<string, string> = {};
  for (const id of ids) data[String(id)] = found.get(id) ?? "";
  return {
    asked: ids.length,
    linked: found.size,
    write: { type: "update", path: TRACKED_DOC, data: { twitch: data }, mask: ids.map((id) => fieldPath("twitch", id)) },
    found,
  };
}

/**
 * Categories to sample this run: those in the hourly pool (the 80 most
 * recently viewed) not yet sampled this hour; leftover slots go to the rest,
 * never-sampled and least recently sampled first, so every tracked game is
 * covered over time.
 */
export function twitchSampleQueue(index: TrackedIndex, limit: number, fresh: Map<number, string> = new Map()): string[] {
  if (limit <= 0) return [];
  const now = Math.floor(Date.now() / 1000);
  const hour = now - (now % HOUR);
  // Categories by best recency (several games can share one category).
  const ranked: string[] = [];
  const seen = new Set<string>();
  for (const game of index.games) {
    const id = fresh.get(game.gameId) ?? game.twitch;
    if (id && TWITCH_ID.test(id) && !seen.has(id)) {
      seen.add(id);
      ranked.push(id);
    }
  }
  const sampledThisHour = (id: string) => index.twitchSampledAt.get(id) === hour;
  const picked = ranked.slice(0, HOURLY_POOL).filter((id) => !sampledThisHour(id)).slice(0, limit);
  if (picked.length < limit) {
    const rest = ranked
      .filter((id) => !picked.includes(id) && !sampledThisHour(id))
      .map((id, rank) => ({ id, rank, last: index.twitchSampledAt.get(id) ?? -1 }))
      .sort((a, b) => a.last - b.last || a.rank - b.rank);
    for (const { id } of rest) {
      if (picked.length >= limit) break;
      picked.push(id);
    }
  }
  return picked;
}

/**
 * One Helix request per category (each charged to `budget`), filed under the
 * current hour, then one commit (charged too) carrying every sample, the
 * "sampled" marks and `extra` (the run's link write).
 */
export async function sampleTwitch(
  ids: string[],
  auth: Auth,
  budget: Budget,
  extra: Write[] = [],
): Promise<{ sampled: number; stored: number }> {
  const categories = [...new Set(ids.filter((id) => TWITCH_ID.test(id)))];
  const hour = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
  const samples: Array<[string, { viewers: number; streams: number }]> = [];
  let cursor = 0;
  let sampled = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, categories.length) }, async () => {
      while (cursor < categories.length) {
        const id = categories[cursor++];
        if (!budget.take()) return;
        sampled++;
        const json = await helix<{ data?: Array<{ viewer_count?: unknown }> }>(auth, `streams?game_id=${id}&first=100`);
        if (json) samples.push([id, sumStreams(json.data)]);
      }
    }),
  );

  const expired = expiredHours(hour, TWITCH_RETENTION_DAYS);
  const writes: Write[] = samples.map(([id, s]) => ({
    type: "update",
    path: `${STATS_COLLECTIONS.twitch}/${id}`,
    data: { twitchId: id, updatedAt: hour, s: { [hour]: [s.viewers, s.streams] } },
    mask: ["twitchId", "updatedAt", fieldPath("s", hour), ...expired.map((h) => fieldPath("s", h))],
  }));
  if (samples.length > 0) {
    writes.push({
      type: "update",
      path: TRACKED_DOC,
      data: {},
      mask: [],
      transforms: samples.map(([id]) => ({ field: fieldPath("twAt", id), op: "maximum" as const, value: hour })),
    });
  }
  writes.push(...extra);
  const committed = writes.length > 0 && budget.take() ? await commitWrites(writes) : 0;
  return { sampled, stored: committed > 0 ? samples.length : 0 };
}

/**
 * The Twitch category for a game: IGDB's external ids (a cached query the
 * game page has usually warmed), then Twitch's own IGDB mapping.
 */
export async function twitchIdFor(igdbId: number | null): Promise<string | null> {
  if (!igdbId) return null;
  const id = (await externalIdsFor([igdbId])).get(igdbId)?.twitch ?? null;
  if (id && TWITCH_ID.test(id)) return id;
  // IGDB doesn't link every game (Counter-Strike 2 has no Twitch row); Twitch
  // itself maps IGDB ids. Cached a day — categories don't move.
  const auth = await igdbAppAuth();
  if (!auth) return null;
  try {
    const res = await fetch(`https://api.twitch.tv/helix/games?igdb_id=${igdbId}`, {
      headers: { "Client-ID": auth.clientId, Authorization: `Bearer ${auth.token}` },
      next: { revalidate: DAY },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const found = ((await res.json()) as { data?: Array<{ id?: string }> }).data?.[0]?.id;
    return found && TWITCH_ID.test(found) ? found : null;
  } catch {
    return null;
  }
}
