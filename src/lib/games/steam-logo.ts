/**
 * Steam's library logo — the transparent wordmark Steam lays over a game's
 * library hero. Not part of any API payload, so its URL is constructed; a
 * cached HEAD check confirms it exists before we hand it out, because a
 * constructed URL that 404s is a placeholder, not data.
 */

import { unstable_cache } from "next/cache";
import type { GameLogo } from "./types";

const logoUrl = (appid: number) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/logo.png`;

/**
 * Cached for 30 days either way. A 404 is a real answer and is cached; a
 * network failure throws, so it is retried rather than pinned as "no logo".
 */
const logoExists = unstable_cache(
  async (appid: number): Promise<boolean> => {
    const res = await fetch(logoUrl(appid), { method: "HEAD", signal: AbortSignal.timeout(3500) });
    if (res.ok) return true;
    if (res.status === 404 || res.status === 403) return false;
    throw new Error(`steam logo HEAD ${res.status}`);
  },
  ["steam-logo-exists"],
  { revalidate: 60 * 60 * 24 * 30, tags: ["steam-logo"] },
);

/**
 * Steam marks are drawn to sit over the library's key art, in the game's own
 * colours — so "color": no inversion, legible on dark or imagery.
 */
export async function steamLogoFor(appid: number | null | undefined): Promise<GameLogo | null> {
  if (!appid || !Number.isInteger(appid) || appid <= 0) return null;
  try {
    return (await logoExists(appid)) ? { url: logoUrl(appid), tone: "color", source: "steam" } : null;
  } catch {
    return null;
  }
}
