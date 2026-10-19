import { NextResponse } from "next/server";
import { resolveMarketIds } from "@/lib/games/market";
import { twitchHistoryFor, twitchIdFor } from "@/lib/games/twitch-history";

/**
 * Our Twitch viewership history for one game, as `TwitchHistory`:
 *
 *   GET /api/game/119133/twitch
 *
 * Each point is the summed viewers (and stream count) of the category's top
 * 100 live streams at sampling time — Helix publishes no category total, so
 * for the very biggest games this is a slight undercount, never inflated.
 * Hourly points for 7 days, 6-hour means before that (up to 120 days).
 * Empty `points` until the cron has sampled it; 404 when the game has no
 * Twitch category we know of (Steam-only titles usually don't).
 *
 * Outbound requests: the IGDB id lookup (≤ 2 cold, 0 warm).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ids = await resolveMarketIds(id, new URL(request.url).searchParams);
  if (typeof ids === "string") {
    return NextResponse.json({ error: ids }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const twitchId = await twitchIdFor(ids.key, ids.igdbId);
  if (!twitchId) {
    return NextResponse.json({ error: "no twitch category" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=3600" } });
  }
  const history = await twitchHistoryFor(twitchId);
  return NextResponse.json(history, {
    headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" },
  });
}
