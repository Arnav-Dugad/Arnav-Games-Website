/**
 * Cover palettes, sampled from real pixels on the server.
 *
 * Only known image hosts are fetched (IGDB and Steam's CDNs) — `imageUrl` is
 * caller-supplied, and fetching arbitrary URLs from a Worker would be an open
 * SSRF proxy. IGDB assets are re-requested as a ~10 KB 90px-wide PNG
 * (`t_cover_small`), whatever size the caller rendered; Steam assets are JPEG
 * and decoded at 1/8 scale (see `image-decode.ts`).
 */

import { unstable_cache } from "next/cache";
import type { CoverPalette } from "./types";
import { decodeImage } from "./image-decode";
import { paletteFromPixels } from "./palette-core";

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const MAX_BYTES = 2_000_000;

const IGDB_IMAGE = /^https:\/\/images\.igdb\.com\/igdb\/image\/upload\/t_[a-z0-9_]+\/([a-z0-9]+)\.(?:jpg|jpeg|png|webp)$/i;
const STEAM_HOSTS = new Set([
  "cdn.cloudflare.steamstatic.com",
  "shared.cloudflare.steamstatic.com",
  "cdn.akamai.steamstatic.com",
  "shared.akamai.steamstatic.com",
  "shared.fastly.steamstatic.com",
  "cdn.steamstatic.com",
  "steamcdn-a.akamaihd.net",
]);

/** The fetchable source for a supported image URL, or null when unsupported. */
function sampleSource(imageUrl: string): string | null {
  const igdb = imageUrl.match(IGDB_IMAGE);
  if (igdb) return `https://images.igdb.com/igdb/image/upload/t_cover_small/${igdb[1]}.png`;
  try {
    const url = new URL(imageUrl);
    if (url.protocol === "https:" && STEAM_HOSTS.has(url.hostname) && /\.jpe?g$/i.test(url.pathname)) {
      return `https://${url.hostname}${url.pathname}`;
    }
  } catch {
    // Not a URL; unsupported.
  }
  return null;
}

/**
 * Keyed by the normalised source, so every size of one IGDB image shares an
 * entry. An undecodable image caches as null (it will not decode tomorrow
 * either); a network failure throws so it is retried, not pinned.
 */
const cachedPalette = unstable_cache(
  async (source: string): Promise<CoverPalette | null> => {
    const res = await fetch(source, { signal: AbortSignal.timeout(4000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`palette fetch ${res.status}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) return null;
    const image = await decodeImage(bytes);
    return image ? paletteFromPixels(image.data, image.width, image.height) : null;
  },
  ["cover-palette", "v1"],
  { revalidate: THIRTY_DAYS, tags: ["palette"] },
);

/** Dominant/vibrant/muted colours for a cover or key-art URL; null on failure. */
export async function paletteFor(imageUrl: string | null | undefined): Promise<CoverPalette | null> {
  if (!imageUrl) return null;
  const source = sampleSource(imageUrl);
  if (!source) return null;
  try {
    return await cachedPalette(source);
  } catch {
    return null;
  }
}
