/**
 * Mods for a game: Thunderstore's most-downloaded packages where the game has
 * a Thunderstore community, plus link-outs to Nexus Mods (no open API; we
 * never scrape it) and the Steam Workshop (only when Steam lists the
 * Workshop feature for the app, so the link never lands on an empty hub).
 *
 * Thunderstore's full `/package/` dumps run to tens of MB per community —
 * far past a Worker's CPU budget — so this uses the paged "cyberstorm"
 * listing API, which returns the top 20 by downloads in ~17 KB.
 *
 * Outbound: community index 1 (cached 7 days, shared by every game) +
 * listing 1 (24 h per community) + Steam store record (usually a data-cache
 * hit shared with the game page).
 */

import { unstable_cache } from "next/cache";
import { compactCommunities, matchCommunity, parseThunderstoreListing, type CommunityRow } from "./external-rules";
import { politeJson } from "./polite";
import { steamFullDetails } from "./steam-store";
import type { GameMods } from "./types";

const TS = "https://thunderstore.io";
const STEAM_WORKSHOP_CATEGORY = 30;

const cachedCommunities = unstable_cache(
  async (): Promise<CommunityRow[]> => {
    const rows = compactCommunities(await politeJson(`${TS}/api/cyberstorm/community/?page_size=500`, 6000));
    if (rows.length < 20) throw new Error("thunderstore: community list looks truncated");
    return rows;
  },
  ["thunderstore-communities-v1"],
  { revalidate: 60 * 60 * 24 * 7, tags: ["thunderstore"] },
);

const cachedListing = unstable_cache(
  async (community: string) => parseThunderstoreListing(await politeJson(`${TS}/api/cyberstorm/listing/${community}/?ordering=most-downloaded`, 6000), community),
  ["thunderstore-listing-v1"],
  { revalidate: 60 * 60 * 24, tags: ["thunderstore"] },
);

/** Pure link-outs; safe to build without any request. */
export function modLinks(name: string, workshopAppid: number | null): GameMods["links"] {
  return {
    nexus: `https://www.nexusmods.com/search/?gsearch=${encodeURIComponent(name)}&gsearchtype=games`,
    steamWorkshop: workshopAppid ? `https://steamcommunity.com/app/${workshopAppid}/workshop/` : null,
  };
}

/**
 * `failed` means Thunderstore couldn't be reached (the links are still
 * returned); `thunderstore: null` without `failed` means the game has no
 * Thunderstore community.
 */
export async function modsFor(game: { name: string; steam: number | null }): Promise<{ mods: GameMods; failed: boolean }> {
  const [communities, details] = await Promise.all([
    cachedCommunities().catch((err: unknown) => {
      console.warn("[mods] communities failed:", err instanceof Error ? err.message : err);
      return null;
    }),
    game.steam ? steamFullDetails(game.steam) : null,
  ]);
  const workshop = Boolean(details?.categories?.some((category) => category.id === STEAM_WORKSHOP_CATEGORY));
  const links = modLinks(game.name, workshop ? game.steam : null);
  if (!communities) return { mods: { thunderstore: null, links }, failed: true };

  const community = matchCommunity(communities, game.name);
  if (!community) return { mods: { thunderstore: null, links }, failed: false };
  try {
    const listing = await cachedListing(community[0]);
    return {
      mods: {
        thunderstore: listing.top.length > 0
          ? { community: community[0], name: community[2], url: `${TS}/c/${community[0]}/`, total: listing.total, top: listing.top }
          : null,
        links,
      },
      failed: false,
    };
  } catch (err) {
    console.warn("[mods] listing failed:", err instanceof Error ? err.message : err);
    return { mods: { thunderstore: null, links }, failed: true };
  }
}
