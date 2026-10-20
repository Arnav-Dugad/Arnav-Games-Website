/**
 * Steam's most-used player tags, in Steam's own order of popularity, for the
 * "Popular tags" tiles on /genres. One small request (Steam's tag list),
 * cached for a week.
 *
 * Tags that merely restate a genre or a format (Action, RPG, 2D, Early
 * Access…) are dropped: the genre tiles above already cover them, and the
 * point of this row is the *feel* of games — Cozy, Story Rich, Roguelike.
 */

import { unstable_cache } from "next/cache";
import { politeJson } from "./polite";

const URL = "https://store.steampowered.com/tagdata/populartags/english";
const WEEK = 60 * 60 * 24 * 7;

const NOT_A_FEEL = new Set([
  "indie", "action", "adventure", "casual", "singleplayer", "simulation", "rpg", "strategy", "2d", "3d",
  "early access", "free to play", "controller", "puzzle", "sports", "arcade", "shooter", "action-adventure",
  "massively multiplayer", "violent", "combat", "stylized", "colorful", "first-person", "third person", "top-down",
  "pve", "pvp", "multiplayer", "racing", "gore", "nudity", "sexual content", "mature", "great soundtrack",
  "realistic", "physics", "music", "design & illustration", "utilities", "software", "education", "action rpg",
  "platformer", "fps", "point & click", "visual novel", "turn-based strategy",
]);

const cached = unstable_cache(
  async (): Promise<string[]> => {
    const list = await politeJson<Array<{ tagid?: number; name?: string }>>(URL, 6000);
    const names = (Array.isArray(list) ? list : [])
      .map((tag) => tag?.name?.trim())
      .filter((name): name is string => Boolean(name) && name!.length <= 30 && !NOT_A_FEEL.has(name!.toLowerCase()));
    if (names.length === 0) throw new Error("steam tags: empty");
    return names.slice(0, 40);
  },
  ["steam-popular-tags-v1"],
  { revalidate: WEEK, tags: ["steam-tags"] },
);

/** Steam's popular descriptive tags, most used first. Empty on failure. */
export async function popularSteamTags(limit = 16): Promise<string[]> {
  try {
    return (await cached()).slice(0, limit);
  } catch (err) {
    console.warn("[steam-tags] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
