/**
 * The Firebase Admin service account, from `FIREBASE_SERVICE_ACCOUNT`
 * (base64 of the Google credentials JSON): `.env.local` in development, a
 * Worker secret in production (`npx wrangler secret put FIREBASE_SERVICE_ACCOUNT`).
 *
 * Read lazily and cached as a *resolved* value: on Workers a promise shared
 * across requests gets cancelled with the request that created it, so only
 * finished results may live in module scope. Never logged.
 */

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | null;
}

let cached: ServiceAccount | null | undefined;

function parse(raw: string | undefined): ServiceAccount | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    // Accept raw JSON too, so a pasted (non-base64) key still works.
    const json = text.startsWith("{") ? text : atob(text);
    const data = JSON.parse(json) as Partial<Record<string, string>>;
    if (!data.project_id || !data.client_email || !data.private_key) return null;
    return {
      projectId: data.project_id,
      clientEmail: data.client_email,
      privateKey: data.private_key,
      privateKeyId: data.private_key_id ?? null,
    };
  } catch {
    console.warn("[firestore] FIREBASE_SERVICE_ACCOUNT is set but isn't valid base64 JSON");
    return null;
  }
}

/** The service account, or null when it isn't configured (feature quietly off). */
export async function serviceAccount(): Promise<ServiceAccount | null> {
  if (cached !== undefined) return cached;
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    try {
      // Workers secrets are normally mirrored into process.env by OpenNext;
      // the binding object is the fallback.
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const { env } = await getCloudflareContext({ async: true });
      raw = (env as unknown as { FIREBASE_SERVICE_ACCOUNT?: string }).FIREBASE_SERVICE_ACCOUNT;
    } catch {
      // Not on Workers (scripts, tests).
    }
  }
  cached = parse(raw);
  return cached;
}

/** For one-off scripts, which read the key themselves. */
export function serviceAccountFrom(raw: string | undefined): ServiceAccount | null {
  return parse(raw);
}
