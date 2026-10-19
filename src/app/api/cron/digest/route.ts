import { runDigest } from "@/lib/analytics/digest";
import { getDb } from "@/lib/cloudflare/db";
import { isAuthorizedCron } from "@/server/cron-auth";

/**
 * Weekly owner digest, called by the Worker's cron trigger (worker.mjs,
 * Mondays 08:00 UTC) with `x-cron-secret: $CRON_SECRET`.
 *
 * In `next dev` a loopback request is allowed without the secret, so the
 * job can be exercised with a plain `curl -X POST localhost:4000/api/cron/digest`.
 */
export async function POST(request: Request) {
  if (!(await isAuthorizedCron(request))) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = await getDb();
  if (!db) return Response.json({ error: "storage-unavailable" }, { status: 503 });
  try {
    const digest = await runDigest(db, "scheduled");
    return Response.json(
      { ok: true, id: digest.id, delivery: digest.delivery, recipients: digest.recipients, error: digest.error },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[cron/digest] failed", err);
    return Response.json({ error: "digest-failed" }, { status: 500 });
  }
}
