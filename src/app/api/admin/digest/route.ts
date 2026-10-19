import { verifyAdmin } from "@/lib/analytics/admin-auth";
import { latestDigest, runDigest, secondsSinceLastTest } from "@/lib/analytics/digest";
import { readEnv } from "@/lib/analytics/runtime";
import { getDb } from "@/lib/cloudflare/db";

/**
 * The weekly digest panel on /admin.
 *
 *   GET  → `{ latest, emailConfigured }`
 *   POST → builds last week's digest now ("Send test now"), emails it when
 *          `RESEND_API_KEY` is set, stores it; once per two minutes.
 */
const NO_STORE = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Robots-Tag": "noindex",
};
const TEST_COOLDOWN_SECONDS = 120;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...extra } });

export async function GET(request: Request) {
  const auth = await verifyAdmin(request);
  if (!auth.ok) return json({ error: auth.reason }, auth.status);
  const db = await getDb();
  if (!db) return json({ error: "storage-unavailable" }, 503);
  try {
    return json({ latest: await latestDigest(db), emailConfigured: Boolean(await readEnv("RESEND_API_KEY")) });
  } catch (err) {
    console.error("[api/admin/digest] GET failed", err);
    return json({ error: "query-failed" }, 500);
  }
}

export async function POST(request: Request) {
  const auth = await verifyAdmin(request);
  if (!auth.ok) return json({ error: auth.reason }, auth.status);
  const db = await getDb();
  if (!db) return json({ error: "storage-unavailable" }, 503);
  try {
    // Rate-limited in D1, not memory, so it holds across isolates.
    const since = await secondsSinceLastTest(db);
    if (since !== null && since < TEST_COOLDOWN_SECONDS) {
      const wait = TEST_COOLDOWN_SECONDS - since;
      return json({ error: "rate-limited", retryAfter: wait }, 429, { "Retry-After": String(wait) });
    }
    const digest = await runDigest(db, "test");
    return json({ latest: digest, emailConfigured: Boolean(await readEnv("RESEND_API_KEY")) });
  } catch (err) {
    console.error("[api/admin/digest] POST failed", err);
    return json({ error: "digest-failed" }, 500);
  }
}
