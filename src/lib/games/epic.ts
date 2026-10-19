/**
 * Epic Games Store free games (current and announced), from Epic's public
 * `freeGamesPromotions` feed for the viewer's country. Each promotion is
 * matched to an IGDB game by exact title so the shelf can link into the
 * site; unmatched ones keep their Epic link and art.
 *
 * The feed is cached for 3 hours per country, but "free now" is re-decided
 * against the clock on every read, so a promotion that ended an hour ago is
 * never shown as live.
 *
 * Outbound (cold): Epic 1 + IGDB title match 1 + cards 2; 0 warm.
 */

import { unstable_cache } from "next/cache";
import { parseEpicPromotions, type EpicPromoRow } from "./external-rules";
import { politeJson } from "./polite";
import { igdbConfigured, listGamesByIds } from "./providers/igdb";
import { igdbIdsForTitles, normaliseStoreTitle } from "./providers/igdb-extras";
import type { EpicFreeGame, EpicFreeGames, GameSummary } from "./types";

const COUNTRY = /^[A-Z]{2}$/;

const cached = unstable_cache(
  async (cc: string): Promise<Array<EpicPromoRow & { game: GameSummary | null }>> => {
    const rows = parseEpicPromotions(
      await politeJson(`https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=${cc}&allowCountries=${cc}`, 6000),
      Date.now(),
    );
    let games = new Map<number, GameSummary>();
    let ids = new Map<string, number>();
    if (rows.length > 0 && igdbConfigured()) {
      ids = await igdbIdsForTitles(rows.map((row) => row.title));
      games = new Map((await listGamesByIds([...ids.values()])).map((game) => [game.id, game]));
    }
    return rows.map((row) => {
      const id = ids.get(normaliseStoreTitle(row.title));
      return { ...row, game: id ? games.get(id) ?? null : null };
    });
  },
  ["epic-free-v1"],
  { revalidate: 60 * 60 * 3, tags: ["epic"] },
);

/** Free-to-keep Epic games for a country; null when Epic can't be reached. */
export async function getEpicFreeGames(country: string): Promise<EpicFreeGames | null> {
  const cc = country.toUpperCase();
  if (!COUNTRY.test(cc)) return null;
  try {
    const rows = await cached(cc);
    const now = Date.now();
    const strip = (row: EpicPromoRow & { game: GameSummary | null }): EpicFreeGame => {
      const { when, ...game } = row;
      void when; // decided against the clock below instead
      return game;
    };
    const live = (row: EpicPromoRow) => Date.parse(row.start) <= now && now < Date.parse(row.end);
    return {
      country: cc,
      current: rows.filter(live).map(strip),
      upcoming: rows.filter((row) => Date.parse(row.start) > now).map(strip),
    };
  } catch (err) {
    console.warn("[epic] free games unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}
