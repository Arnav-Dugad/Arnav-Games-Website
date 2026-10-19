import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Runs `task` after the response is sent when the runtime supports it, so
 * bookkeeping writes (release history, tracked games, price observations)
 * never add latency. On Workers it is `ctx.waitUntil`; its fetches still count
 * toward the invocation's 50-subrequest budget, so callers batch writes.
 */
export async function runAfterResponse(task: Promise<unknown>): Promise<void> {
  try {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(task.catch(() => {}));
  } catch {
    await task.catch(() => {});
  }
}
