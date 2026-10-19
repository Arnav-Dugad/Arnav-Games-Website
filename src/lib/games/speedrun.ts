/**
 * World records from speedrun.com's public API: the game is found by exact
 * name, then one `records` call returns the #1 run of every full-game
 * category with runners embedded. 2 requests cold, cached a day per title
 * (records change rarely, and the API asks for gentle use).
 */

import { unstable_cache } from "next/cache";
import { normaliseTitle, parseSpeedrunRecords, pickSpeedrunGame } from "./external-rules";
import { politeJson } from "./polite";
import type { SpeedrunRecords } from "./types";

const API = "https://www.speedrun.com/api/v1";

const cached = unstable_cache(
  async (name: string): Promise<SpeedrunRecords | null> => {
    const game = pickSpeedrunGame(await politeJson(`${API}/games?name=${encodeURIComponent(name)}&max=10`, 5000), name);
    if (!game || !/^[a-z0-9]{1,16}$/i.test(game.id)) return null;
    const records = parseSpeedrunRecords(
      await politeJson(`${API}/games/${game.id}/records?top=1&scope=full-game&skip-empty=true&embed=players,category&max=20`, 6000),
    );
    return records.length > 0 ? { game, records } : null;
  },
  ["speedrun-records-v1"],
  { revalidate: 60 * 60 * 24, tags: ["speedrun"] },
);

/** Null when nobody runs it (or the name has no exact match); undefined when the API failed. */
export async function speedrunRecords(name: string | null): Promise<SpeedrunRecords | null | undefined> {
  const clean = name?.trim().slice(0, 120) ?? "";
  if (!normaliseTitle(clean)) return null;
  try {
    return await cached(clean);
  } catch (err) {
    console.warn("[speedrun] failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}
