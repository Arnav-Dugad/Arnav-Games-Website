import { NextResponse } from "next/server";
import { getTrending } from "@/lib/games/source";
import type { SearchHit } from "@/lib/games/search";

/**
 * Suggestions for an empty search field: what is trending right now.
 *
 * The overlay is a client component mounted in the site chrome, so it can't
 * receive server data as props; this tiny endpoint hands it the same
 * trending list the homepage shows (IGDB's playing-now signal), shaped as
 * search hits so the overlay renders and previews them like any result.
 * Cached at the edge — it changes on the order of hours.
 */
export async function GET() {
  try {
    const { data, source } = await getTrending(8);
    const trending: SearchHit[] = data.map((game) => ({
      kind: "game",
      id: game.id,
      name: game.name,
      slug: game.slug,
      subtitle: game.genres.slice(0, 2).map((genre) => genre.name).join(" · ") || null,
      image: game.image,
      released: game.released,
      releaseWindow: game.releaseWindow,
      tba: game.tba,
    }));
    return NextResponse.json(
      { trending, source },
      { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" } },
    );
  } catch (err) {
    console.error("[search/suggest] failed", err);
    return NextResponse.json({ trending: [], source: "unavailable" });
  }
}
