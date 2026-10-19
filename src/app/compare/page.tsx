import type { Metadata } from "next";
import { CompareView } from "@/components/compare/CompareView";
import { MAX_COMPARE, type CompareGame } from "@/components/compare/types";
import { getGame } from "@/lib/games/source";
import type { GameDetail } from "@/lib/games/types";

/**
 * `/compare?games=elden-ring,hollow-knight-s367520[,…]` — up to three games
 * side by side. The URL is the whole state, so a comparison is shareable as
 * a link and survives a reload.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SLUG = /^[a-z0-9][a-z0-9-]{0,159}$/;

function parseSlugs(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  return [...new Set(value.split(",").map((slug) => slug.trim().toLowerCase()).filter((slug) => SLUG.test(slug)))].slice(
    0,
    MAX_COMPARE,
  );
}

async function loadGames(slugs: string[]): Promise<{ games: CompareGame[]; missing: string[] }> {
  const results = await Promise.all(slugs.map((slug) => getGame(slug).catch(() => null)));
  const games: CompareGame[] = [];
  const missing: string[] = [];
  results.forEach((result, index) => {
    if (result) games.push(toCompareGame(result.data));
    else missing.push(slugs[index]);
  });
  return { games, missing };
}

function toCompareGame(game: GameDetail): CompareGame {
  return {
    id: game.id,
    slug: game.slug,
    name: game.name,
    image: game.image,
    imageFallback: game.imageFallback,
    logo: game.logo ?? null,
    released: game.released,
    releaseWindow: game.releaseWindow,
    tba: game.tba,
    metacritic: game.metacritic,
    rating: game.rating,
    ratingsCount: game.ratingsCount,
    timeToBeat: game.timeToBeat ?? null,
    platforms: game.parentPlatforms,
    genres: game.genres,
    modes: game.gameModes,
    developer: game.developers[0]?.name ?? game.publishers[0]?.name ?? null,
    hype: game.hypeIndex ? Math.round(game.hypeIndex.score) : null,
    steamAppId: game.steamAppId,
    microsoftId: game.externalIds?.microsoft ?? null,
  };
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const slugs = parseSlugs((await searchParams).games);
  if (slugs.length === 0) {
    return { title: "Compare games", description: "Put up to three games side by side: scores, prices, length and more." };
  }
  const { games } = await loadGames(slugs);
  const names = games.map((game) => game.name);
  const title = names.length > 1 ? `${names.slice(0, -1).join(", ")} vs ${names[names.length - 1]}` : `Compare ${names[0] ?? "games"}`;
  return {
    title,
    description: `${title}: critic scores, local prices, time to beat, players and platforms side by side.`,
    // Comparisons are endless permutations of game pages; the game pages are
    // what should be indexed.
    robots: { index: false, follow: true },
  };
}

export default async function ComparePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const slugs = parseSlugs(params.games);
  const { games, missing } = await loadGames(slugs);
  return <CompareView games={games} missing={missing} openPicker={params.add === "1"} />;
}
