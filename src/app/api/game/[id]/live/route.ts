import { NextResponse } from "next/server";
import { externalIdsFor } from "@/lib/games/providers/igdb-extras";
import { liveDataFor, type LiveIds } from "@/lib/games/live";

/**
 * Live, fast-moving data for one game: Steam players/reviews/news, Twitch
 * activity, store deals and Game Pass membership. Fetched client-side so the
 * game page itself stays fully cacheable.
 *
 *   GET /api/game/119133/live?steam=1245620&twitch=512953&ms=9P3J32CTXLRZ&name=Elden%20Ring
 *
 * `[id]` is the IGDB id. The query ids are optional hints; whatever is missing
 * is resolved from IGDB's `external_games`. Every parameter is validated
 * against a strict pattern and only ever used to build URLs on fixed hosts —
 * nothing here can be steered at an arbitrary URL.
 */

const DIGITS = (max: number) => new RegExp(`^\\d{1,${max}}$`);
const IGDB_ID = DIGITS(10);
const STEAM_ID = DIGITS(10);
const TWITCH_ID = DIGITS(12);
const BIG_ID = /^[0-9A-Z]{12}$/;
const MAX_NAME = 120;

const badRequest = (error: string) =>
  NextResponse.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IGDB_ID.test(id) || Number(id) <= 0) return badRequest("id must be a numeric IGDB id");

  const search = new URL(request.url).searchParams;
  const read = (key: string) => search.get(key)?.trim() || null;

  const steamRaw = read("steam");
  const twitchRaw = read("twitch");
  const msRaw = read("ms")?.toUpperCase() ?? null;
  const nameRaw = read("name");

  if (steamRaw && (!STEAM_ID.test(steamRaw) || Number(steamRaw) <= 0)) return badRequest("invalid steam id");
  if (twitchRaw && !TWITCH_ID.test(twitchRaw)) return badRequest("invalid twitch id");
  if (msRaw && !BIG_ID.test(msRaw)) return badRequest("invalid ms id");
  const name = nameRaw ? nameRaw.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_NAME).trim() || null : null;

  const ids: LiveIds = {
    igdbId: Number(id),
    steam: steamRaw ? Number(steamRaw) : null,
    twitch: twitchRaw,
    microsoft: msRaw,
    name,
  };

  if (!ids.steam || !ids.twitch || !ids.microsoft) {
    const resolved = (await externalIdsFor([ids.igdbId!])).get(ids.igdbId!);
    // A steam hint that disagrees with IGDB means `[id]` isn't the IGDB record
    // for this game (a Steam-only title's id is its appid). Trust the hint and
    // ignore the rest of the unrelated record.
    const unrelated = Boolean(ids.steam && resolved?.steam && resolved.steam !== ids.steam);
    if (resolved && !unrelated) {
      ids.steam ??= resolved.steam;
      ids.twitch ??= resolved.twitch;
      ids.microsoft ??= resolved.microsoft;
    }
    if (unrelated) ids.igdbId = null;
  }

  const data = await liveDataFor(ids);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" },
  });
}
