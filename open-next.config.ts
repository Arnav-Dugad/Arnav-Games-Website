import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";

/**
 * Cloudflare Workers adapter config.
 *
 * The R2 incremental cache is what makes `unstable_cache` and route-level
 * `revalidate` work on Workers — without it every request would hit IGDB and
 * trip its rate limit. The memory queue handles background ISR revalidation by
 * calling back into this worker through `WORKER_SELF_REFERENCE`.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  queue: memoryQueue,
});
