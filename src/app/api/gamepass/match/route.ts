import { NextResponse } from "next/server";
import { GAME_PASS_MATCH_MAX, gamePassMatches } from "@/lib/games/gamepass";

/**
 * Which of a set of games are on Xbox Game Pass, as `GamePassMatches`:
 *
 *   POST /api/gamepass/match   { "ids": [119133, 25076, 7346] }
 *
 * `ids` are IGDB ids (non-positive ids are ignored — Steam-only titles have
 * no Microsoft listing to match), at most 300. Only games found on some list
 * are keys in the result; an absent id means "not found", which for a game
 * without a Microsoft BigId in IGDB is not proof it isn't on Game Pass.
 * 503 when Microsoft's catalogue is unreachable.
 *
 * Outbound requests (cold) ≤ ~20, warm ≈ 0 — see `gamePassMatches`.
 */

const bad = (error: string) => NextResponse.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("body must be JSON");
  }
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids)) return bad("ids must be an array");
  if (ids.length > GAME_PASS_MATCH_MAX) return bad(`at most ${GAME_PASS_MATCH_MAX} ids`);
  if (!ids.every((id) => typeof id === "number" && Number.isInteger(id))) return bad("ids must be integers");

  const matches = await gamePassMatches(ids as number[]);
  if (!matches) {
    return NextResponse.json({ error: "game pass catalogue unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(matches, { headers: { "Cache-Control": "private, max-age=1800" } });
}
