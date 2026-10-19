import { releaseState } from "@/lib/games/release-state";
import type { WatchlistEntry } from "@/lib/firebase/db";

/**
 * The reader's playable backlog: owned-but-not-started, or explicitly
 * "Want to play" — and out today, because you can't start a game that
 * doesn't exist yet. Shared by the roulette and the Game Pass shelf so both
 * answer "what could I play next?" from the same pile.
 */
export function isBacklog(entry: WatchlistEntry): boolean {
  if (releaseState(entry) === "upcoming") return false;
  const owned = (entry.ownedOn ?? []).length > 0;
  return entry.status === "want" || (owned && entry.status === "none");
}
