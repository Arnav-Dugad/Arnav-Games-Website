/**
 * The one way round-5 sources are fetched: identified, time-boxed, and
 * throwing on anything but a 2xx JSON/text answer.
 *
 * Throwing matters because every caller sits inside `unstable_cache`, which
 * stores whatever its function returns — a `null` on an outage would be
 * pinned for a day. (Inside `unstable_cache` Next treats fetches as
 * no-store, so the raw ~400 KB catalogues are never written to the data
 * cache; only the compact result is.)
 */

/** Every volunteer-run API we call asks clients to identify themselves. */
export const USER_AGENT = "ArnavGames/1.0 (https://arnav-games.arnavrival12.workers.dev; arnavrival12@gmail.com)";

const DEFAULT_TIMEOUT_MS = 5000;

async function politeFetch(url: string, accept: string, timeoutMs: number): Promise<Response> {
  const res = await fetch(url, {
    headers: { Accept: accept, "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res;
}

export async function politeJson<T = unknown>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  return (await (await politeFetch(url, "application/json", timeoutMs)).json()) as T;
}

/** The final URL after redirects too (PCGamingWiki's appid lookup is a redirect). */
export async function politeHead(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const res = await politeFetch(url, "text/html", timeoutMs);
  // The body isn't needed; release it rather than buffering a wiki page.
  await res.body?.cancel().catch(() => undefined);
  return res.url;
}

/** Never rejects: resolves to `fallback` on failure or at the deadline. */
export function settle<T>(task: Promise<T>, fallback: T, ms: number): Promise<T> {
  return Promise.race([
    task.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
