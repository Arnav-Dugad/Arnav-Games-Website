import { NextResponse } from "next/server";
import { resolveMarketIds } from "@/lib/games/market";
import { playerHistoryFor } from "@/lib/games/players";

/**
 * Our hourly Steam concurrent-player history for one game, as `PlayerHistory`:
 *
 *   GET /api/game/119133/players
 *   GET /api/game/367520/players?steam=367520     (Steam-only title)
 *
 * Hourly points for the last 7 days, 6-hour means before that (up to 120
 * days). An empty `points` array means we haven't sampled it yet — the game
 * joins the hourly cron once its page has been viewed. 404 when the game has
 * no Steam app at all.
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
  const history = await playerHistoryFor(ids.steam);
  return NextResponse.json(history, {
    headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" },
  });
}
