import { NextResponse } from "next/server";
import { geForceNowMatches } from "@/lib/games/cloud";
import { GAME_PASS_MATCH_MAX, gamePassMatches } from "@/lib/games/gamepass";
import type { CloudMatchResponse, CloudMatches } from "@/lib/games/types";

/**
 * Which of a set of games can be played "in the cloud or on a subscription",
 * as `CloudMatchResponse` — Xbox Game Pass and NVIDIA GeForce NOW together,
 * for the library's "Playable in the cloud" section and card badges:
 *
 *   POST /api/cloud/match   { "ids": [119133, 25076, 7346] }
 *   → { "matches": { "25076": { "gamePass": null, "geforceNow": { "available": true, "store": "Steam", … } } },
 *       "unavailable": [] }
 *
 * `ids` are IGDB ids (≤ 300; non-positive ids are ignored). Only games found
 * on either service are keys. Within an entry, `gamePass` / `geforceNow` is
 * null when that service doesn't list the game *or* its catalogue couldn't
 * be read; `unavailable` in the envelope says which catalogue failed. 503
 * only when both did.
 *
 * Outbound (cold): Game Pass ≤ ~20 (see `gamePassMatches`), GeForce NOW
 * catalogue 1 + IGDB names ≤ 1; the IGDB external-id lookup is shared.
 * Warm ≈ 0–2.
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

  const [gamePass, gfn] = await Promise.all([
    gamePassMatches(ids as number[]).catch(() => null),
    geForceNowMatches(ids as number[]).catch(() => null),
  ]);
  if (!gamePass && !gfn) {
    return NextResponse.json({ error: "catalogues unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const matches: CloudMatches = {};
  for (const [key, match] of Object.entries(gamePass ?? {})) matches[key] = { gamePass: match, geforceNow: null };
  for (const [id, membership] of gfn ?? new Map()) {
    const key = String(id);
    matches[key] = { gamePass: matches[key]?.gamePass ?? null, geforceNow: membership };
  }
  const unavailable: CloudMatchResponse["unavailable"] = [...(gamePass ? [] : ["gamePass" as const]), ...(gfn ? [] : ["geforceNow" as const])];
  return NextResponse.json(
    { matches, unavailable } satisfies CloudMatchResponse,
    { headers: { "Cache-Control": "private, max-age=1800" } },
  );
}
