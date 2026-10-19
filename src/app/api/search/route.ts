import { NextResponse } from "next/server";
import { igdbConfigured, igdbSearchAll } from "@/lib/games/providers/igdb";
import { searchGames } from "@/lib/games/source";
import { recordSearch } from "@/lib/analytics/server";

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
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return NextResponse.json({ results: [], hits: [], source: "unavailable" });
  }

  const headers = {
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
  };

  try {
    if (igdbConfigured()) {
      const hits = await igdbSearchAll(query, { games: 18, franchises: 5, companies: 5 });
      if (hits.length > 0) {
        // Analytics only schedules a write after the response; it never
        // changes what is returned or how it's cached. Outages (the catch
        // below) are deliberately not logged as zero-result searches.
        await recordSearch(request, query, hits.length);
        return NextResponse.json({ hits, source: "igdb" }, { headers });
      }
    }

    // Either IGDB isn't configured or it genuinely found nothing; the chain
    // gives the honest answer either way.
    const { data, source } = await searchGames(query, 8);
    if (source !== "unavailable") await recordSearch(request, query, data.results.length);
    return NextResponse.json(
      {
        hits: data.results.map((game) => ({
          kind: "game" as const,
          id: game.id,
          name: game.name,
          slug: game.slug,
          subtitle: game.genres[0]?.name ?? null,
          image: game.image,
          released: game.released,
          releaseWindow: game.releaseWindow,
          tba: game.tba,
        })),
        source,
      },
      { headers },
    );
  } catch (err) {
    console.error("[api/search] failed", err);
    return NextResponse.json({ hits: [], source: "unavailable" }, { status: 200 });
  }
}
