import { parseEvents, recordEvents, screenRequest } from "@/lib/analytics/server";
import { MAX_TRACK_BODY_BYTES } from "@/lib/analytics/types";

/**
 * First-party analytics ingest.
 *
 * Accepts `application/json` from fetch or `text/plain` from
 * `navigator.sendBeacon`, validates strictly, and answers 204 before the
 * insert runs. Every refusal that a well-behaved browser could trigger (bot,
 * DNT/GPC) is also a 204, so nothing about the response leaks which rule
 * applied or invites retries.
 */
export async function POST(request: Request) {
  const screening = screenRequest(request, { checkOrigin: true });
  if (!screening.ok) return empty(screening.status);

  // Cheap rejection first; the length check after reading covers clients
  // that omit or lie about Content-Length.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_TRACK_BODY_BYTES) return empty(413);

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType && !/^(application\/json|text\/plain)\b/i.test(contentType)) return empty(415);

  let body: string;
  try {
    body = await request.text();
  } catch {
    return empty(400);
  }
  if (body.length === 0 || new TextEncoder().encode(body).length > MAX_TRACK_BODY_BYTES) {
    return empty(body.length === 0 ? 400 : 413);
  }

  const rows = parseEvents(body, request.headers.get("host"));
  if (!rows) return empty(400);

  await recordEvents(rows, screening.country);
  return empty(204);
}

function empty(status: number) {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
