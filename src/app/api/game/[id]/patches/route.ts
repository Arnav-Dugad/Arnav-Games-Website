import { NextResponse } from "next/server";
import { resolveMarketIds } from "@/lib/games/market";
import { steamPatchNotes } from "@/lib/games/patches";

/**
 * The latest Steam patch posts for one game, condensed, as `PatchNote[]`:
 *
 *   GET /api/game/119133/patches
 *   GET /api/game/367520/patches?steam=367520     (Steam-only title)
 *
 * Up to five posts, newest first. Bullets and headings are extracted from
 * the developer's own post — never written by us (see `patch-notes.ts`).
 * `[]` means Steam answered but nothing was a patch. 404 when the game has
 * no Steam app; 503 when Steam couldn't be reached (not cached for long).
 *
 * Outbound requests: 1 Steam (2 for a game with no announcements) + the
 * IGDB id lookup in `resolveMarketIds` (≤ 2 cold, 0 warm).
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
  const notes = await steamPatchNotes(ids.steam);
  if (!notes) {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "public, s-maxage=60" } });
  }
  return NextResponse.json(notes, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600" },
  });
}
