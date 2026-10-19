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

/**
 * The visitor's country as a first-party cookie on page loads, so the
 * browser knows its default price region without a separate `/api/region`
 * request (one Worker request saved per new visitor and device). Set only on
 * document requests whose cookie is missing or stale, after Next has built
 * the response, so nothing Next caches ever carries it. Not HttpOnly — the
 * client reads it — and it holds nothing but a two-letter country code.
 */
const COUNTRY_COOKIE = "ag-cc";

function withCountryCookie(request, response) {
  if (request.method !== "GET") return response;
  const dest = request.headers.get("sec-fetch-dest");
  if (dest ? dest !== "document" : !(request.headers.get("accept") ?? "").includes("text/html")) return response;
  const country = typeof request.cf?.country === "string" ? request.cf.country.toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(country) || country === "XX" || country === "T1") return response;
  if ((request.headers.get("cookie") ?? "").includes(`${COUNTRY_COOKIE}=${country}`)) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", `${COUNTRY_COOKIE}=${country}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    return withCountryCookie(request, await nextWorker.fetch(request, env, ctx));
  },

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
