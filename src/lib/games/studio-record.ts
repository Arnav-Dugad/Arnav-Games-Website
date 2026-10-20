/**
 * A developer's track record for the game page: how its released games
 * scored with critics, how many it has made, and how often its announced
 * dates held (our own delay tracker, `reliability.ts`).
 *
 * IGDB, two requests per studio: a `companies` lookup (name, slug and the
 * ids of the games it *developed* — publishing credits are someone else's
 * work), then one `games` request filtered server-side to main games,
 * remakes, remasters and standalone expansions that aren't an edition of
 * another game. Raw responses are in the data cache for three days; the
 * assembled record is cached a day (the delay half moves daily at most).
 *
 * Outbound per studio with every cache cold: IGDB 2, Firestore 1 (the
 * release shards, one batch read) — at most 7 for two studios including the
 * IGDB token, 0 warm.
 */

import { unstable_cache } from "next/cache";
import { reliabilityFromObservations } from "./market-rules";
import { igdbCachedQuery, igdbConfigured } from "./providers/igdb";
import { readReleaseObservations } from "./release-history";
import type { StudioRecord, StudioReliability } from "./types";

const THREE_DAYS = 3 * 86_400;
const DAY = 86_400;
/** A critic average from one review is one critic's opinion. */
export const MIN_CRITICS = 2;
/** IGDB caps a query's id list in practice and its results at 500. */
const MAX_IDS = 1500;
const MAX_RESULTS = 500;
/** IGDB `game_status`: cancelled, rumored — not games the studio shipped or is shipping. */
const NOT_SHIPPING = new Set([6, 7]);

export interface StudioGameRow {
  id: number;
  name?: string;
  slug?: string;
  aggregated_rating?: number;
  aggregated_rating_count?: number;
  first_release_date?: number;
  game_status?: number;
}

/**
 * Rows → the record's numbers. Released means a first release date before
 * `now` (unix seconds); upcoming means a later one or none at all (TBA).
 */
export function summariseStudioGames(
  rows: StudioGameRow[],
  now: number,
): Pick<StudioRecord, "released" | "upcoming" | "scored" | "avgCritic" | "best"> & { ids: number[] } {
  const shipping = rows.filter((row) => Number.isInteger(row.id) && !NOT_SHIPPING.has(row.game_status ?? -1));
  const released = shipping.filter((row) => typeof row.first_release_date === "number" && row.first_release_date <= now);
  const scored = released.filter(
    (row) => typeof row.aggregated_rating === "number" && (row.aggregated_rating_count ?? 0) >= MIN_CRITICS,
  );
  const best = [...scored].sort(
    (a, b) => b.aggregated_rating! - a.aggregated_rating! || (b.aggregated_rating_count ?? 0) - (a.aggregated_rating_count ?? 0),
  )[0];
  return {
    released: released.length,
    upcoming: shipping.length - released.length,
    scored: scored.length,
    avgCritic: scored.length ? Math.round(scored.reduce((sum, row) => sum + row.aggregated_rating!, 0) / scored.length) : null,
    best: best?.name && best.slug ? { name: best.name, slug: best.slug, score: Math.round(best.aggregated_rating!) } : null,
    ids: shipping.map((row) => row.id),
  };
}

type Company = { id: number; name?: string; slug?: string; developed?: number[] };

async function companies(ids: number[]): Promise<Company[]> {
  return igdbCachedQuery<Company[]>(
    "companies",
    `fields name,slug,developed;\nwhere id = (${ids.join(",")});\nlimit ${ids.length};`,
    THREE_DAYS,
  );
}

async function studioGames(developed: number[]): Promise<StudioGameRow[]> {
  if (developed.length === 0) return [];
  return igdbCachedQuery<StudioGameRow[]>(
    "games",
    "fields name,slug,aggregated_rating,aggregated_rating_count,first_release_date,game_status;\n" +
      `where id = (${developed.slice(0, MAX_IDS).join(",")}) & game_type = (0,4,8,9) & version_parent = null;\n` +
      `limit ${MAX_RESULTS};`,
    THREE_DAYS,
  );
}

/** Our delay history for these games; throws when Firestore can't be read, so no empty answer is cached. */
async function reliabilityOf(ids: number[]): Promise<StudioReliability> {
  const observations = await readReleaseObservations(ids);
  if (!observations) throw new Error("release history unavailable");
  const rows: Array<{ gameId: number; value: string; observedAt: number }> = [];
  for (const [gameId, list] of observations) for (const row of list) rows.push({ gameId, value: row.value, observedAt: row.observedAt });
  return reliabilityFromObservations(rows);
}

async function buildRecord(company: Company, withReliability: boolean): Promise<StudioRecord> {
  const developed = (company.developed ?? []).filter((id) => Number.isInteger(id) && id > 0);
  const rows = await studioGames(developed);
  const summary = summariseStudioGames(rows, Math.floor(Date.now() / 1000));
  const { ids, ...numbers } = summary;
  return {
    id: company.id,
    name: company.name ?? "This studio",
    slug: company.slug ?? String(company.id),
    ...numbers,
    truncated: developed.length > MAX_IDS || rows.length >= MAX_RESULTS,
    reliability: withReliability ? await reliabilityOf(ids) : null,
  };
}

/** The whole record, a day at a time. Throws (so nothing is cached) when any part fails. */
const cachedRecord = unstable_cache(
  async (id: number): Promise<StudioRecord | null> => {
    const [company] = await companies([id]);
    return company ? buildRecord(company, true) : null;
  },
  ["studio-record-v1"],
  { revalidate: DAY, tags: ["studio-record"] },
);

/**
 * Track records for up to two developer ids, in the order given. A studio
 * whose delay history can't be read still gets its scores (with
 * `reliability: null`); one IGDB can't describe is left out.
 */
export async function studioRecords(ids: number[]): Promise<StudioRecord[]> {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 2);
  if (wanted.length === 0 || !igdbConfigured()) return [];
  const records = await Promise.all(
    wanted.map(async (id) => {
      try {
        return await cachedRecord(id);
      } catch {
        // Firestore (or a cold IGDB answer) failed: the IGDB half alone, uncached.
        try {
          const [company] = await companies([id]);
          return company ? await buildRecord(company, false) : null;
        } catch {
          return null;
        }
      }
    }),
  );
  return records.filter((record): record is StudioRecord => record !== null);
}
