import type { Metadata } from "next";
import { getMostAnticipated, getNewReleases, getUpcoming } from "@/lib/games/source";
import type { GameSummary } from "@/lib/games/types";
import { TodayView, type TodayGame } from "./TodayView";

// Request-time, like the homepage: "today" must never be baked in at build.
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Today",
  description: "Your next releases at a glance, and what's out today.",
};

/** Only what a row draws — the page is meant to load instantly from a home-screen shortcut. */
function slim(game: GameSummary): TodayGame {
  return {
    id: game.id,
    slug: game.slug,
    name: game.name,
    released: game.released,
    image: game.image,
    imageFallback: game.imageFallback,
    art: game.screenshots[0] ?? null,
    platforms: (game.parentPlatforms.length ? game.parentPlatforms : game.platforms).map((p) => ({ slug: p.slug })),
  };
}

/**
 * /today — the glanceable view behind the installed app's "Today" shortcut:
 * the next three releases that matter to you, and anything out today.
 *
 * The server sends a small pool of candidates (most anticipated, the notable
 * calendar, the last fortnight of releases). Everything personal — your
 * follows, your timezone's idea of "today" — is resolved on the device.
 */
export default async function TodayPage() {
  const [anticipated, upcoming, recent] = await Promise.all([
    getMostAnticipated(14),
    getUpcoming(40, 1, { notableOnly: true }),
    getNewReleases(14),
  ]);

  const pool = new Map<number, TodayGame>();
  for (const game of [...anticipated.data.map((entry) => entry.game), ...upcoming.data.results, ...recent.data]) {
    if (!pool.has(game.id)) pool.set(game.id, slim(game));
  }

  return (
    <TodayView
      pool={[...pool.values()]}
      anticipatedIds={anticipated.data.map((entry) => entry.game.id)}
      serverToday={new Date().toISOString().slice(0, 10)}
    />
  );
}
