import { verifyAdmin } from "@/lib/analytics/admin-auth";
import {
  approveAlias,
  cleanGame,
  listFixes,
  setAliasStatus,
  storeCandidates,
  storedCandidates,
  syncSuggestions,
} from "@/lib/analytics/search-fixes";
import { normaliseQuery } from "@/lib/analytics/server";
import { getDb } from "@/lib/cloudflare/db";
import { proposeCandidates } from "@/lib/search/alias-suggest";
import { invalidateAliasCache } from "@/lib/search/aliases";

/**
 * Search-alias autopilot for /admin.
 *
 *   GET                       → `{ suggestions, approved, dismissed }`
 *   GET  ?candidates=<alias>  → `{ alias, candidates }` (IGDB, cached in D1 for a week)
 *   POST { action: "approve", alias, game } | { action: "dismiss" | "restore", alias }
 *
 * Every method verifies the admin token; nothing is cacheable.
 */
const NO_STORE = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Robots-Tag": "noindex",
};
const CANDIDATES_TTL_SECONDS = 7 * 86_400;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

function cleanAlias(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const alias = normaliseQuery(value);
  return alias.length >= 2 ? alias : null;
}

export async function GET(request: Request) {
  const auth = await verifyAdmin(request);
  if (!auth.ok) return json({ error: auth.reason }, auth.status);
  const db = await getDb();
  if (!db) return json({ error: "storage-unavailable" }, 503);

  const url = new URL(request.url);
  const candidatesFor = url.searchParams.get("candidates");
  try {
    if (candidatesFor !== null) {
      const alias = cleanAlias(candidatesFor);
      if (!alias) return json({ error: "bad-alias" }, 400);
      const stored = await storedCandidates(db, alias);
      const fresh = stored?.at != null && Date.now() / 1000 - stored.at < CANDIDATES_TTL_SECONDS;
      if (stored?.candidates && fresh && stored.candidates.length > 0) return json({ alias, candidates: stored.candidates });
      const candidates = await proposeCandidates(alias);
      if (stored) await storeCandidates(db, alias, candidates);
      return json({ alias, candidates });
    }

    await syncSuggestions(db);
    return json(await listFixes(db));
  } catch (err) {
    console.error("[api/admin/search-fixes] GET failed", err);
    return json({ error: "query-failed" }, 500);
  }
}

export async function POST(request: Request) {
  const auth = await verifyAdmin(request);
  if (!auth.ok) return json({ error: auth.reason }, auth.status);
  const db = await getDb();
  if (!db) return json({ error: "storage-unavailable" }, 503);

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 4096) return json({ error: "too-large" }, 413);
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ error: "bad-json" }, 400);
  }
  const alias = cleanAlias(body?.alias);
  if (!alias) return json({ error: "bad-alias" }, 400);

  try {
    switch (body.action) {
      case "approve": {
        const game = cleanGame(body.game);
        if (!game) return json({ error: "bad-game" }, 400);
        await approveAlias(db, alias, game);
        break;
      }
      case "dismiss":
        await setAliasStatus(db, alias, "dismissed");
        break;
      case "restore":
        await setAliasStatus(db, alias, "suggested");
        break;
      default:
        return json({ error: "bad-action" }, 400);
    }
  } catch (err) {
    console.error("[api/admin/search-fixes] POST failed", err);
    return json({ error: "query-failed" }, 500);
  }
  // Only this isolate; others pick the change up within their 5-minute TTL.
  invalidateAliasCache();
  return json({ ok: true });
}
