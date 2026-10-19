import { cleanPath, screenRequest } from "@/lib/analytics/server";
import { parseBeat } from "@/lib/analytics/presence";
import { presenceRoom } from "@/lib/analytics/runtime";
import { runAfterResponse } from "@/lib/cloudflare/db";

/**
 * Heartbeats for the live "online now" counter (see presence-client.ts).
 *
 * Same screening as `/api/track` (bots, DNT/GPC, foreign origins), then the
 * beat is handed to the PresenceRoom Durable Object after the response, so a
 * heartbeat costs the visitor one tiny 204. Where Durable Objects don't run
 * (`next dev`), it answers `{ available: false }` once and the tab stops.
 */
const MAX_BODY_BYTES = 512;

export async function POST(request: Request) {
  const screening = screenRequest(request, { checkOrigin: true });
  if (!screening.ok) return empty(screening.status);

  let body: string;
  try {
    body = await request.text();
  } catch {
    return empty(400);
  }
  if (!body || body.length > MAX_BODY_BYTES) return empty(400);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return empty(400);
  }
  const beat = parseBeat(parsed);
  if (!beat) return empty(400);
  if (!beat.leave) {
    // Same normalisation as pageviews, so live pages and top pages agree.
    const path = cleanPath(beat.path);
    if (!path) return empty(400);
    beat.path = path;
  }

  const room = await presenceRoom();
  if (!room) {
    return Response.json({ available: false }, { headers: { "Cache-Control": "no-store" } });
  }

  await runAfterResponse(
    room
      .fetch("https://presence/beat", {
        method: "POST",
        body: JSON.stringify(beat),
        headers: { "Content-Type": "application/json" },
      })
      .catch((err: unknown) => console.warn("[presence] beat failed", err)),
  );
  return empty(204);
}

function empty(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}
