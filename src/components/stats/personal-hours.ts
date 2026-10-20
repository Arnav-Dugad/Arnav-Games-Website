import type { TimeToBeatLike } from "@/lib/games/stats";
import type { PersonalHours } from "./StatsDashboard";

/**
 * The reader's logged hours, summarised for /stats: the total, and how
 * their pace compares with the crowd's — logged hours over typical length
 * on *finished* games that have both (an unfinished game's hours aren't a
 * pace yet). Null when nothing is logged.
 */
export function personalHours(
  entries: Array<{ gameId: number; status: string }>,
  timeToBeat: Record<number, TimeToBeatLike> | null,
  playtime: Record<number, number>,
): PersonalHours | null {
  const logged = Object.values(playtime).reduce((sum, hours) => sum + hours, 0);
  const games = Object.keys(playtime).length;
  if (logged <= 0) return null;
  let mine = 0;
  let typical = 0;
  let pairs = 0;
  for (const entry of entries) {
    const hours = playtime[entry.gameId];
    const ttb = timeToBeat?.[entry.gameId];
    const length = ttb?.normally ?? ttb?.hastily ?? null;
    if (entry.status !== "played" || !hours || !length) continue;
    mine += hours;
    typical += length;
    pairs++;
  }
  return { logged: Math.round(logged), games, paceRatio: pairs >= 2 ? Math.round((mine / typical) * 10) / 10 : null };
}
