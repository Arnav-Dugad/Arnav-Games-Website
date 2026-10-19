import { NextResponse } from "next/server";
import { liveDataFor } from "@/lib/games/live";
import { marketFor, resolveMarketIds } from "@/lib/games/market";
import { pcInfoFor } from "@/lib/games/pc";
import { steamPatchNotes } from "@/lib/games/patches";
import { twitchIdFor } from "@/lib/games/twitch-history";
import type { GameInsights } from "@/lib/games/types";

/**
 * Everything the game page needs from the server after first paint, in ONE
 * Worker request (it used to be eight: /live, /market, /players, /pc,
 * /patches, /reviews, /twitch, /scores). Our own history series aren't here
 * at all — the browser reads them straight from Firestore.
 *
 *   GET /api/game/119133/insights?cc=IN&steam=1245620&twitch=512953&name=Elden%20Ring
 *   GET /api/game/367520/insights?cc=GB&steam=367520&name=…     (Steam-only title)
 *
 * `[id]` is the IGDB id, with the same optional `steam` / `ms` / `twitch`
 * hints as `/live` and `/market` (validated; only ever used to build URLs on
 * fixed hosts). `cc` is the price country (ISO 3166-1 alpha-2, default US).
 * The regional price comparison stays opt-in on `/market?regional=1`, and
 * live refreshes poll the lighter `/live`.
 *
 * Outbound requests (Workers Free allows 50 per invocation), all caches cold:
 * IGDB ids ≤ 2, Twitch category lookup ≤ 1 (only when IGDB has no link),
 * live ≤ 15 (Steam players/reviews/news ≤ 4, Twitch ≤ 4, CheapShark ≤ 4,
 * Game Pass ≤ 3), market ≤ 6 (Steam + Microsoft prices, the free check, the
 * Firestore history read and, after the response, at most one Firestore
 * commit), PC ≤ 4, patches ≤ 2 — about 30 at worst, 3–6 warm.
 */

const COUNTRY = /^[A-Z]{2}$/;
const MAX_NAME = 120;

const badRequest = (error: string) =>
  NextResponse.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;

  const cc = (search.get("cc")?.trim() || "US").toUpperCase();
  if (!COUNTRY.test(cc) || cc === "XX" || cc === "T1") return badRequest("cc must be an ISO 3166-1 alpha-2 country");
  const nameRaw = search.get("name")?.trim() || null;
  const name = nameRaw ? nameRaw.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_NAME).trim() || null : null;

  const ids = await resolveMarketIds(id, search);
  if (typeof ids === "string") return badRequest(ids);
  // IGDB doesn't link every game to Twitch; Twitch's own mapping fills in (cached a day).
  const twitch = ids.twitch ?? (ids.igdbId ? await twitchIdFor(ids.igdbId).catch(() => null) : null);

  const unavailable: GameInsights["unavailable"] = [];
  const [live, market, pc, patches] = await Promise.all([
    liveDataFor({ igdbId: ids.igdbId, steam: ids.steam, twitch, microsoft: ids.microsoft, name }),
    ids.steam || ids.microsoft
      ? marketFor({ ...ids, twitch }, cc, { regional: false }).catch((err: unknown) => {
          console.error("[api/insights] market failed", err);
          unavailable.push("market");
          return null;
        })
      : null,
    ids.steam
      ? pcInfoFor(ids.steam).catch(() => {
          unavailable.push("pc");
          return null;
        })
      : null,
    ids.steam
      ? steamPatchNotes(ids.steam).then((notes) => {
          if (notes === null) unavailable.push("patches");
          return notes;
        })
      : null,
  ]);

  const body: GameInsights = {
    ids: { key: ids.key, igdbId: ids.igdbId, steam: ids.steam, microsoft: ids.microsoft, twitch },
    live,
    market,
    pc,
    patches,
    unavailable,
  };
  return NextResponse.json(body, {
    headers: {
      // `max-age` lets the browser reuse the answer on back/forward and quick
      // reloads without another Worker request. (On workers.dev Cloudflare
      // doesn't edge-cache Worker responses, so `s-maxage` only matters if a
      // custom domain with a cache rule is ever put in front.)
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
