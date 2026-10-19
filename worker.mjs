/**
 * Cloudflare Worker entry.
 *
 * Wraps the worker OpenNext generates (`.open-next/worker.js`, built by
 * `opennextjs-cloudflare build`) to add what a Next.js app can't express:
 *
 *  - A Cron Trigger. Due jobs run as internal `/api/cron/<job>` routes,
 *    called through the worker's own service binding with a shared secret,
 *    so job logic lives in normal, testable Next code.
 */

// Resolved by wrangler at deploy time, after the OpenNext build.
import nextWorker from "./.open-next/worker.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

/**
 * One cron trigger drives every job.
 *
 * The Workers Free plan allows 5 cron triggers per *account*, shared with the
 * owner's other Workers, so this app uses a single 10-minute schedule and
 * decides here which jobs are due. Each job is its own request through the
 * service binding, so each gets its own 50-fetch budget.
 */
function jobsDue(scheduledTime) {
  const at = new Date(scheduledTime);
  const minute = at.getUTCMinutes();
  const hour = at.getUTCHours();
  const slot = Math.floor(minute / 10); // 0–5
  // ~40 games per run, six runs an hour → hourly player coverage.
  const jobs = ["players"];
  // Twitch viewers twice an hour, Steam review totals once an hour (for
  // games around launch), each in its own slot so no run does two big jobs.
  if (slot === 1 || slot === 4) jobs.push("twitch");
  if (slot === 3) jobs.push("reviews");
  // Daily local-price snapshots in the 04:20 UTC slot.
  if (hour === 4 && slot === 2) jobs.push("prices");
  // Daily critic-score observations in the 05:00 UTC slot.
  if (hour === 5 && slot === 0) jobs.push("scores");
  return jobs;
}

export default {
  fetch: nextWorker.fetch,

  async scheduled(controller, env, ctx) {
    if (!env.CRON_SECRET) return;
    for (const job of jobsDue(controller.scheduledTime)) {
      ctx.waitUntil(
        env.WORKER_SELF_REFERENCE.fetch(`https://internal/api/cron/${job}`, {
          method: "POST",
          headers: { "x-cron-secret": env.CRON_SECRET },
        }),
      );
    }
  },
};
