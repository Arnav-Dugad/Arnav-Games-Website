"use client";

/**
 * Instant search: popular games matched on the device, as you type.
 *
 * The palette shows these the moment a key lands — before the debounce, the
 * network and the server — and keeps them up if the server can't answer.
 * Server results replace them as soon as they arrive; the instant list only
 * ever fills in, never contradicts.
 */

import type { SearchIndexEntry } from "@/lib/games/providers/igdb";
import { EDITION_MARKERS, fuzzyTitleScore, normaliseSearch, searchSortKey } from "@/lib/games/fuzzy-search";
import type { SearchHit } from "@/lib/games/search";
import { readLocalCache, writeLocalCache } from "@/lib/utils/local-cache";

const INDEX_TTL_MS = 24 * 60 * 60_000;
const CACHE_KEY = "search-index-v2";

/** Resolved once per page load; a failed load is forgotten so the next open retries. */
let indexRequest: Promise<SearchIndexEntry[]> | null = null;

export function loadInstantIndex(): Promise<SearchIndexEntry[]> {
  if (indexRequest) return indexRequest;
  const cached = readLocalCache<SearchIndexEntry[]>(CACHE_KEY, INDEX_TTL_MS);
  if (cached?.length) return (indexRequest = Promise.resolve(cached));
  indexRequest = fetch("/api/search/popular")
    .then((res) => (res.ok ? res.json() : { games: [] }))
    .then((data: { games?: SearchIndexEntry[] }) => {
      const games = data.games ?? [];
      if (games.length > 0) writeLocalCache(CACHE_KEY, games);
      else indexRequest = null;
      return games;
    })
    .catch(() => {
      indexRequest = null;
      return [];
    });
  return indexRequest;
}

const cover = (id: string | null) =>
  id ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${id}.jpg` : null;

export function entryAsHit(entry: SearchIndexEntry): SearchHit {
  return {
    kind: "game",
    id: entry.id,
    name: entry.name,
    slug: entry.slug,
    subtitle: entry.genres || "Game",
    image: cover(entry.cover),
    released: entry.released,
    releaseWindow: null,
    tba: false,
  };
}

/**
 * Best matches for `query`, most relevant first, ranked exactly as the server
 * ranks (`searchSortKey`), so the list doesn't reshuffle when its answer lands.
 */
export function matchInstant(index: SearchIndexEntry[], query: string, limit = 6): SearchHit[] {
  const q = normaliseSearch(query);
  if (q.length < 2 || index.length === 0) return [];
  const editionQuery = EDITION_MARKERS.test(q);
  const scored: { entry: SearchIndexEntry; score: number; rank: number }[] = [];
  index.forEach((entry, rank) => {
    const best = Math.min(fuzzyTitleScore(entry.name, q), ...(entry.alt ?? []).map((alt) => fuzzyTitleScore(alt, q)));
    if (best >= 99) return;
    const edition = !editionQuery && EDITION_MARKERS.test(normaliseSearch(entry.name));
    scored.push({ entry, score: searchSortKey(best, edition, entry.pop ?? 0), rank });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.rank - b.rank)
    .slice(0, limit)
    .map(({ entry }) => entryAsHit(entry));
}
