/**
 * Picks the homepage's "Today" stories from live data.
 *
 * Each story is one game plus the single, checkable reason it is on the page
 * today — a hype rank, a release date, a chart position, a critic score. The
 * reason is always computed from the same data the card shows; nothing here
 * is an editorial opinion dressed up as a fact. A story whose source list is
 * empty is simply skipped, and the same game never appears twice (including
 * the hero above, so the first screens don't repeat themselves).
 */

import type { GameSummary, RankedGame } from "@/lib/games/types";
import { daysUntil, parseISO } from "@/lib/utils/format";

export type StoryTone = "flare" | "brand" | "neon" | "gold";

export interface HomeStory {
  key: string;
  /** Small label over the art: what kind of story this is. */
  kicker: string;
  /** One line: why this game, today. */
  why: string;
  tone: StoryTone;
  game: GameSummary;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** "Out today", "Out tomorrow", "Out Friday", "Out Friday, October 30". */
function releaseWhy(game: GameSummary, now: Date): string | null {
  const days = daysUntil(game.released, now);
  const date = parseISO(game.released);
  if (days === null || !date) return null;
  if (days === 0) return "Out today.";
  if (days === 1) return "Out tomorrow.";
  if (days < 7) return `Out ${WEEKDAY.format(date)} — ${days} days to go.`;
  return `Out ${DAY_MONTH.format(date)} — ${days} days to go.`;
}

export function buildStories({
  anticipated,
  upcoming,
  trending,
  newReleases,
  topRated,
  exclude,
  now = new Date(),
}: {
  anticipated: RankedGame[];
  upcoming: GameSummary[];
  trending: GameSummary[];
  newReleases: GameSummary[];
  topRated: GameSummary[];
  /** Ids already featured above (the hero). */
  exclude: number[];
  now?: Date;
}): HomeStory[] {
  const used = new Set(exclude);
  const take = <T>(list: T[], pick: (item: T) => GameSummary): T | undefined => {
    const found = list.find((item) => !used.has(pick(item).id));
    if (found) used.add(pick(found).id);
    return found;
  };
  const stories: HomeStory[] = [];

  const hyped = take(anticipated, (entry) => entry.game);
  if (hyped) {
    stories.push({
      key: "anticipated",
      kicker: "Most anticipated",
      why: `Top of the hype index at ${hyped.hype}/100 — follows, wishlists and attention on IGDB.`,
      tone: "flare",
      game: hyped.game,
    });
  }

  // The biggest exact-dated release of the next fortnight, by IGDB's
  // popularity signal (falling back to calendar order when it has none).
  const soon = upcoming
    .filter((game) => {
      const days = daysUntil(game.released, now);
      return days !== null && days >= 0 && days <= 14;
    })
    .sort((a, b) => (b.popScore ?? 0) - (a.popScore ?? 0));
  const next = take(soon, (game) => game);
  const nextWhy = next ? releaseWhy(next, now) : null;
  if (next && nextWhy) {
    const days = daysUntil(next.released, now) ?? 99;
    stories.push({
      key: "release",
      kicker: days <= 7 ? "Out this week" : "Coming up",
      why: nextWhy,
      tone: "brand",
      game: next,
    });
  }

  const hot = trending.findIndex((game) => !used.has(game.id));
  if (hot >= 0) {
    const game = trending[hot];
    used.add(game.id);
    stories.push({
      key: "trending",
      kicker: "Trending",
      why:
        hot === 0
          ? "Number one on IGDB’s worldwide playing-now chart."
          : `Number ${hot + 1} on IGDB’s worldwide playing-now chart.`,
      tone: "neon",
      game,
    });
  }

  const acclaimed = take(
    newReleases.filter((game) => (game.metacritic ?? 0) >= 75).sort((a, b) => (b.metacritic ?? 0) - (a.metacritic ?? 0)),
    (game) => game,
  );
  if (acclaimed) {
    stories.push({
      key: "critics",
      kicker: "Critics’ pick",
      why: `Scored ${acclaimed.metacritic} by critics — the best-reviewed release of the last two months.`,
      tone: "gold",
      game: acclaimed,
    });
  } else {
    const classic = take(topRated.filter((game) => game.metacritic !== null), (game) => game);
    if (classic) {
      stories.push({
        key: "critics",
        kicker: "All-time great",
        why: `${classic.metacritic} from critics — among the highest scores in the database.`,
        tone: "gold",
        game: classic,
      });
    }
  }

  return stories;
}

/** Landscape art for a story card: key art first, then whatever exists. */
export function storyArt(game: GameSummary): string | null {
  return game.screenshots[0] ?? game.imageFallback ?? game.image;
}
