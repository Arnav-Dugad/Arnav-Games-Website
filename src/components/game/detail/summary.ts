import type { GameDetail } from "@/lib/games/types";

/**
 * The opening phrase of the "At a glance" sentence — "Acclaimed open-world
 * action RPG from FromSoftware" — built only from fields the record has.
 *
 * Pure and server-side. Nothing is inferred beyond IGDB's own genre and theme
 * tags: the qualifier comes from the critic score (and only when enough
 * critics weighed in to make it more than one opinion), the adjectives from
 * themes, the noun from genres. A game without genres is simply a "game".
 */

/** IGDB genre → the noun (or adjective) a person would say. */
const GENRE_WORD: Record<string, string> = {
  "role-playing (rpg)": "RPG",
  moba: "MOBA",
  fighting: "fighting game",
  platform: "platformer",
  "visual novel": "visual novel",
  puzzle: "puzzle game",
  racing: "racing game",
  sport: "sports game",
  "real time strategy (rts)": "real-time strategy game",
  "turn-based strategy (tbs)": "turn-based strategy game",
  strategy: "strategy game",
  tactical: "tactics game",
  simulator: "simulation game",
  "card & board game": "card game",
  shooter: "shooter",
  "hack and slash/beat 'em up": "hack-and-slash",
  "point-and-click": "point-and-click adventure",
  music: "rhythm game",
  "quiz/trivia": "trivia game",
  pinball: "pinball game",
  adventure: "adventure",
  arcade: "arcade game",
  indie: "indie game",
};

/** Order in which a genre wins the noun slot: the most specific first. */
const HEAD_ORDER = Object.keys(GENRE_WORD);

/** Themes that make a useful adjective, most telling first. */
const THEME_WORD: Array<[string, string]> = [
  ["horror", "horror"],
  ["survival", "survival"],
  ["stealth", "stealth"],
  ["science fiction", "sci-fi"],
];

/** Below this many critic reviews an aggregate is a couple of opinions, not a consensus. */
const MIN_CRITICS = 4;

function qualifier(game: GameDetail, upcoming: boolean): string | null {
  if (upcoming) return "Upcoming";
  const score = game.metacritic;
  // Steam-sourced records carry Metacritic's own score, which is already a
  // consensus; IGDB aggregates also report how many critics went in.
  const enough = game.criticCount == null ? score !== null : game.criticCount >= MIN_CRITICS;
  if (score === null || !enough) return null;
  if (score >= 90) return "Acclaimed";
  if (score >= 80) return "Well-reviewed";
  if (score < 60) return "Poorly reviewed";
  return null;
}

export function describeGame(game: GameDetail, upcoming: boolean): string {
  const genres = new Set(game.genres.map((genre) => genre.name.toLowerCase()));
  const themes = new Set(game.themes.map((theme) => theme.name.toLowerCase()));
  const openWorld = themes.has("open world");

  let head = HEAD_ORDER.find((genre) => genres.has(genre)) ?? null;
  // "Open-world adventure" is how people describe GTA-likes, not "shooter".
  if (openWorld && genres.has("adventure") && head !== "role-playing (rpg)") head = "adventure";

  const words: string[] = [];
  if (openWorld) words.push("open-world");
  const specific =
    head === "shooter" && genres.has("tactical")
      ? "tactical"
      : THEME_WORD.find(([theme]) => themes.has(theme))?.[1] ?? null;
  if (specific) words.push(specific);
  else if (themes.has("action") && head && !["shooter", "fighting", "hack and slash/beat 'em up"].includes(head)) {
    words.push("action");
  }
  words.push(head ? GENRE_WORD[head] : "game");

  const lead = qualifier(game, upcoming);
  const phrase = [lead, ...words].filter(Boolean).join(" ");
  const studio = game.developers[0]?.name ?? null;
  const sentence = studio ? `${phrase} from ${studio}` : phrase;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * IGDB's main-story hours, when the game has a story to finish.
 *
 * Endless games (competitive shooters, MMOs) still collect "main story"
 * submissions — usually the tutorial — so Counter-Strike 2 reads "1 h main
 * story, 140 h completionist". Quoting that as its length (or dividing its
 * price by it) would mislead, so when completionist runs 20× the main story
 * there's no story length to quote. The full bands still show in "How long".
 */
export function storyHours(ttb: GameDetail["timeToBeat"]): number | null {
  const main = ttb?.hastily ?? null;
  if (!main || main <= 0) return null;
  if (ttb?.completely && ttb.completely / main >= 20) return null;
  return main;
}

/** [number, unit]: ["46", "h"], ["7.5", "h"], ["40", "min"]. */
export function hoursParts(hours: number): [string, string] {
  if (hours < 1) return [String(Math.max(5, Math.round((hours * 60) / 5) * 5)), "min"];
  return [String(hours >= 10 ? Math.round(hours) : Math.round(hours * 2) / 2), "h"];
}

/** "46 h", "7.5 h", "40 min". */
export function hoursLabel(hours: number): string {
  return hoursParts(hours).join(" ");
}
