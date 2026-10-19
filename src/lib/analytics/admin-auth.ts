/**
 * Admin authorisation for the analytics dashboard.
 *
 * Verifies a Firebase ID token on Workers with `jose` — the Firebase Admin
 * SDK needs Node APIs Workers don't have. The checks mirror Firebase's own
 * "verify ID tokens using a third-party JWT library" recipe: RS256 signed by
 * Google's securetoken keys, issuer and audience bound to our project, not
 * expired, issued in the past, with a subject.
 *
 * Authorisation is either the `admin` custom claim on the account (set by
 * the owner via the Firebase Admin API, see `verifyAdmin`), or an email
 * allow-list (`ADMIN_EMAILS`) — the latter only for a *verified* email:
 * anyone can create an email/password account claiming the owner's address,
 * but they can't verify it.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AdminDenial } from "./types";

/** Used when `ADMIN_EMAILS` isn't set. Comma-separated, case-insensitive. */
const DEFAULT_ADMIN_EMAILS = "arnavrival12@gmail.com,arnavrival16@gmail.com";

/*
 * Module scope so the key set (and its HTTP cache headers) survives across
 * requests within an isolate. jose refetches on an unknown `kid`, which is
 * how Google's key rotation is picked up.
 */
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export type AdminCheck =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 503; reason: AdminDenial };

/** The allow-list, lowercased. Also the weekly digest's recipients. */
export async function adminEmails(): Promise<Set<string>> {
  let raw = process.env.ADMIN_EMAILS;
  if (!raw) {
    // On Workers, vars/secrets live on the binding env; OpenNext mirrors most
    // into process.env, but don't depend on it.
    try {
      const { env } = await getCloudflareContext({ async: true });
      raw = (env as unknown as { ADMIN_EMAILS?: string }).ADMIN_EMAILS;
    } catch {
      // Not on Workers.
    }
  }
  return new Set(
    (raw || DEFAULT_ADMIN_EMAILS)
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * DEVELOPMENT-ONLY bypass so the dashboard can be screenshotted against
 * local data without a real Google sign-in.
 *
 * Impossible in production: `process.env.NODE_ENV` is inlined as the string
 * "production" in every `next build`, so this whole branch is dead code
 * there. In `next dev` it additionally requires a loopback host and an
 * explicit `?devBypass=1` on the request.
 */
function devBypass(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const url = new URL(request.url);
  const isLoopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  // `next dev` may build request.url from its own listen address, so the
  // Host header the client actually sent must be loopback as well.
  let headerHost = "";
  try {
    headerHost = new URL(`http://${request.headers.get("host") ?? ""}`).hostname;
  } catch {
    return false;
  }
  return isLoopback(url.hostname) && isLoopback(headerHost) && url.searchParams.get("devBypass") === "1";
}

export async function verifyAdmin(request: Request): Promise<AdminCheck> {
  if (devBypass(request)) return { ok: true, email: "dev-bypass@localhost" };

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) return { ok: false, status: 503, reason: "not-configured" };

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
  if (!match) return { ok: false, status: 401, reason: "signed-out" };

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(match[1], FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
      // Tolerates small clock drift between Google and the edge.
      clockTolerance: 30,
    });
    payload = result.payload as Record<string, unknown>;
  } catch {
    return { ok: false, status: 401, reason: "invalid-token" };
  }

  const now = Math.floor(Date.now() / 1000);
  const authTime = typeof payload.auth_time === "number" ? payload.auth_time : null;
  if (typeof payload.sub !== "string" || !payload.sub || authTime === null || authTime > now + 30) {
    return { ok: false, status: 401, reason: "invalid-token" };
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";

  // The `admin` custom claim is granted per account (uid) by the project owner
  // through the Firebase Admin API and is signed into the token by Google, so
  // a client can't add it to itself. It is authoritative on its own.
  if (payload.admin === true) return { ok: true, email: email || payload.sub };

  if (payload.email_verified !== true) return { ok: false, status: 403, reason: "unverified" };
  if (!email || !(await adminEmails()).has(email)) return { ok: false, status: 403, reason: "not-admin" };

  return { ok: true, email };
}
