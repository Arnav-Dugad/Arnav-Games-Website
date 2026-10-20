/**
 * Verifies a Firebase Auth ID token on the server with `crypto.subtle` — no
 * Admin SDK (it needs Node) and no JWT library.
 *
 * A Firebase ID token is an RS256 JWT signed by Google's `securetoken`
 * service account. It is genuine for this project when:
 *
 *  - the signature verifies against one of Google's published keys (JWK
 *    set, rotated every few hours; cached for as long as Google's
 *    Cache-Control allows, at most six hours);
 *  - `aud` is the project id and `iss` is
 *    `https://securetoken.google.com/<project id>`;
 *  - it hasn't expired (`exp`), wasn't issued in the future (`iat`, with a
 *    minute of clock skew), and names a user (`sub`, ≤ 128 chars).
 *
 * See https://firebase.google.com/docs/auth/admin/verify-id-tokens.
 *
 * Like `token.ts`, only *resolved* keys are cached in module scope: on
 * Workers a pending promise shared across requests is cancelled with the
 * request that started it.
 */

import type { Budget } from "./firestore";

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MAX_CACHE_MS = 6 * 60 * 60 * 1000;
const SKEW_S = 60;

interface Jwk extends JsonWebKey {
  kid?: string;
}

let keys: { byKid: Map<string, CryptoKey>; expiresAt: number } | null = null;

function base64UrlBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(part: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlBytes(part))) as T;
  } catch {
    return null;
  }
}

async function signingKeys(budget?: Budget): Promise<Map<string, CryptoKey> | null> {
  if (keys && keys.expiresAt > Date.now()) return keys.byKid;
  if (budget && !budget.take()) return null;
  try {
    const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const { keys: jwks } = (await res.json()) as { keys?: Jwk[] };
    const byKid = new Map<string, CryptoKey>();
    for (const jwk of jwks ?? []) {
      if (!jwk.kid || jwk.kty !== "RSA") continue;
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      byKid.set(jwk.kid, key);
    }
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600) * 1000;
    keys = { byKid, expiresAt: Date.now() + Math.min(MAX_CACHE_MS, maxAge) };
    return byKid;
  } catch (err) {
    console.warn("[auth] could not load signing keys:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface VerifiedUser {
  uid: string;
}

/**
 * The verified user for `Authorization: Bearer <ID token>`, or null for a
 * missing, malformed, expired, foreign or forged token. Costs one outbound
 * request only when Google's keys aren't cached.
 */
export async function verifyIdToken(token: string | null | undefined, projectId: string, budget?: Budget): Promise<VerifiedUser | null> {
  if (!token || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
  const claims = decodeJson<{ aud?: string; iss?: string; sub?: string; exp?: number; iat?: number; auth_time?: number }>(parts[1]);
  if (!header || !claims || header.alg !== "RS256" || !header.kid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.iat !== "number" || claims.iat > now + SKEW_S) return null;
  if (typeof claims.auth_time === "number" && claims.auth_time > now + SKEW_S) return null;
  if (typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 128) return null;

  let byKid = await signingKeys(budget);
  // A key rotated in since we cached the set: refresh once.
  if (byKid && !byKid.has(header.kid)) {
    keys = null;
    byKid = await signingKeys(budget);
  }
  const key = byKid?.get(header.kid);
  if (!key) return null;
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  return valid ? { uid: claims.sub } : null;
}
