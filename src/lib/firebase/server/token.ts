/**
 * Bearer credentials for the Firestore REST API, signed with `crypto.subtle`
 * (RS256) — no Admin SDK (it needs Node) and no JWT library.
 *
 * Two modes:
 *
 *  - "self-signed" (default): Google APIs accept a service-account JWT
 *    carrying a `scope` claim directly as the bearer token. Minting one is a
 *    local signature, so it costs *no* outbound request — which matters on
 *    Workers Free, where every invocation gets 50 subrequests.
 *  - "exchange": the classic OAuth flow (POST the JWT to oauth2.googleapis.com
 *    for an access token). One extra request per hour per isolate; used only
 *    if Firestore ever rejects the self-signed form (see `rejectBearer`).
 *
 * Only resolved values are cached in module scope (the imported key and the
 * current token with its expiry): a pending promise shared across requests is
 * cancelled on Workers when its originating request ends.
 */

import type { ServiceAccount } from "./credentials";

const SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Tokens are valid for an hour; renew with a margin so a slow request never carries an expired one. */
const LIFETIME_S = 3600;
const RENEW_MARGIN_MS = 5 * 60_000;

type Mode = "self-signed" | "exchange";
let mode: Mode = "self-signed";
let signingKey: { email: string; key: CryptoKey } | null = null;
let current: { email: string; mode: Mode; token: string; expiresAt: number } | null = null;

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const encodeJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

async function importKey(account: ServiceAccount): Promise<CryptoKey> {
  if (signingKey?.email === account.clientEmail) return signingKey.key;
  const pem = account.privateKey.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  signingKey = { email: account.clientEmail, key };
  return key;
}

/** A signed RS256 JWT for this service account. Exported for the self-checks. */
export async function signJwt(account: ServiceAccount, claims: Record<string, unknown>): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", ...(account.privateKeyId ? { kid: account.privateKeyId } : {}) };
  const unsigned = `${encodeJson(header)}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importKey(account), new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function exchange(account: ServiceAccount, assertion: string): Promise<{ token: string; expiresIn: number } | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn("[firestore] token exchange failed:", res.status);
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    return json.access_token ? { token: json.access_token, expiresIn: json.expires_in ?? LIFETIME_S } : null;
  } catch (err) {
    console.warn("[firestore] token exchange failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * A bearer token, plus whether minting it cost an outbound request (so
 * budget-aware callers can charge for it). Null when signing failed.
 */
export async function bearerToken(account: ServiceAccount): Promise<{ token: string; fetched: boolean } | null> {
  const now = Date.now();
  if (current && current.email === account.clientEmail && current.mode === mode && current.expiresAt - RENEW_MARGIN_MS > now) {
    return { token: current.token, fetched: false };
  }
  const iat = Math.floor(now / 1000);
  try {
    if (mode === "self-signed") {
      const token = await signJwt(account, {
        iss: account.clientEmail,
        sub: account.clientEmail,
        scope: SCOPE,
        iat,
        exp: iat + LIFETIME_S,
      });
      current = { email: account.clientEmail, mode, token, expiresAt: now + LIFETIME_S * 1000 };
      return { token, fetched: false };
    }
    const assertion = await signJwt(account, {
      iss: account.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + LIFETIME_S,
    });
    const minted = await exchange(account, assertion);
    if (!minted) return null;
    current = { email: account.clientEmail, mode, token: minted.token, expiresAt: now + minted.expiresIn * 1000 };
    return { token: minted.token, fetched: true };
  } catch (err) {
    console.warn("[firestore] could not sign a token:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Called on a 401: drop the cached token and fall back to the OAuth exchange. */
export function rejectBearer(): void {
  current = null;
  mode = "exchange";
}

/** Whether a 401 retry could help (we haven't already fallen back). */
export function canFallBack(): boolean {
  return mode === "self-signed";
}
