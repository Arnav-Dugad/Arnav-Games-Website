/**
 * The delay tracker: our own memory of every release date we have shown.
 *
 * IGDB only knows a game's *current* date. Whether it has slipped — and how
 * often — is something nobody publishes, so we record each distinct value as
 * we see it and derive the history from that. Every function degrades to a
 * no-op/empty result when Firestore is unavailable (`next build`, tests, no
 * service account): this is enrichment, never a reason to fail a page.
 *
 * Storage (see `stats-docs.ts`): four shard documents `releaseHistory/s0…s3`,
 * each a map `"<igdbId>": { "<value>": firstSeenUnixSeconds }`. Sharding by id
 * lets the upcoming calendar and studio pages read every game they show in
 * ≤ 4 document reads (one request, field-masked to those ids), where a
 * document per game would cost a read per game. Recording uses a `minimum`
 * transform on the value's field, so it never needs a read to be correct:
 * the first sighting wins even if two isolates record the same value at once.
 *
 * Only IGDB ids belong here. Steam-provider games use appids as their ids, and
 * the two id spaces overlap, so callers must not pass Steam-sourced games.
 *
 * Known limit, kept from the D1 design: a value is recorded once per game, so
 * a date that moves A → B → A reads A → B. Rare in practice, and better than
 * double-counting a flip-flop as two delays.
 */

import { unstable_cache } from "next/cache";
import { batchGetDocuments, commitWrites, fieldPath, type Write } from "@/lib/firebase/server";
import { observationRows, releaseShardPath } from "./stats-docs";
import type { GameSummary, ReleaseChange } from "./types";
import { changesFromObservations, isDelay, releaseValue } from "./release-value";

export type Observation = { value: string; observedAt: number };

/** A window label is short ("Q4 2026"); anything longer is noise, not a date. */
const MAX_VALUE_LENGTH = 60;
/** Cached reads are this fresh at worst; dates move on the scale of weeks. */
const READ_TTL = 30 * 60;

/**
 * Values this isolate has already written (or seen stored). Pages re-render
 * constantly and re-recording a known value is a wasted write against the
 * daily quota, so repeats are skipped before they reach Firestore.
 */
const recorded = new Set<string>();

const validId = (id: number) => Number.isInteger(id) && id > 0;

/** Every stored observation for `ids`, in one request. Null when Firestore couldn't be read. */
export async function readReleaseObservations(ids: number[]): Promise<Map<number, Observation[]> | null> {
  const unique = [...new Set(ids.filter(validId))].slice(0, 1000);
  const out = new Map<number, Observation[]>();
  if (unique.length === 0) return out;
  const shards = [...new Set(unique.map(releaseShardPath))];
  const docs = await batchGetDocuments(shards, { mask: unique.map((id) => fieldPath(id)) });
  if (!docs) return null;
  for (const id of unique) {
    const rows = observationRows(docs.get(releaseShardPath(id))?.data[String(id)]);
    if (rows.length > 0) out.set(id, rows);
  }
  return out;
}

/** Cached per game; throws on a failed read so the failure isn't cached. */
const cachedObservations = unstable_cache(
  async (id: number): Promise<Observation[]> => {
    const map = await readReleaseObservations([id]);
    if (!map) throw new Error("release history unavailable");
    return map.get(id) ?? [];
  },
  ["release-observations-v2"],
  { revalidate: READ_TTL, tags: ["release-history"] },
);

/** One game's observations (≤ 30 min stale), or null when unavailable. */
export async function releaseObservationsFor(gameId: number): Promise<Observation[] | null> {
  if (!validId(gameId)) return [];
  try {
    return await cachedObservations(gameId);
  } catch (err) {
    console.warn("[release-history] read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Every observed change of one game's release value, oldest first. */
export async function getReleaseChanges(gameId: number): Promise<ReleaseChange[]> {
  return changesFromObservations((await releaseObservationsFor(gameId)) ?? []);
}

/**
 * The writes recording each game's current value, skipping values already
 * stored (per `known`) or already written by this isolate. One write per
 * shard touched. Marks the values as recorded; call `forgetRecorded` if the
 * commit then fails.
 */
export function releaseObservationWrites(
  games: Array<Pick<GameSummary, "id" | "slug" | "released" | "releaseWindow">>,
  known: Map<number, Observation[]>,
  now = Math.floor(Date.now() / 1000),
): { writes: Write[]; keys: string[] } {
  const byShard = new Map<string, Array<{ id: number; value: string }>>();
  const keys: string[] = [];
  for (const game of games) {
    if (!validId(game.id) || !game.slug) continue;
    const value = releaseValue(game).slice(0, MAX_VALUE_LENGTH);
    const key = `${game.id}:${value}`;
    if (recorded.has(key)) continue;
    recorded.add(key);
    if (known.get(game.id)?.some((row) => row.value === value)) continue;
    keys.push(key);
    const shard = releaseShardPath(game.id);
    byShard.set(shard, [...(byShard.get(shard) ?? []), { id: game.id, value }]);
  }
  if (recorded.size > 20_000) recorded.clear();
  const writes: Write[] = [...byShard].map(([path, rows]) => ({
    type: "update",
    path,
    data: {},
    mask: [],
    transforms: rows.map((row) => ({ field: fieldPath(row.id, row.value), op: "minimum" as const, value: now })),
  }));
  return { writes, keys };
}

/** Undo `releaseObservationWrites`' bookkeeping after a failed commit. */
export function forgetRecorded(keys: string[]): void {
  for (const key of keys) recorded.delete(key);
}

/**
 * Records the current value of each game that isn't stored yet: one read of
 * the shards involved, then at most one commit. Used by the upcoming
 * calendar, where most dates move.
 */
export async function recordReleaseObservations(games: GameSummary[]): Promise<void> {
  const fresh = games.filter((game) => validId(game.id) && game.slug && !recorded.has(`${game.id}:${releaseValue(game).slice(0, MAX_VALUE_LENGTH)}`));
  if (fresh.length === 0) return;
  const known = await readReleaseObservations(fresh.map((game) => game.id));
  if (!known) return;
  const { writes, keys } = releaseObservationWrites(fresh, known);
  if (writes.length === 0) return;
  if ((await commitWrites(writes)) < writes.length) {
    forgetRecorded(keys);
    console.warn("[release-history] record failed");
  }
}

const cachedDelayCounts = unstable_cache(
  async (ids: number[]): Promise<Array<[number, number]>> => {
    const map = await readReleaseObservations(ids);
    if (!map) throw new Error("release history unavailable");
    const counts: Array<[number, number]> = [];
    for (const [id, observations] of map) {
      const delays = changesFromObservations(observations).filter((change) => isDelay(change.from, change.to)).length;
      if (delays > 0) counts.push([id, delays]);
    }
    return counts;
  },
  ["release-delay-counts-v2"],
  { revalidate: READ_TTL, tags: ["release-history"] },
);

/**
 * How many times each game's date has moved *later*. Games with no recorded
 * delay are absent from the map (read as 0).
 */
export async function getDelayCounts(ids: number[]): Promise<Map<number, number>> {
  const unique = [...new Set(ids.filter(validId))].sort((a, b) => a - b);
  if (unique.length === 0) return new Map();
  try {
    return new Map(await cachedDelayCounts(unique));
  } catch (err) {
    console.warn("[release-history] delay counts failed:", err instanceof Error ? err.message : err);
    return new Map();
  }
}
