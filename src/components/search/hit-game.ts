import type { SearchHit } from "@/lib/games/search";
import type { GameSummary } from "@/lib/games/types";

/**
 * The minimal `GameSummary` a search hit can honestly provide.
 *
 * Search returns only identity and release fields; everything else stays
 * empty/null rather than guessed. It is enough for the follow and ownership
 * controls, which only need the id, slug, name, art and release state.
 */
export function hitAsGame(hit: SearchHit): GameSummary {
  return {
    id: hit.id,
    slug: hit.slug,
    name: hit.name,
    released: hit.released ?? null,
    releaseWindow: hit.releaseWindow ?? null,
    tba: hit.tba ?? false,
    image: hit.image,
    imageFallback: null,
    rating: 0,
    ratingsCount: 0,
    metacritic: null,
    platforms: [],
    parentPlatforms: [],
    genres: [],
    screenshots: [],
    esrb: null,
    heroTrailer: null,
    popScore: null,
    playtime: 0,
    added: 0,
  };
}
