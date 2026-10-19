/**
 * Authorisation for `/api/cron/*`.
 *
 * `worker.mjs` calls those routes from its `scheduled` handler with the
 * shared `CRON_SECRET` in `x-cron-secret`. The comparison hashes both sides
 * first and compares the digests in constant time, so neither the secret's
 * content nor its length leaks through timing. The secret is never logged.
 *
 * Without a configured secret every request is refused — except under
 * `next dev` from a loopback host, so the jobs can be exercised locally with
 * curl. `process.env.NODE_ENV` is inlined as "production" by `next build`,
 * which makes that branch dead code in a deployed Worker.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

async function cronSecret(): Promise<string | null> {
  let secret = process.env.CRON_SECRET;
  if (!secret) {
    try {
      const { env } = await getCloudflareContext({ async: true });
      secret = (env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
    } catch {
      // Not on Workers.
    }
  }
  return secret?.trim() || null;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function isLoopbackDev(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  try {
    const headerHost = new URL(`http://${request.headers.get("host") ?? ""}`).hostname;
    return loopback(new URL(request.url).hostname) && loopback(headerHost);
  } catch {
    return false;
  }
}

export async function isAuthorizedCron(request: Request): Promise<boolean> {
  const provided = request.headers.get("x-cron-secret");
  const secret = await cronSecret();
  if (secret && provided) return constantTimeEqual(provided, secret);
  return !provided && isLoopbackDev(request);
}
