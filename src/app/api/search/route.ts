import { NextResponse } from "next/server";
import { igdbConfigured, igdbSearchAll } from "@/lib/games/providers/igdb";
import { searchGames } from "@/lib/games/source";

/**
 * Search endpoint for the command palette.
 *
 * Exists so provider credentials stay server-side — the palette is a client
 * component and must not hold them. Responses are cached briefly at the edge:
 * repeated keystrokes across users hit the same popular prefixes constantly.
 *
 * One relevance-ranked game request plus one IGDB Multi-Query covers
 * franchises, studios, characters, genres and platforms. Without IGDB it
 * falls back to the provider chain's game search, which is all Steam can offer.
 *
 * Shorthand like "botw" or "rdr2" is expanded by the search itself (see
 * `searchQueryVariants` in lib/games/fuzzy-search.ts).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Case never changes the answer; one spelling means one cached upstream query.
  const query = searchParams.get("q")?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";

  if (query.length < 2) {
    return NextResponse.json({ results: [], hits: [], source: "unavailable" });
  }

  const headers = {
    "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
  };
  try {
    if (igdbConfigured()) {
      const hits = await igdbSearchAll(query, { games: 18, franchises: 5, companies: 5 });
      if (hits.length > 0) return NextResponse.json({ hits, source: "igdb" }, { headers });
    }

    // Either IGDB isn't configured or it genuinely found nothing; the chain
    // gives the honest answer either way.
    const { data, source } = await searchGames(query, 8);
    const hits = data.results.map((game) => ({
      kind: "game" as const,
      id: game.id,
      name: game.name,
      slug: game.slug,
      subtitle: game.genres[0]?.name ?? null,
      image: game.image,
      released: game.released,
      releaseWindow: game.releaseWindow,
      tba: game.tba,
    }));
    return NextResponse.json({ hits, source }, { headers });
  } catch (err) {
    console.error("[api/search] failed", err);
    // A failure is not "no results": the palette retries and says so.
    return NextResponse.json(
      { hits: [], source: "unavailable", error: true },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
