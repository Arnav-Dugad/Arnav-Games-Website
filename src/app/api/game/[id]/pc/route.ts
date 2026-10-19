import { NextResponse } from "next/server";
import { resolveMarketIds } from "@/lib/games/market";
import { pcInfoFor } from "@/lib/games/pc";

/**
 * Steam Deck rating, ProtonDB tier and achievement rarity, as `GamePcInfo`:
 *
 *   GET /api/game/119133/pc
 *   GET /api/game/367520/pc?steam=367520     (Steam-only title)
 *
 * Each field is null when its source has nothing for the game. 404 when the
 * game has no Steam app (everything here is keyed on it).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ids = await resolveMarketIds(id, new URL(request.url).searchParams);
  if (typeof ids === "string") {
    return NextResponse.json({ error: ids }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!ids.steam) {
    return NextResponse.json({ error: "no steam app" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=3600" } });
  }
  const info = await pcInfoFor(ids.steam);
  return NextResponse.json(info, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
