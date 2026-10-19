/**
 * Cloudflare Worker entry.
 *
 * Wraps the worker OpenNext generates (`.open-next/worker.js`, built by
 * `opennextjs-cloudflare build`) to add what a Next.js app can't express:
 *
 *  - Cron Triggers. Each schedule in wrangler.jsonc maps to an internal
 *    `/api/cron/<job>` route, called through the worker's own service binding
 *    with a shared secret, so job logic lives in normal, testable Next code.
 *  - The `PresenceRoom` Durable Object behind the admin "online now" counter.
 */

// Resolved by wrangler at deploy time, after the OpenNext build.
import nextWorker from "./.open-next/worker.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
export { PresenceRoom } from "./src/server/presence-room.ts";

/** Cron expression (as written in wrangler.jsonc) → internal job route. */
const CRON_JOBS = {
  "5 * * * *": "players", // hourly Steam player-count snapshots
  "20 4 * * *": "prices", // daily local-price snapshots
  "0 8 * * 1": "digest", // weekly owner digest, Mondays 08:00 UTC
};

export default {
  fetch: nextWorker.fetch,

  async scheduled(controller, env, ctx) {
    const job = CRON_JOBS[controller.cron];
    if (!job || !env.CRON_SECRET) return;
    ctx.waitUntil(
      env.WORKER_SELF_REFERENCE.fetch(`https://internal/api/cron/${job}`, {
        method: "POST",
        headers: { "x-cron-secret": env.CRON_SECRET },
      }),
    );
  },
};
