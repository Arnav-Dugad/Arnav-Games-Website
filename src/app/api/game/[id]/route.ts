import { NextResponse } from "next/server";
import { getGame } from "@/lib/games/source";
import { igdbSlugForId } from "@/lib/games/providers/igdb-extras";

/**
 * The detail-page extras for one game as JSON: logo, palette, time to beat,
 * external ids, reference links, hype index, release history and the
 * per-region release rows.
 *
 * `[id]` is an IGDB numeric id, or a game slug (which is how Steam-only
 * titles, whose ids are appids, are addressed). Everything comes from the same
 * cached path the game page uses, so this costs no extra upstream requests.
 */

const NUMERIC = /^\d{1,10}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = decodeURIComponent(id).trim().toLowerCase();

  let slug: string | null = null;
  if (NUMERIC.test(raw)) slug = await igdbSlugForId(Number(raw));
  else if (SLUG.test(raw)) slug = raw;
  if (!slug) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=300" } });
  }

  try {
    const result = await getGame(slug);
    if (!result) {
      return NextResponse.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=300" } });
    }
    const game = result.data;
    return NextResponse.json(
      {
        id: game.id,
        slug: game.slug,
        name: game.name,
        source: result.source,
        steamAppId: game.steamAppId,
        logo: game.logo ?? null,
        palette: game.palette ?? null,
        timeToBeat: game.timeToBeat ?? null,
        externalIds: game.externalIds ?? null,
        links: game.links ?? null,
        hypeIndex: game.hypeIndex ?? null,
        releaseChanges: game.releaseChanges ?? [],
        released: game.released,
        releaseWindow: game.releaseWindow,
        tba: game.tba,
        releases: game.releases,
      },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (err) {
    console.error("[api/game] failed", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
