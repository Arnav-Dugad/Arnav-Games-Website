import { NextResponse } from "next/server";
import { resolveMarketIds } from "@/lib/games/market";
import { reviewVelocityFor } from "@/lib/games/reviews";

/**
 * Steam review velocity from our hourly launch-window samples, as
 * `ReviewVelocity`:
 *
 *   GET /api/game/119133/reviews
 *   GET /api/game/367520/reviews?steam=367520     (Steam-only title)
 *
 * Only games sampled around their launch have points (the cron covers
 * tracked games from 2 days before release to 14 days after); otherwise
 * `points` is empty and every summary null. `first72h` is measured from
 * UTC midnight of Steam's release date. 404 when the game has no Steam app.
 *
 * Outbound requests: the IGDB id lookup (≤ 2 cold) and, when there are
 * samples, Steam's store record for the release date (shared daily cache).
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
  const velocity = await reviewVelocityFor(ids.steam);
  return NextResponse.json(velocity, {
    headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" },
  });
}
