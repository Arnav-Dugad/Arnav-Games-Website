/**
 * NVIDIA GeForce NOW — "which of my games can I stream?", treated like Game
 * Pass: membership on the game page, a library matcher and a shelf.
 *
 * NVIDIA publishes the full supported-games list as one public JSON file
 * (~1.5k entries, ~400 KB). It is fetched at most once a day, reduced to a
 * ~60 KB index (`compactGfn`) inside `unstable_cache`, and only the index is
 * cached — never the raw file, and never bundled into the Worker. Matching is
 * by Steam appid, then by exact normalised title (see `external-rules.ts`).
 *
 * GeForce NOW streams games you own on a supported store, so "available"
 * means "playable in the cloud if you own it on one of `stores`".
 */

import { unstable_cache } from "next/cache";
import { compactGfn, gfnLookup, gfnMembership, GFN_NOT_LISTED, type GfnRow } from "./external-rules";
import { politeJson } from "./polite";
import { igdbCachedQuery, igdbConfigured, listGamesByIds } from "./providers/igdb";
import { externalIdsFor } from "./providers/igdb-extras";
import { TTL } from "./providers/types";
import type { GameSummary, GeForceNowMembership } from "./types";

const CATALOGUE = "https://static.nvidiagrid.net/supported-public-game-list/locales/gfnpc-en-US.json";
const DAY = 60 * 60 * 24;

const cachedRows = unstable_cache(
  async (): Promise<GfnRow[]> => {
    const rows = compactGfn(await politeJson(CATALOGUE, 6000));
    // An empty list is a broken download, not NVIDIA dropping every game.
    if (rows.length < 100) throw new Error("gfn: catalogue looks truncated");
    return rows;
  },
  ["gfn-catalogue-v1"],
  { revalidate: DAY, tags: ["gfn"] },
);

/** The compact catalogue; null when NVIDIA's file couldn't be read. */
export async function geForceNowRows(): Promise<GfnRow[] | null> {
  try {
    return await cachedRows();
  } catch (err) {
    console.warn("[gfn] catalogue unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * One game's GeForce NOW status (`not-listed` when NVIDIA doesn't list it).
 * Null when the catalogue is unreachable. 1 outbound request cold, 0 warm.
 */
export async function geForceNowFor(game: { steam: number | null; name: string | null }): Promise<GeForceNowMembership | null> {
  if (!game.steam && !game.name) return null;
  const rows = await geForceNowRows();
  return rows ? gfnMembership(gfnLookup(rows), game) : null;
}

const validIds = (ids: number[]) => [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);

/** IGDB names for ids, for the title fallback. One query per 500 ids. */
async function namesFor(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0 || !igdbConfigured()) return out;
  try {
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const rows = await igdbCachedQuery<Array<{ id?: number; name?: string }>>(
        "games",
        `fields name;\nwhere id = (${part.join(",")});\nlimit ${part.length};`,
        TTL.detail,
      );
      for (const row of rows) if (typeof row.id === "number" && row.name) out.set(row.id, row.name);
    }
  } catch (err) {
    console.warn("[gfn] names failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

/**
 * GeForce NOW membership for many IGDB games (library matching). Only listed
 * games are in the map. Null when the catalogue is unreachable.
 *
 * Outbound (cold): catalogue 1, IGDB external ids ≤ 4 (shared with Game
 * Pass matching in the same request), names ≤ 1 per 500 unmatched ids.
 */
export async function geForceNowMatches(ids: number[]): Promise<Map<number, GeForceNowMembership> | null> {
  const valid = validIds(ids);
  const [rows, external] = await Promise.all([geForceNowRows(), valid.length > 0 ? externalIdsFor(valid) : new Map()]);
  if (!rows) return null;
  const lookup = gfnLookup(rows);
  const out = new Map<number, GeForceNowMembership>();
  const unmatched: number[] = [];
  for (const id of valid) {
    const steam = external.get(id)?.steam ?? null;
    const hit = steam ? gfnMembership(lookup, { steam, name: null }) : GFN_NOT_LISTED;
    if (hit.status !== "not-listed") out.set(id, hit);
    else unmatched.push(id);
  }
  const names = await namesFor(unmatched);
  for (const id of unmatched) {
    const name = names.get(id);
    if (!name) continue;
    // A title match must not contradict a known Steam app of a different game.
    const hit = gfnMembership(lookup, { steam: external.get(id)?.steam ?? null, name });
    if (hit.status !== "not-listed") out.set(id, hit);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Shelf
 * ------------------------------------------------------------------------ */

/** Steam appids → IGDB ids, via `external_games` (source 1 = Steam). */
async function igdbIdsForSteam(appids: number[]): Promise<number[]> {
  const sorted = [...new Set(appids)].sort((a, b) => a - b);
  const parts: number[][] = [];
  for (let i = 0; i < sorted.length; i += 450) parts.push(sorted.slice(i, i + 450));
  const rows = (
    await Promise.all(
      parts.map((part) =>
        igdbCachedQuery<Array<{ game?: number }>>(
          "external_games",
          `fields game;\nwhere external_game_source = 1 & uid = (${part.map((id) => `"${id}"`).join(",")});\nlimit 500;`,
          TTL.list,
        ),
      ),
    )
  ).flat();
  return [...new Set(rows.map((row) => row.game).filter((id): id is number => typeof id === "number"))];
}

/** IGDB's "playing" popularity (type 3) for ids, best first. */
async function playingRank(ids: number[], keep: number): Promise<number[]> {
  const parts: number[][] = [];
  for (let i = 0; i < ids.length; i += 450) parts.push(ids.slice(i, i + 450));
  const rows = (
    await Promise.all(
      parts.map((part) =>
        igdbCachedQuery<Array<{ game_id?: number; value?: number }>>(
          "popularity_primitives",
          `fields game_id,value;\nwhere game_id = (${part.join(",")}) & popularity_type = 3;\nsort value desc;\nlimit ${keep};`,
          TTL.list,
        ),
      ),
    )
  ).flat();
  return rows
    .filter((row): row is { game_id: number; value: number } => typeof row.game_id === "number" && typeof row.value === "number")
    .sort((a, b) => b.value - a.value || a.game_id - b.game_id)
    .map((row) => row.game_id);
}

const cachedHighlights = unstable_cache(
  async (limit: number): Promise<GameSummary[]> => {
    const rows = await cachedRows();
    const appids = rows.filter((row) => row[1] > 0 && row[4] === 0).map((row) => row[1]);
    const ids = await igdbIdsForSteam(appids);
    const ranked = (await playingRank(ids, limit * 2)).slice(0, limit * 2);
    const games = await listGamesByIds(ranked);
    const order = new Map(ranked.map((id, index) => [id, index]));
    const out = games
      .filter((game) => game.released !== null)
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
      .slice(0, limit);
    if (out.length === 0) throw new Error("gfn highlights: nothing matched");
    return out;
  },
  ["gfn-highlights-v1"],
  { revalidate: 60 * 60 * 12, tags: ["gfn"] },
);

/**
 * Popular games you can stream on GeForce NOW right now, most-played first
 * (IGDB's "playing" signal), for a home/discover shelf. Null when NVIDIA or
 * IGDB can't be reached.
 *
 * Outbound (cold): catalogue 1 + IGDB ≤ 3 (Steam joins) + ≤ 3 (popularity)
 * + 2 (cards and logos) — about 10; cached 12 h, 0 warm.
 */
export async function getGeForceNowHighlights(limit = 24): Promise<GameSummary[] | null> {
  if (!igdbConfigured()) return null;
  try {
    return await cachedHighlights(Math.min(48, Math.max(6, Math.round(limit))));
  } catch (err) {
    console.warn("[gfn] highlights unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}
