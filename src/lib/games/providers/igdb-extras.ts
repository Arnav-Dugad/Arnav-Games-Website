/**
 * Batched IGDB enrichment that sits outside the core game query: time to
 * beat, external store/stream identities, the hype index, and lookups that
 * join outside catalogues (Game Pass) back to IGDB games.
 *
 * Every helper takes a *batch* of ids and issues one cached query per chunk,
 * through the same rate-limited transport as the rest of the provider. All of
 * them return empty maps on failure — enrichment never fails a page — and
 * none of them caches a failure, because the transport throws instead.
 */

import type { ExternalIds, HypeIndex, TimeToBeat } from "../types";
import { buildHypeIndex } from "../hype";
import type { HypeRow } from "../hype-reality";
import { igdbCachedQuery, igdbConfigured, igdbImage, MAIN_GAMES } from "./igdb";
import { TTL } from "./types";

const validIds = (ids: number[]) =>
  [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function warn(operation: string, err: unknown) {
  console.warn(`[igdb-extras] ${operation} failed:`, err instanceof Error ? err.message : err);
}

/* ---------------------------------------------------------------------------
 * Time to beat
 * ------------------------------------------------------------------------ */

/** Seconds → hours, to the nearest half hour; null for missing or zero. */
const toHours = (seconds: number | undefined) =>
  typeof seconds === "number" && seconds > 0 ? Math.round((seconds / 3600) * 2) / 2 : null;

/**
 * IGDB's crowd-sourced completion times, keyed by game id. Games nobody has
 * submitted a time for are simply absent.
 */
export async function timeToBeatFor(ids: number[]): Promise<Map<number, TimeToBeat>> {
  const out = new Map<number, TimeToBeat>();
  const valid = validIds(ids);
  if (valid.length === 0 || !igdbConfigured()) return out;
  try {
    const rows = (
      await Promise.all(
        chunk(valid, 450).map((part) =>
          igdbCachedQuery<
            Array<{ game_id?: number; hastily?: number; normally?: number; completely?: number; count?: number }>
          >(
            "game_time_to_beats",
            `fields game_id,hastily,normally,completely,count;\nwhere game_id = (${part.join(",")});\nlimit 500;`,
            TTL.detail,
          ),
        ),
      )
    ).flat();
    for (const row of rows) {
      if (typeof row.game_id !== "number") continue;
      const entry: TimeToBeat = {
        hastily: toHours(row.hastily),
        normally: toHours(row.normally),
        completely: toHours(row.completely),
        count: row.count ?? 0,
      };
      if (entry.hastily !== null || entry.normally !== null || entry.completely !== null) {
        out.set(row.game_id, entry);
      }
    }
  } catch (err) {
    warn("timeToBeat", err);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * External identities
 * ------------------------------------------------------------------------ */

/** `external_game_sources` ids. */
const SOURCES = { steam: 1, gog: 5, microsoft: 11, twitch: 14, epic: 26 } as const;

const MICROSOFT_BIG_ID = /^[0-9A-Z]{12}$/;

/**
 * Store and streaming ids for each game. A game with several listings on one
 * store (GOG often has two) keeps the oldest IGDB record, which is the
 * original listing rather than a later re-release.
 */
export async function externalIdsFor(ids: number[]): Promise<Map<number, ExternalIds>> {
  const out = new Map<number, ExternalIds>();
  const valid = validIds(ids);
  if (valid.length === 0 || !igdbConfigured()) return out;
  try {
    const rows = (
      await Promise.all(
        // ≤ 5 rows per game (one per source, occasionally two), so 90 ids stays under 500.
        chunk(valid, 90).map((part) =>
          igdbCachedQuery<Array<{ game?: number; uid?: string; external_game_source?: number }>>(
            "external_games",
            `fields game,uid,external_game_source;\nwhere game = (${part.join(",")}) & external_game_source = (${Object.values(SOURCES).join(",")});\nsort id asc;\nlimit 500;`,
            TTL.detail,
          ),
        ),
      )
    ).flat();

    for (const row of rows) {
      if (typeof row.game !== "number" || !row.uid) continue;
      const entry =
        out.get(row.game) ?? { steam: null, twitch: null, gog: null, microsoft: null, epic: null };
      const uid = row.uid.trim();
      switch (row.external_game_source) {
        case SOURCES.steam: {
          const appid = Number(uid);
          if (entry.steam === null && Number.isInteger(appid) && appid > 0) entry.steam = appid;
          break;
        }
        case SOURCES.twitch:
          if (entry.twitch === null && /^\d+$/.test(uid)) entry.twitch = uid;
          break;
        case SOURCES.gog:
          entry.gog ??= uid;
          break;
        case SOURCES.microsoft:
          if (entry.microsoft === null && MICROSOFT_BIG_ID.test(uid.toUpperCase())) {
            entry.microsoft = uid.toUpperCase();
          }
          break;
        case SOURCES.epic:
          entry.epic ??= uid;
          break;
      }
      out.set(row.game, entry);
    }
  } catch (err) {
    warn("externalIds", err);
  }
  return out;
}

/**
 * IGDB game ids for Microsoft Store BigIds (what Game Pass catalogues list),
 * as `BigId → game id`. Unmatched BigIds are absent.
 */
export async function igdbIdsForMicrosoft(
  bigIds: string[],
  revalidate: number = TTL.list,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const valid = [...new Set(bigIds.map((id) => id.toUpperCase()).filter((id) => MICROSOFT_BIG_ID.test(id)))].sort();
  if (valid.length === 0 || !igdbConfigured()) return out;
  try {
    const rows = (
      await Promise.all(
        chunk(valid, 200).map((part) =>
          igdbCachedQuery<Array<{ game?: number; uid?: string }>>(
            "external_games",
            `fields game,uid;\nwhere external_game_source = ${SOURCES.microsoft} & uid = (${part.map((id) => `"${id}"`).join(",")});\nsort id asc;\nlimit 500;`,
            revalidate,
          ),
        ),
      )
    ).flat();
    for (const row of rows) {
      const uid = row.uid?.toUpperCase();
      if (uid && typeof row.game === "number" && !out.has(uid)) out.set(uid, row.game);
    }
  } catch (err) {
    warn("microsoftIds", err);
  }
  return out;
}

/** Store-title noise that never appears in IGDB's canonical names. */
export function normaliseStoreTitle(title: string): string {
  return title
    .replace(/[™®©]/g, "")
    .replace(/\s*[-–:]\s*(cross-gen bundle|standard edition|game preview|xbox series x\|s|windows( 10)?)\s*$/i, "")
    .replace(/\s*\((game preview|windows( 10)?|pc|xbox( one| series x\|s)?)\)\s*$/i, "")
    .replace(/\s+for windows( 10)?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Exact (case-insensitive) title matches for store titles that had no id
 * link. Ties between same-named games go to the one with more engagement —
 * the shovelware clone of a famous name never has more. Keyed by the
 * *normalised* title.
 */
export async function igdbIdsForTitles(
  titles: string[],
  revalidate: number = TTL.list,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const names = [...new Set(titles.map(normaliseStoreTitle).filter((name) => name.length > 1 && name.length <= 120))].sort();
  if (names.length === 0 || !igdbConfigured()) return out;
  try {
    const rows = (
      await Promise.all(
        chunk(names, 25).map((part) =>
          igdbCachedQuery<Array<{ id: number; name?: string; hypes?: number; total_rating_count?: number }>>(
            "games",
            `fields name,hypes,total_rating_count;\nwhere version_parent = null & (${part
              .map((name) => `name ~ "${name.replace(/["\\]/g, "")}"`)
              .join(" | ")});\nlimit 500;`,
            revalidate,
          ),
        ),
      )
    ).flat();
    const best = new Map<string, { id: number; weight: number }>();
    for (const row of rows) {
      if (!row.name) continue;
      const key = row.name.toLowerCase();
      const weight = (row.total_rating_count ?? 0) + (row.hypes ?? 0);
      const current = best.get(key);
      if (!current || weight > current.weight) best.set(key, { id: row.id, weight });
    }
    for (const name of names) {
      const match = best.get(name.toLowerCase());
      if (match) out.set(name, match.id);
    }
  } catch (err) {
    warn("titleMatch", err);
  }
  return out;
}

/** The IGDB slug for an id, or null when there is no such game. */
export async function igdbSlugForId(id: number): Promise<string | null> {
  if (!Number.isInteger(id) || id <= 0 || !igdbConfigured()) return null;
  try {
    const rows = await igdbCachedQuery<Array<{ slug?: string }>>(
      "games",
      `fields slug;\nwhere id = ${id};\nlimit 1;`,
      TTL.detail,
    );
    return rows[0]?.slug ?? null;
  } catch (err) {
    warn("slugForId", err);
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Hype index
 * ------------------------------------------------------------------------ */

/** `popularity_types` ids used by the index; see `hype.ts`. */
const POP = { visits: 1, wantToPlay: 2, playing: 3, peakPlayers24h: 5 } as const;

interface MultiResult {
  name: string;
  result?: Array<Record<string, unknown>>;
}

/* ---------------------------------------------------------------------------
 * Summaries
 * ------------------------------------------------------------------------ */

/**
 * IGDB's marketing summary per game, for surfaces (the homepage hero) that
 * carry list-shaped summaries but want a line of copy. Kept out of the core
 * list query on purpose: summaries are the single largest field, and every
 * other list in the app would pay for text it never shows.
 */
export async function summariesFor(
  ids: number[],
  revalidate: number = TTL.list,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const valid = validIds(ids);
  if (valid.length === 0 || !igdbConfigured()) return out;
  try {
    const rows = (
      await Promise.all(
        chunk(valid, 450).map((part) =>
          igdbCachedQuery<Array<{ id?: number; summary?: string }>>(
            "games",
            `fields summary;\nwhere id = (${part.join(",")});\nlimit ${part.length};`,
            revalidate,
          ),
        ),
      )
    ).flat();
    for (const row of rows) {
      const text = row.summary?.trim();
      if (typeof row.id === "number" && text) out.set(row.id, text);
    }
  } catch (err) {
    warn("summaries", err);
  }
  return out;
}

/**
 * Hype index per game; see `hype.ts` for the formula. One IGDB Multi-Query
 * per 100 ids fetches `hypes` and the four popularity primitives together.
 * Games with no signal at all are absent.
 *
 * `revalidate` should match the caller's own lifetime: lists use the list
 * window, the detail page its daily one.
 */
export async function hypeIndexFor(
  ids: number[],
  revalidate: number = TTL.list,
): Promise<Map<number, HypeIndex>> {
  const out = new Map<number, HypeIndex>();
  const valid = validIds(ids);
  if (valid.length === 0 || !igdbConfigured()) return out;
  try {
    const responses = await Promise.all(
      chunk(valid, 100).map((part) =>
        igdbCachedQuery<MultiResult[]>(
          "multiquery",
          [
            `query games "hypes" {\nfields hypes;\nwhere id = (${part.join(",")});\nlimit ${part.length};\n};`,
            `query popularity_primitives "pop" {\nfields game_id,popularity_type,value;\nwhere game_id = (${part.join(",")}) & popularity_type = (${Object.values(POP).join(",")});\nlimit 500;\n};`,
          ].join("\n\n"),
          revalidate,
        ),
      ),
    );

    const hypes = new Map<number, number>();
    const signals = new Map<number, Partial<Record<keyof typeof POP, number>>>();
    for (const response of responses) {
      for (const row of response.find((entry) => entry.name === "hypes")?.result ?? []) {
        if (typeof row.id === "number") hypes.set(row.id, typeof row.hypes === "number" ? row.hypes : 0);
      }
      for (const row of response.find((entry) => entry.name === "pop")?.result ?? []) {
        if (typeof row.game_id !== "number" || typeof row.value !== "number") continue;
        const key = (Object.keys(POP) as Array<keyof typeof POP>).find((name) => POP[name] === row.popularity_type);
        if (!key) continue;
        const entry = signals.get(row.game_id) ?? {};
        entry[key] = row.value;
        signals.set(row.game_id, entry);
      }
    }

    for (const id of valid) {
      const pop = signals.get(id) ?? {};
      const index = buildHypeIndex({
        hypes: hypes.get(id) ?? 0,
        wantToPlay: pop.wantToPlay ?? null,
        visits: pop.visits ?? null,
        playing: pop.playing ?? null,
        peakPlayers24h: pop.peakPlayers24h ?? null,
      });
      if (index) out.set(id, index);
    }
  } catch (err) {
    warn("hypeIndex", err);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Cron lookups (release windows, critic aggregates)
 * ------------------------------------------------------------------------ */

/**
 * Release dates (unix seconds, IGDB's `first_release_date`) for the ids that
 * release inside `[from, to)`. One query per 500 ids. The crons pass
 * hour-aligned bounds, so a re-run within the hour is a cache hit and the
 * next hour's run asks afresh.
 */
export async function releaseDatesInWindow(
  ids: number[],
  from: number,
  to: number,
  revalidate = 600,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const valid = validIds(ids);
  if (valid.length === 0 || !igdbConfigured()) return out;
  try {
    const rows = (
      await Promise.all(
        chunk(valid, 500).map((part) =>
          igdbCachedQuery<Array<{ id?: number; first_release_date?: number }>>(
            "games",
            `fields first_release_date;\nwhere id = (${part.join(",")}) & first_release_date >= ${Math.floor(from)} & first_release_date < ${Math.floor(to)};\nlimit 500;`,
            revalidate,
          ),
        ),
      )
    ).flat();
    for (const row of rows) {
      if (typeof row.id === "number" && typeof row.first_release_date === "number") out.set(row.id, row.first_release_date);
    }
  } catch (err) {
    warn("releaseWindow", err);
  }
  return out;
}

/**
 * IGDB's critic aggregate (0–100) and how many outlets it averages, for ids
 * released inside `[from, to)` that have one. Null when IGDB failed, so a
 * cron can tell "nothing scored yet" from an outage.
 */
export async function criticAggregatesFor(
  ids: number[],
  from: number,
  to: number,
  revalidate = 600,
): Promise<Map<number, { score: number; count: number }> | null> {
  const out = new Map<number, { score: number; count: number }>();
  const valid = validIds(ids);
  if (valid.length === 0 || !igdbConfigured()) return out;
  try {
    const rows = (
      await Promise.all(
        chunk(valid, 500).map((part) =>
          igdbCachedQuery<Array<{ id?: number; aggregated_rating?: number; aggregated_rating_count?: number }>>(
            "games",
            `fields aggregated_rating,aggregated_rating_count;\nwhere id = (${part.join(",")}) & first_release_date >= ${Math.floor(from)} & first_release_date < ${Math.floor(to)} & aggregated_rating != null;\nlimit 500;`,
            revalidate,
          ),
        ),
      )
    ).flat();
    for (const row of rows) {
      if (typeof row.id !== "number" || typeof row.aggregated_rating !== "number") continue;
      if (!Number.isFinite(row.aggregated_rating) || row.aggregated_rating < 0 || row.aggregated_rating > 100) continue;
      out.set(row.id, { score: row.aggregated_rating, count: Math.max(0, row.aggregated_rating_count ?? 0) });
    }
    return out;
  } catch (err) {
    warn("criticAggregates", err);
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Hype vs reality
 * ------------------------------------------------------------------------ */

/** Hype vs reality is a slow-moving picture: one query, cached for half a day. */
const HYPE_TTL = 60 * 60 * 12;
/** How far back "recent releases" reaches, and how long a launch gets for scores to settle. */
const HYPE_WINDOW_DAYS = 540;
const HYPE_SETTLE_DAYS = 21;
/**
 * IGDB `game_type`s that are a release in their own right: main game,
 * standalone expansion, remake, remaster, expanded game. Bundles, mods and
 * fan forks would compare a compilation's or a fan project's reception with
 * a following it never had.
 */
const HYPE_GAME_TYPES = "0,4,8,9,10";

/**
 * Recent releases with both a pre-release following and a settled score, for
 * `analyseHype`. One IGDB request. The window is pinned to the UTC day, so
 * every caller that day — the stats page and every game page's note — shares
 * one cache entry. Throws nothing: an outage returns null.
 */
export async function hypeRealityRows(now = Date.now()): Promise<HypeRow[] | null> {
  if (!igdbConfigured()) return null;
  const today = Math.floor(now / 86_400_000) * 86_400;
  const from = today - HYPE_WINDOW_DAYS * 86_400;
  const to = today - HYPE_SETTLE_DAYS * 86_400;
  try {
    const rows = await igdbCachedQuery<Array<{
      id?: number;
      slug?: string;
      name?: string;
      cover?: { image_id?: string };
      hypes?: number;
      aggregated_rating?: number;
      aggregated_rating_count?: number;
      rating?: number;
      rating_count?: number;
      first_release_date?: number;
    }>>(
      "games",
      `fields slug,name,cover.image_id,hypes,aggregated_rating,aggregated_rating_count,rating,rating_count,first_release_date;\nwhere ${MAIN_GAMES} & game_type = (${HYPE_GAME_TYPES}) & first_release_date >= ${from} & first_release_date < ${to} & hypes >= 5 & (aggregated_rating_count >= 3 | rating_count >= 25);\nsort hypes desc;\nlimit 300;`,
      HYPE_TTL,
    );
    return rows.flatMap((row): HypeRow[] => {
      if (typeof row.id !== "number" || !row.slug || !row.name || typeof row.hypes !== "number" || !row.first_release_date) return [];
      const critics = typeof row.aggregated_rating === "number" && (row.aggregated_rating_count ?? 0) >= 3;
      const members = typeof row.rating === "number" && (row.rating_count ?? 0) >= 25;
      if (!critics && !members) return [];
      const score = critics ? row.aggregated_rating! : row.rating!;
      if (!Number.isFinite(score) || score <= 0 || score > 100) return [];
      return [{
        id: row.id,
        slug: row.slug,
        name: row.name,
        image: igdbImage(row.cover?.image_id, "cover_small"),
        hypes: row.hypes,
        score: Math.round(score * 10) / 10,
        scoreKind: critics ? "critics" : "members",
        count: critics ? row.aggregated_rating_count ?? 0 : row.rating_count ?? 0,
        released: new Date(row.first_release_date * 1000).toISOString().slice(0, 10),
      }];
    });
  } catch (err) {
    warn("hypeReality", err);
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Steam library matching
 * ------------------------------------------------------------------------ */

/**
 * Steam appids → IGDB game ids (`external_games`, source 1 = Steam), as
 * `appid → game id`. An app IGDB lists against several records keeps the
 * oldest listing — the original game, not a later edition. One query per
 * 200 appids. Null on an outage, so the import can say "try again" rather
 * than "none of your games are known".
 */
export async function igdbIdsForSteamApps(appids: number[]): Promise<Map<number, number> | null> {
  const out = new Map<number, number>();
  const valid = validIds(appids);
  if (valid.length === 0 || !igdbConfigured()) return out;
  try {
    const rows = (
      await Promise.all(
        chunk(valid, 200).map((part) =>
          igdbCachedQuery<Array<{ game?: number; uid?: string }>>(
            "external_games",
            `fields game,uid;\nwhere external_game_source = ${SOURCES.steam} & uid = (${part.map((id) => `"${id}"`).join(",")});\nsort id asc;\nlimit 500;`,
            TTL.detail,
          ),
        ),
      )
    ).flat();
    for (const row of rows) {
      const appid = Number(row.uid);
      if (Number.isInteger(appid) && appid > 0 && typeof row.game === "number" && !out.has(appid)) out.set(appid, row.game);
    }
    return out;
  } catch (err) {
    warn("steamApps", err);
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Taste facets
 * ------------------------------------------------------------------------ */

/**
 * Themes and player perspectives per game, for the taste map. Kept out of
 * the summary query (every list would pay for them); one query per 450 ids.
 */
export async function facetsFor(ids: number[]): Promise<Map<number, { t: Array<[number, string]>; p: Array<[number, string]> }>> {
  const out = new Map<number, { t: Array<[number, string]>; p: Array<[number, string]> }>();
  const valid = validIds(ids);
  if (valid.length === 0 || !igdbConfigured()) return out;
  try {
    const rows = (
      await Promise.all(
        chunk(valid, 450).map((part) =>
          igdbCachedQuery<Array<{ id?: number; themes?: Array<{ id?: number; name?: string }>; player_perspectives?: Array<{ id?: number; name?: string }> }>>(
            "games",
            `fields themes.name,player_perspectives.name;\nwhere id = (${part.join(",")});\nlimit ${part.length};`,
            TTL.detail,
          ),
        ),
      )
    ).flat();
    const pairs = (list: Array<{ id?: number; name?: string }> | undefined) =>
      (list ?? []).flatMap((item): Array<[number, string]> => (typeof item.id === "number" && item.name ? [[item.id, item.name]] : []));
    for (const row of rows) {
      // Erotic (42) is never charted, as everywhere else in the app.
      if (typeof row.id === "number") out.set(row.id, { t: pairs(row.themes).filter(([id]) => id !== 42), p: pairs(row.player_perspectives) });
    }
  } catch (err) {
    warn("facets", err);
  }
  return out;
}
