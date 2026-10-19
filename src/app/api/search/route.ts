import { NextResponse } from "next/server";
import { igdbConfigured, igdbSearchAll } from "@/lib/games/providers/igdb";
import { searchGames } from "@/lib/games/source";
import { recordSearch } from "@/lib/analytics/server";
import { aliasHitFor, withAlias } from "@/lib/search/aliases";

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
 * An alias the owner approved on /admin ("botw") puts its game first, even
 * when the search itself found nothing (see lib/search/aliases.ts).
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
  // The admin "Search fixes" picker searches too; the owner hunting for a
  // game shouldn't show up as visitor demand. Spoofing this only un-counts
  // yourself, so it needs no auth.
  const log = request.headers.get("x-admin-search") === "1"
    ? async () => {}
    : (results: number) => recordSearch(request, query, results);

  try {
    // Cached in memory; resolves alongside the provider search, not before it.
    const aliasLookup = aliasHitFor(query);
    if (igdbConfigured()) {
      const [found, alias] = await Promise.all([
        igdbSearchAll(query, { games: 18, franchises: 5, companies: 5 }),
        aliasLookup,
      ]);
      const hits = withAlias(alias, found);
      if (hits.length > 0) {
        // Analytics only schedules a write after the response; it never
        // changes what is returned or how it's cached. Outages (the catch
        // below) are deliberately not logged as zero-result searches.
        await log(hits.length);
        return NextResponse.json({ hits, source: "igdb" }, { headers });
      }
    }

    // Either IGDB isn't configured or it genuinely found nothing; the chain
    // gives the honest answer either way.
    const [{ data, source }, alias] = await Promise.all([searchGames(query, 8), aliasLookup]);
    const hits = withAlias(
      alias,
      data.results.map((game) => ({
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
    );
    if (source !== "unavailable") await log(hits.length);
    return NextResponse.json({ hits, source }, { headers });
  } catch (err) {
    console.error("[api/search] failed", err);
    return NextResponse.json({ hits: [], source: "unavailable" }, { status: 200 });
  }
}
