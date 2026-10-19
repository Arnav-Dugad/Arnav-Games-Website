import { NextResponse } from "next/server";
import { extrasFor } from "@/lib/games/extras";
import { resolveMarketIds } from "@/lib/games/market";

/**
 * The game page's second part, as `GameExtras` — SteamSpy tags/owners,
 * PCGamingWiki features & accessibility, speedrun.com records, mods and the
 * credited people (Wikidata). Request it lazily, after `/insights`:
 *
 *   GET /api/game/119133/extras?steam=1245620&name=Elden%20Ring&slug=elden-ring
 *   GET /api/game/367520/extras?steam=367520&name=…        (Steam-only title)
 *
 * Same id/hint conventions as `/insights`; `slug` (the IGDB slug) and `name`
 * save an IGDB lookup when given. Each part is independent: a failed source
 * nulls its own field and is listed in `unavailable`.
 *
 * Outbound requests: ≤ ~15 with every cache cold, 0–2 warm (see `extras.ts`).
 * Everything upstream is cached for a day or more, so the browser may keep
 * the answer for an hour.
 */

const MAX_NAME = 120;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const ids = await resolveMarketIds(id, search);
  if (typeof ids === "string") {
    return NextResponse.json({ error: ids }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const clean = (value: string | null) => value?.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_NAME).trim() || null;
  const extras = await extrasFor(ids, { name: clean(search.get("name")), slug: clean(search.get("slug")) });
  return NextResponse.json(extras, {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
