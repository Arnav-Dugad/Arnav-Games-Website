/**
 * Server-only access to Worker bindings and secrets used by analytics:
 * env vars (`CRON_SECRET`, `RESEND_API_KEY`, …) and the `PRESENCE` Durable
 * Object. Everything degrades to null/undefined outside Workers.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * A secret or var. On Workers they live on the binding env; OpenNext mirrors
 * most into process.env, but don't depend on it. `.env.local` in `next dev`
 * lands in process.env.
 */
export async function readEnv(name: string): Promise<string | undefined> {
  const direct = process.env[name];
  if (direct) return direct;
  try {
    const { env } = await getCloudflareContext({ async: true });
    const value = (env as unknown as Record<string, unknown>)[name];
    return typeof value === "string" && value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The slice of the Durable Object namespace API used here. */
interface PresenceStub {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}
interface PresenceNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): PresenceStub;
}

/**
 * The single global PresenceRoom, or null where Durable Objects don't run.
 *
 * `next dev` exposes wrangler's bindings through a proxy that can't host a
 * Durable Object class defined in this repo, so development is treated as
 * "unavailable" outright rather than letting every heartbeat throw.
 */
export async function presenceRoom(): Promise<PresenceStub | null> {
  if (process.env.NODE_ENV === "development") return null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    const namespace = (env as unknown as { PRESENCE?: PresenceNamespace }).PRESENCE;
    if (!namespace) return null;
    return namespace.get(namespace.idFromName("global"));
  } catch {
    return null;
  }
}
