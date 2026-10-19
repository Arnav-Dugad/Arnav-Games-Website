import { NextResponse } from "next/server";
import { scoreTimelineFor } from "@/lib/games/scores";

/**
 * Our daily observations of IGDB's critic aggregate for one game, as
 * `ScoreTimeline`:
 *
 *   GET /api/game/119133/scores
 *
 * `[id]` is the IGDB id (Steam-only titles have no IGDB aggregate). The cron
 * observes tracked games for 120 days after release, so older games have no
 * points unless we were tracking them at launch. D1 only — no outbound
 * requests.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id) || Number(id) <= 0) {
    return NextResponse.json({ error: "id must be a numeric IGDB id" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const timeline = await scoreTimelineFor(Number(id));
  return NextResponse.json(timeline, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
