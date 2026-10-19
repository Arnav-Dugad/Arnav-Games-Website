import type { GameLogo, Ref, TimeToBeat } from "@/lib/games/types";

/**
 * What the compare page needs about one game — a deliberately small slice of
 * `GameDetail`, so three games' worth of props don't bloat the page payload.
 */
export interface CompareGame {
  id: number;
  slug: string;
  name: string;
  image: string | null;
  imageFallback: string | null;
  logo: GameLogo | null;
  released: string | null;
  releaseWindow: string | null;
  tba: boolean;
  metacritic: number | null;
  rating: number;
  ratingsCount: number;
  timeToBeat: TimeToBeat | null;
  platforms: Ref[];
  genres: Ref[];
  modes: Ref[];
  developer: string | null;
  hype: number | null;
  steamAppId: number | null;
  microsoftId: string | null;
}

export const MAX_COMPARE = 3;

export function compareHref(slugs: string[], add = false): string {
  const unique = [...new Set(slugs)].slice(0, MAX_COMPARE);
  const params = unique.length ? `games=${unique.map(encodeURIComponent).join(",")}` : "";
  return `/compare${params || add ? "?" : ""}${params}${add ? `${params ? "&" : ""}add=1` : ""}`;
}
