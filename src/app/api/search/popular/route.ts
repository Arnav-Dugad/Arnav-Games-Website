import { NextResponse } from "next/server";
import { igdbSearchIndex } from "@/lib/games/providers/igdb";

/**
 * The instant-search index: about a thousand of the most-rated games, in a
 * compact shape the search palette matches on the device as you type.
 *
 * The palette keeps it for a day, so this is roughly one request per visitor
 * per day; the IGDB queries behind it are themselves cached for a day.
 */
export async function GET() {
  try {
    const games = await igdbSearchIndex();
    return NextResponse.json(
      { games },
      {
        headers: games.length
          ? { "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800" }
          : { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    console.error("[api/search/popular] failed", err);
    return NextResponse.json({ games: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
