/**
 * Player tags: the fixed vocabulary readers tag games with.
 *
 * Public counts (`communityTags/{gameId}`) only ever contain these slugs, so
 * the aggregate can't be filled with spam, slurs or personal data; anything
 * a reader types outside the list is kept as a *private* custom tag on their
 * own record and never counted. Pure: shared by the client and the
 * `/api/tags` route.
 */

export const PLAYER_TAGS = {
  "great-story": "Great story",
  emotional: "Emotional",
  funny: "Funny",
  scary: "Scary",
  atmospheric: "Atmospheric",
  beautiful: "Beautiful",
  "great-soundtrack": "Great soundtrack",
  cozy: "Cozy",
  relaxing: "Relaxing",
  "comfort-game": "Comfort game",
  challenging: "Challenging",
  punishing: "Punishing",
  "easy-to-learn": "Easy to learn",
  "deep-systems": "Deep systems",
  tactical: "Tactical",
  "fast-paced": "Fast-paced",
  "slow-burn": "Slow burn",
  exploration: "Exploration",
  "clever-puzzles": "Clever puzzles",
  "open-ended": "Open-ended",
  linear: "Linear",
  short: "Short",
  long: "Long",
  replayable: "Replayable",
  grindy: "Grindy",
  "great-co-op": "Great co-op",
  "couch-co-op": "Couch co-op",
  "best-with-friends": "Best with friends",
  "best-solo": "Best solo",
  competitive: "Competitive",
  "pick-up-and-play": "Pick up and play",
  "great-on-handheld": "Great on handheld",
  "runs-well": "Runs well",
  buggy: "Buggy",
  "worth-full-price": "Worth full price",
  "wait-for-a-sale": "Wait for a sale",
  "kid-friendly": "Kid-friendly",
  accessible: "Accessible",
  "hidden-gem": "Hidden gem",
  masterpiece: "Masterpiece",
} as const;

export type PlayerTag = keyof typeof PLAYER_TAGS;

export const MAX_PLAYER_TAGS = 6;
export const MAX_CUSTOM_TAGS = 3;
export const CUSTOM_TAG_MAX = 32;

export function isPlayerTag(value: unknown): value is PlayerTag {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PLAYER_TAGS, value);
}

/** A custom tag as stored: trimmed, single-spaced, letters/digits/basic punctuation only. */
export function cleanCustomTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.normalize("NFKC").replace(/[^\p{L}\p{N} &'+.-]/gu, "").replace(/\s+/g, " ").trim().slice(0, CUSTOM_TAG_MAX);
  return tag.length >= 2 ? tag : null;
}

/** One reader's tags for one game, as validated input. */
export interface MyTags {
  tags: PlayerTag[];
  custom: string[];
}

export function parseMyTags(value: unknown): MyTags | null {
  const input = value as { tags?: unknown; custom?: unknown } | null;
  if (!input || !Array.isArray(input.tags) || (input.custom !== undefined && !Array.isArray(input.custom))) return null;
  const tags = [...new Set(input.tags.filter(isPlayerTag))];
  const custom = [...new Set(((input.custom as unknown[]) ?? []).map(cleanCustomTag).filter((tag): tag is string => tag !== null))];
  if (tags.length > MAX_PLAYER_TAGS || custom.length > MAX_CUSTOM_TAGS) return null;
  return { tags, custom };
}

/** Counts → the tags worth showing, most used first. Zero and unknown slugs are dropped. */
export function topPlayerTags(counts: Record<string, unknown> | null | undefined, limit = 12): Array<{ tag: PlayerTag; count: number }> {
  return Object.entries(counts ?? {})
    .filter((pair): pair is [PlayerTag, number] => isPlayerTag(pair[0]) && typeof pair[1] === "number" && pair[1] > 0)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || PLAYER_TAGS[a.tag].localeCompare(PLAYER_TAGS[b.tag]))
    .slice(0, limit);
}
