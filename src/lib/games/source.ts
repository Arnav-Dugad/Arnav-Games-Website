/**
 * The single data entry point for the whole app.
 *
 * Pages call these functions and never touch a provider directly. Every result
 * is real, live data — there is no bundled placeholder catalogue. Each request
 * walks the provider chain in priority order and takes the first usable answer:
 *
 *   IGDB   — best coverage (every platform, covers, trailers, critic scores).
 *            Needs free Twitch credentials.
 *   Steam  — no credentials at all, so a fresh deploy still shows live data.
 *            PC-only, and browsing is limited to the storefront's own shelves.
 *
 * Steam also acts as a genuine fallback when IGDB is configured but a
 * particular request fails — a transient IGDB outage degrades to Steam's live
 * catalogue rather than to nothing.
 *
 * A provider returning null means "I can't answer this", never "no results" —
 * an empty-but-successful page is returned as an empty `Page`, which stops the
 * chain. That distinction is what keeps a legitimate "no matches" from being
 * mistaken for an outage. If every configured provider genuinely fails, the
 * result is labelled `"unavailable"` so the UI can say so honestly rather than
 * inventing something to show.
 *
 * Every result carries the provider that produced it, so the UI can attribute
 * the data and surface an outage state truthfully.
 */

import {
  igdbProvider,
  igdbSpotlight,
  igdbSteamCharts,
  igdbTotalGames,
  type SteamChart,
} from "./providers/igdb";
import { enrichWithSteam, steamProvider } from "./providers/steam";
import { externalIdsFor, hypeIndexFor, summariesFor, timeToBeatFor } from "./providers/igdb-extras";
import { TTL, type GameProvider } from "./providers/types";
import { cache } from "react";
import { runAfterResponse } from "@/lib/cloudflare/db";
import { gamePassShelf } from "./gamepass";
import { paletteFor } from "./palette";
import { getReleaseChanges, recordReleaseObservations } from "./release-history";
import { steamLogoFor } from "./steam-logo";
import { trackGameView } from "./tracked";
import { wikidataFor } from "./wikidata";
import type {
  BrowseFilters,
  DataSource,
  GameDetail,
  GameSummary,
  Page,
  RankedGame,
  Ref,
  Sourced,
  SpotlightGame,
} from "./types";

/**
 * Which providers answer list and detail queries.
 *
 * When IGDB is configured it is the *only* browsing source. Steam is
 * deliberately not a fallback for a failing IGDB: its catalogue is the
 * storefront's own promotional shelves, so silently substituting it turns the
 * whole site into a list of whatever Steam is currently pushing — which reads
 * as a broken product rather than as the outage it actually is. Letting IGDB
 * failures surface as an honest "unavailable" state makes them diagnosable
 * instead of invisible.
 *
 * Steam is still used for the two things IGDB genuinely lacks — live pricing
 * and system requirements — via `enrichWithSteam` on the detail page.
 *
 * Steam only becomes a browsing source when IGDB has no credentials at all,
 * which is a local-development convenience rather than a production path.
 */
function activeChain(): GameProvider[] {
  if (igdbProvider.isConfigured()) return [igdbProvider];
  return [steamProvider];
}

/**
 * Last-resort providers, tried only after every preferred one has failed.
 *
 * `isConfigured()` can only check that credentials are *present*, not that they
 * still work — a rotated Twitch secret leaves IGDB configured but rejecting
 * every request. Without this, that single failure mode empties the entire
 * site. Steam is a poor substitute for IGDB's catalogue, so it never competes
 * for a request that IGDB can serve; it exists here purely so a total IGDB
 * outage degrades to a smaller live catalogue instead of to nothing.
 *
 * This is not silent: every result carries the provider that produced it, and
 * `SourceAttribution` renders it, so a page served from the fallback says so.
 */
function fallbackChain(): GameProvider[] {
  return igdbProvider.isConfigured() ? [steamProvider] : [];
}

/**
 * Runs `attempt` against each configured provider until one returns non-null.
 * A provider that throws is treated as unavailable rather than fatal.
 */
async function resolve<T>(
  operation: string,
  attempt: (provider: GameProvider) => Promise<T | null>,
): Promise<Sourced<T> | null> {
  for (const provider of [...activeChain(), ...fallbackChain()]) {
    try {
      const data = await attempt(provider);
      if (data !== null && data !== undefined) {
        return { data, source: provider.id };
      }
    } catch (err) {
      console.warn(
        `[source] ${provider.id}.${operation} threw:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return null;
}

/** A list result that is present but empty still counts as an answer. */
const emptyPage = (page: number): Page<GameSummary> => ({
  results: [],
  count: 0,
  hasNext: false,
  page,
});

/** Fallback for when every configured provider failed outright. */
const UNAVAILABLE: DataSource = "unavailable";

/* ---------------------------------------------------------------------------
 * Public queries
 * ------------------------------------------------------------------------ */

/** Which provider would answer right now, without performing a request. */
export function dataMode(): DataSource {
  return activeChain()[0]?.id ?? UNAVAILABLE;
}

/**
 * True when a result came from the fallback rather than the intended source.
 *
 * IGDB being configured but a page arriving from Steam means the credentials
 * are present and failing — the exact state that once turned the whole site
 * into a list of Steam promotions with no explanation. Surfacing it lets the
 * UI say so plainly instead of leaving the reader to wonder why the catalogue
 * looks wrong.
 */
export function isDegraded(source: DataSource): boolean {
  return source === "steam" && igdbProvider.isConfigured();
}

export async function browseGames(filters: BrowseFilters): Promise<Sourced<Page<GameSummary>>> {
  const result = await resolve("browse", (provider) => provider.browse(filters));
  return result ?? { data: emptyPage(filters.page ?? 1), source: UNAVAILABLE };
}

export async function getUpcoming(
  pageSize = 24,
  page = 1,
  filters: BrowseFilters = {},
): Promise<Sourced<Page<GameSummary>>> {
  const result = await resolve("upcoming", (provider) =>
    provider.upcoming(pageSize, page, filters),
  );
  // The calendar is where dates move, so every view of it feeds the delay
  // tracker. IGDB only: Steam ids are appids and would collide.
  if (result?.source === "igdb" && result.data.results.length > 0) {
    void runAfterResponse(recordReleaseObservations(result.data.results));
  }
  return result ?? { data: emptyPage(page), source: UNAVAILABLE };
}

/**
 * The homepage hero shelf.
 *
 * Deliberately bypasses the provider chain: this is IGDB or nothing. The hero
 * autoplays trailers over key art, and Steam list queries carry neither, so a
 * chain fallback here would silently turn the site's front door into a row of
 * static PC capsules. An empty hero is the honest outcome, and the page below
 * it still fills from the chain as usual.
 */
export async function getSpotlight(limit = 6): Promise<Sourced<SpotlightGame[]>> {
  const data = await igdbSpotlight(limit);
  if (!data || data.length === 0) return { data: [], source: UNAVAILABLE };

  /*
   * The stage dresses itself from two extras, fetched in parallel and both
   * cached: a palette sampled from the exact image the hero shows (so the
   * scrims and progress tint match the art rather than the box cover), and
   * one batched summary query for the tagline. Either failing leaves its
   * field null and the hero falls back to neutral scrims / no tagline.
   */
  const [palettes, summaries] = await Promise.all([
    Promise.all(data.map((game) => paletteFor(game.screenshots[0] ?? game.image))),
    summariesFor(data.map((game) => game.id)),
  ]);

  return {
    data: data.map((game, i) => ({
      ...game,
      palette: palettes[i] ?? null,
      tagline: heroTagline(summaries.get(game.id)),
    })),
    source: "igdb",
  };
}

/**
 * The first sentence of a summary, as hero copy.
 *
 * IGDB summaries are store-page paragraphs; the opening sentence is almost
 * always the pitch. Anything still too long for two lines is cut at a word
 * boundary — the text is the publisher's own, only shortened, never rewritten.
 */
function heroTagline(summary: string | undefined): string | null {
  const text = summary?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const first = text.match(/^.+?[.!?](?=\s+[A-Z"“'‘(]|$)/)?.[0] ?? text;
  const MAX = 160;
  if (first.length <= MAX) return first;
  const cut = first.slice(0, MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 80)).replace(/[,;:\s]+$/, "")}…`;
}

/**
 * Upcoming games ranked by the composite hype index.
 *
 * Candidates come from the notable calendar pre-sorted by IGDB's raw `hypes`
 * (so the pool is already the most-followed slice), then re-ranked by the
 * hype index, which also weighs want-to-play and page visits. Games with no
 * signal at all are dropped rather than shown with a fabricated zero.
 */
export async function getMostAnticipated(limit = 14): Promise<Sourced<RankedGame[]>> {
  const pool = await getUpcoming(Math.max(limit * 2, 24), 1, {
    notableOnly: true,
    ordering: "-hypes",
  });
  if (pool.source !== "igdb" || pool.data.results.length === 0) {
    return { data: [], source: pool.source };
  }
  const hype = await hypeIndexFor(pool.data.results.map((game) => game.id));
  const ranked = pool.data.results
    .map((game) => ({ game, hype: hype.get(game.id)?.score ?? 0 }))
    .filter((entry) => entry.hype > 0)
    .sort((a, b) => b.hype - a.hype)
    .slice(0, limit);
  return { data: ranked, source: pool.source };
}

/**
 * Steam's own charts — most played, top sellers, most wishlisted.
 *
 * Sourced from IGDB rather than Steam directly, which sounds backwards until
 * you look at what Steam actually exposes: there is no public "top games"
 * query, only the storefront's curated promotional shelves. IGDB ingests the
 * real charts from Steam and republishes them, so this is the only route to a
 * genuine Steam-wide ranking.
 */
export async function getSteamCharts(perChart = 12): Promise<Sourced<SteamChart[]>> {
  const data = await igdbSteamCharts(perChart);
  return data && data.length > 0
    ? { data, source: "igdb" }
    : { data: [], source: UNAVAILABLE };
}

export async function getTrending(pageSize = 12): Promise<Sourced<GameSummary[]>> {
  const result = await resolve("trending", (provider) => provider.trending(pageSize));
  return result ?? { data: [], source: UNAVAILABLE };
}

export async function getTopRated(pageSize = 12): Promise<Sourced<GameSummary[]>> {
  const result = await resolve("topRated", (provider) => provider.topRated(pageSize));
  return result ?? { data: [], source: UNAVAILABLE };
}

export async function getNewReleases(pageSize = 12): Promise<Sourced<GameSummary[]>> {
  const result = await resolve("newReleases", (provider) => provider.newReleases(pageSize));
  return result ?? { data: [], source: UNAVAILABLE };
}

/**
 * Detail lookup.
 *
 * Slugs are provider-specific — IGDB uses its own, Steam encodes an appid — so
 * a miss in the active provider legitimately falls through to the next. That
 * also keeps older bookmarked URLs working after credentials are added.
 *
 * Wrapped in React's per-request `cache` because the game page asks twice
 * (metadata and body); the enrichment below should run once per render.
 */
export const getGame = cache(async (slug: string): Promise<Sourced<GameDetail> | null> => {
  const result = await resolve("detail", (provider) => provider.detail(slug));
  if (!result) return null;

  if (result.source === "igdb") {
    return { ...result, data: await enrichIgdbDetail(result.data) };
  }

  // Steam-only titles: the provider already attached Steam's own logo, and
  // the cover palette is the one IGDB-independent extra worth having.
  // Steam's portrait capsule is missing for some apps, hence the header fallback.
  const palette =
    (await paletteFor(result.data.image)) ?? (await paletteFor(result.data.imageFallback));
  // Market crons key Steam-only titles on the negated appid (see tracked.ts).
  const appid = result.data.steamAppId ?? result.data.id;
  void runAfterResponse(trackGameView({ gameId: -appid, slug: result.data.slug, steamApp: appid, microsoft: null }));
  return { ...result, data: { ...result.data, palette } };
});

/**
 * Everything an IGDB detail record gains beyond the core query, fetched in
 * parallel. Each piece is cached and independently failure-tolerant — a dead
 * source leaves its field null (or the original value) and the page renders.
 *
 * Providers are merged, not just chained. IGDB knows every platform and has
 * the better artwork and critic scores; Steam supplies system requirements.
 * The Steam appid comes from IGDB's store links or, failing those, from its
 * `external_games` record — whichever answers, `steamAppId` and
 * `externalIds.steam` always agree.
 */
async function enrichIgdbDetail(detail: GameDetail): Promise<GameDetail> {
  const externalIds = externalIdsFor([detail.id]).then((ids) => {
    const found = ids.get(detail.id);
    const steam = detail.steamAppId ?? found?.steam ?? null;
    return found || steam
      ? { steam, twitch: found?.twitch ?? null, gog: found?.gog ?? null, microsoft: found?.microsoft ?? null, epic: found?.epic ?? null }
      : null;
  });

  const merged = externalIds.then(async (ids) => {
    const base = { ...detail, steamAppId: ids?.steam ?? detail.steamAppId };
    if (!base.steamAppId) return base;
    try {
      return await enrichWithSteam(base);
    } catch (err) {
      console.warn("[source] steam enrichment failed:", err instanceof Error ? err.message : err);
      return base;
    }
  });

  const [enriched, ids, timeToBeat, hype, palette, wiki, releaseChanges] = await Promise.all([
    merged,
    externalIds,
    timeToBeatFor([detail.id]),
    // The detail page's own daily window — see `fetchPopScores` in igdb.ts.
    hypeIndexFor([detail.id], TTL.detail),
    paletteFor(detail.image ?? detail.imageFallback),
    wikidataFor(detail.slug),
    getReleaseChanges(detail.id),
  ]);

  // IGDB's wordmark first; then Steam's library logo; Wikidata/Commons last,
  // since its marks are the least consistent in framing.
  const logo =
    detail.logo ??
    (await steamLogoFor(enriched.steamAppId)) ??
    wiki?.logo ??
    null;

  void runAfterResponse(recordReleaseObservations([detail]));
  // A viewed game joins the hourly player / daily price snapshots.
  void runAfterResponse(
    trackGameView({
      gameId: detail.id,
      slug: detail.slug,
      steamApp: enriched.steamAppId,
      microsoft: ids?.microsoft ?? null,
    }),
  );

  return {
    ...enriched,
    logo,
    externalIds: ids,
    timeToBeat: timeToBeat.get(detail.id) ?? null,
    hypeIndex: hype.get(detail.id) ?? null,
    palette,
    links: wiki?.links ?? null,
    releaseChanges,
  };
}

/**
 * Related titles.
 *
 * `preferred` should be the source that produced the game being viewed, so the
 * rail is drawn from the same catalogue as the page around it. Without that,
 * clicking into a related title could jump between providers mid-journey.
 */
export async function getRelated(
  game: GameDetail,
  preferred?: DataSource,
  limit = 8,
): Promise<GameSummary[]> {
  const chain = [...activeChain(), ...fallbackChain()];
  const ordered = preferred
    ? chain.sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : 0))
    : chain;

  for (const provider of ordered) {
    try {
      const related = await provider.related(game, limit);
      // An empty list is a weak answer; let the next provider try before
      // giving up on the rail entirely.
      if (related && related.length > 0) return related;
    } catch (err) {
      console.warn(
        `[source] ${provider.id}.related threw:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return [];
}

export async function searchGames(query: string, pageSize = 24, page = 1) {
  return browseGames({ search: query, pageSize, page });
}

export async function getGenres(): Promise<Sourced<Ref[]>> {
  const result = await resolve("genres", async (provider) => {
    const genres = await provider.genres();
    return genres && genres.length > 0 ? genres : null;
  });
  return result ?? { data: [], source: UNAVAILABLE };
}

export async function getPlatforms(): Promise<Sourced<Ref[]>> {
  const result = await resolve("platforms", async (provider) => {
    const platforms = await provider.platforms();
    return platforms && platforms.length > 0 ? platforms : null;
  });
  return result ?? { data: [], source: UNAVAILABLE };
}

/**
 * How many games the active database holds.
 *
 * Only IGDB can answer this honestly — Steam has no "total catalogue size"
 * concept, only a curated storefront pool. Returns null rather than a
 * misleading number when it can't be known; callers should hide the stat
 * entirely in that case rather than show a fabricated figure.
 */
export async function getTotalGames(): Promise<number | null> {
  const total = await igdbTotalGames();
  return total && total > 0 ? total : null;
}

/**
 * Slugs worth pre-rendering at build time: whatever is currently trending,
 * top rated, and at the front of the release calendar.
 *
 * Best-effort by design — every query it depends on already degrades to an
 * empty result rather than throwing, so an unreachable provider during the
 * build simply means fewer pages are pre-rendered. `dynamicParams` still
 * serves anything else on demand and caches it via ISR.
 */
export async function popularSlugs(limit = 60): Promise<string[]> {
  /*
   * Each source contributes up to `limit`, not a hardcoded 30.
   *
   * The three lists overlap heavily, so asking each for a third of the target
   * and then deduping reliably undershoots — `popularSlugs(200)` could never
   * return more than 90, and the sitemap silently asked for 200.
   */
  const perSource = Math.max(30, Math.ceil(limit * 0.75));
  const [trending, topRated, upcoming] = await Promise.all([
    getTrending(perSource),
    getTopRated(perSource),
    getUpcoming(perSource),
  ]);

  const slugs = [
    ...trending.data.map((game) => game.slug),
    ...topRated.data.map((game) => game.slug),
    ...upcoming.data.results.map((game) => game.slug),
  ];

  return [...new Set(slugs)].slice(0, limit);
}

/**
 * Game Pass shelves, from Microsoft's public catalogue joined to IGDB games.
 *
 * IGDB is the only source that can join a BigId to a game, so these are IGDB
 * or nothing: "unavailable" when the catalogue can't be reached or IGDB isn't
 * configured, an empty "igdb" list when it answered but nothing matched.
 */
async function gamePassShelfSourced(list: "leavingSoon" | "recentlyAdded"): Promise<Sourced<GameSummary[]>> {
  if (!igdbProvider.isConfigured()) return { data: [], source: UNAVAILABLE };
  try {
    const games = await gamePassShelf(list);
    return games ? { data: games, source: "igdb" } : { data: [], source: UNAVAILABLE };
  } catch (err) {
    console.warn(`[source] gamePass.${list} failed:`, err instanceof Error ? err.message : err);
    return { data: [], source: UNAVAILABLE };
  }
}

export function getGamePassLeavingSoon(): Promise<Sourced<GameSummary[]>> {
  return gamePassShelfSourced("leavingSoon");
}

export function getGamePassRecentlyAdded(): Promise<Sourced<GameSummary[]>> {
  return gamePassShelfSourced("recentlyAdded");
}

/** ISO `YYYY-MM-DD` for today, in UTC. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
