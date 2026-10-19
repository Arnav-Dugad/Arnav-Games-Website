/**
 * Linux / Steam Deck anti-cheat status from AreWeAntiCheatYet's public
 * `games.json` (~470 KB, ~1.2k games). Same pattern as GeForce NOW: fetched
 * at most daily, reduced to a compact index inside `unstable_cache`, matched
 * by Steam appid then exact title. A game the list doesn't track gets `null`
 * — that's "no known anti-cheat problem recorded", not "no anti-cheat".
 */

import { unstable_cache } from "next/cache";
import { antiCheatFor, compactAntiCheat, type AntiCheatRow } from "./external-rules";
import { politeJson } from "./polite";
import type { AntiCheatStatus } from "./types";

const SOURCE = "https://raw.githubusercontent.com/AreWeAntiCheatYet/AreWeAntiCheatYet/master/games.json";

const cachedRows = unstable_cache(
  async (): Promise<AntiCheatRow[]> => {
    const rows = compactAntiCheat(await politeJson(SOURCE, 6000));
    if (rows.length < 100) throw new Error("anticheat: list looks truncated");
    return rows;
  },
  ["anticheat-v1"],
  { revalidate: 60 * 60 * 24, tags: ["anticheat"] },
);

/**
 * `undefined` when the list couldn't be read (the caller reports it as
 * unavailable), `null` when the game isn't tracked. 1 request cold, 0 warm.
 */
export async function antiCheatStatus(game: { steam: number | null; name: string | null }): Promise<AntiCheatStatus | null | undefined> {
  if (!game.steam && !game.name) return null;
  try {
    return antiCheatFor(await cachedRows(), game);
  } catch (err) {
    console.warn("[anticheat] unavailable:", err instanceof Error ? err.message : err);
    return undefined;
  }
}
