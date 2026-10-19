import { verifyAdmin } from "@/lib/analytics/admin-auth";
import { computeStats } from "@/lib/analytics/stats";
import { isStatsRange } from "@/lib/analytics/types";
import { getDb } from "@/lib/cloudflare/db";

/**
 * Aggregated analytics for the private `/admin` dashboard.
 *
 * Requires `Authorization: Bearer <Firebase ID token>` for an allow-listed,
 * verified email (see `lib/analytics/admin-auth.ts`). Every response —
 * success or refusal — is `private, no-store`: these numbers must never land
 * in a shared cache, and a cached 403 would lock the owner out after sign-in.
 */
const NO_STORE = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Robots-Tag": "noindex",
};

export async function GET(request: Request) {
  const auth = await verifyAdmin(request);
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: NO_STORE });
  }

  const rangeParam = new URL(request.url).searchParams.get("range") ?? "7d";
  if (!isStatsRange(rangeParam)) {
    return Response.json({ error: "bad-range" }, { status: 400, headers: NO_STORE });
  }

  const db = await getDb();
  if (!db) {
    return Response.json({ error: "storage-unavailable" }, { status: 503, headers: NO_STORE });
  }

  try {
    const stats = await computeStats(db, rangeParam);
    return Response.json(stats, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/stats] query failed", err);
    return Response.json({ error: "query-failed" }, { status: 500, headers: NO_STORE });
  }
}
