/**
 * The homepage's story reel: a short, swipeable run of games worth a look
 * right now — what's landing soon, what's trending, what just came out —
 * each with one line saying why, computed from the same data it shows.
 *
 * Built on the server from lists the homepage already fetched (no extra
 * provider calls) and slimmed to exactly what the viewer draws, so the
 * client payload is a handful of strings per story rather than full records.
 */

import type { GameLogo, GameSummary } from "@/lib/games/types";
import { daysUntil, releaseLabel } from "@/lib/utils/format";
import { releaseWhy, storyArt } from "./stories";

export type ReelKind = "soon" | "trending" | "new";

export interface ReelStory {
  id: number;
  slug: string;
  name: string;
  kind: ReelKind;
  /** Small label over the art. */
  kicker: string;
  /** One line: why this game, now. */
  hook: string;
  /** Release date or window, as shown elsewhere on the site. */
  when: string;
  cover: string | null;
  coverFallback: string | null;
  /** Landscape art for the full-screen story. */
  art: string | null;
  logo: GameLogo | null;
  genres: string;
}

const MAX_STORIES = 10;

function slim(game: GameSummary, kind: ReelKind, kicker: string, hook: string): ReelStory {
  return {
    id: game.id,
    slug: game.slug,
    name: game.name,
    kind,
    kicker,
    hook,
    when: releaseLabel(game, "Date to be announced"),
    cover: game.image,
    coverFallback: game.imageFallback,
    art: storyArt(game),
    logo: game.logo ?? null,
    // "Role-playing (RPG)" → "Role-playing": the abbreviation only costs width.
    genres: game.genres.slice(0, 2).map((genre) => genre.name.replace(/\s*\([^)]*\)$/, "")).join(" · "),
  };
}

export function buildReel({
  upcoming,
  trending,
  newReleases,
  exclude,
  now = new Date(),
}: {
  upcoming: GameSummary[];
  trending: GameSummary[];
  newReleases: GameSummary[];
  /** Ids already featured directly above (the hero). */
  exclude: number[];
  now?: Date;
}): ReelStory[] {
  const used = new Set(exclude);

  // Dated releases of the next month, the most watched first.
  const soon = upcoming
    .filter((game) => {
      const days = daysUntil(game.released, now);
      return days !== null && days >= 0 && days <= 31 && game.image;
    })
    .sort((a, b) => (b.popScore ?? 0) - (a.popScore ?? 0))
    .map((game) => {
      const days = daysUntil(game.released, now) ?? 99;
      return slim(game, "soon", days <= 7 ? "Out this week" : "Coming soon", releaseWhy(game, now) ?? releaseLabel(game));
    });

  const hot = trending
    .map((game, rank) => ({ game, rank }))
    .filter(({ game }) => game.image)
    .map(({ game, rank }) =>
      slim(game, "trending", "Trending", `Number ${rank + 1} on IGDB’s worldwide playing-now chart.`),
    );

  const fresh = newReleases
    .filter((game) => game.image)
    .map((game) =>
      slim(
        game,
        "new",
        "New release",
        game.metacritic !== null && game.metacritic >= 70
          ? `Out now, and critics scored it ${game.metacritic}.`
          : `Out now${game.genres[0] ? ` — new in ${game.genres[0].name.replace(/\s*\([^)]*\)$/, "").toLowerCase()}` : ""}.`,
      ),
    );

  // Interleave so the reel alternates moods instead of running one list dry.
  const reel: ReelStory[] = [];
  const lists = [soon, hot, fresh];
  for (let round = 0; reel.length < MAX_STORIES && lists.some((list) => list.length > round); round++) {
    for (const list of lists) {
      const story = list[round];
      if (!story || used.has(story.id) || reel.length >= MAX_STORIES) continue;
      used.add(story.id);
      reel.push(story);
    }
  }
  return reel;
}
