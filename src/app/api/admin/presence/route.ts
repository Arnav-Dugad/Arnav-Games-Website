import { verifyAdmin } from "@/lib/analytics/admin-auth";
import { presenceRoom } from "@/lib/analytics/runtime";
import type { PresenceSnapshot } from "@/lib/analytics/types";

/**
 * Live visitor count and the pages they're on, for the dashboard's "Online
 * now" tile (polled every 10s while visible). Admin-only; never cached.
 */
const NO_STORE = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Robots-Tag": "noindex",
};

export async function GET(request: Request) {
  const auth = await verifyAdmin(request);
  if (!auth.ok) return Response.json({ error: auth.reason }, { status: auth.status, headers: NO_STORE });

  const room = await presenceRoom();
  if (!room) {
    const body: PresenceSnapshot = { online: null, available: false, pages: [], updatedAt: Date.now() };
    return Response.json(body, { headers: NO_STORE });
  }

  try {
    const response = await room.fetch("https://presence/snapshot");
    if (!response.ok) throw new Error(`presence ${response.status}`);
    const snapshot = (await response.json()) as Omit<PresenceSnapshot, "available">;
    const body: PresenceSnapshot = { ...snapshot, available: true };
    return Response.json(body, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/presence] snapshot failed", err);
    return Response.json({ error: "presence-unreachable" }, { status: 502, headers: NO_STORE });
  }
}
