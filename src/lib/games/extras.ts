/**
 * The game page's second, lazily-requested part (`/api/game/[id]/extras`):
 * SteamSpy tags/owners, PCGamingWiki features & accessibility, speedrun.com
 * world records, mods, the credited people and the developers' track
 * records.
 *
 * Split from `/insights` because adding these to it would push one cold
 * invocation past ~45 outbound requests (insights alone is ~33 cold). The
 * page asks for this when the reader scrolls near the sections that use it.
 *
 * Outbound, every cache cold: IGDB ids/name/slug ≤ 3, Wikidata links ≤ 2
 * (usually warm — the game page renders them), SteamSpy 1, PCGamingWiki ≤ 2,
 * speedrun.com 2, Thunderstore 2, Steam store record ≤ 1 (shared cache),
 * Wikidata people 1, studio records ≤ 7 (two developers, see
 * `studio-record.ts`) — about 22 at worst, 0–2 warm.
 */

import { igdbCachedQuery, igdbConfigured } from "./providers/igdb";
import { TTL } from "./providers/types";
import type { MarketIds } from "./market";
import { modLinks, modsFor } from "./mods";
import { pcgwFeatures } from "./pcgw";
import { peopleFor } from "./people";
import { settle } from "./polite";
import { speedrunRecords } from "./speedrun";
import { steamSpyFor } from "./steamspy";
import { studioRecords } from "./studio-record";
import type { GameExtras } from "./types";
import { wikidataFor } from "./wikidata";

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
/** Each part gets this long; a slow volunteer API never holds the response. */
const PART_MS = 7000;

async function igdbNameAndSlug(id: number): Promise<{ name: string | null; slug: string | null }> {
  if (!igdbConfigured()) return { name: null, slug: null };
  try {
    const rows = await igdbCachedQuery<Array<{ name?: string; slug?: string }>>("games", `fields name,slug;\nwhere id = ${id};\nlimit 1;`, TTL.detail);
    return { name: rows[0]?.name ?? null, slug: rows[0]?.slug ?? null };
  } catch {
    return { name: null, slug: null };
  }
}

export async function extrasFor(
  ids: MarketIds,
  hints: { name: string | null; slug: string | null; developers?: number[] },
): Promise<GameExtras> {
  let name = hints.name;
  let slug = hints.slug && SAFE_SLUG.test(hints.slug) ? hints.slug : null;
  if (ids.igdbId && (!name || !slug)) {
    const igdb = await igdbNameAndSlug(ids.igdbId);
    name ??= igdb.name;
    slug ??= igdb.slug;
  }
  if (!ids.igdbId) slug = null; // Wikidata joins on IGDB slugs only.

  const unavailable: GameExtras["unavailable"] = [];
  const links = slug ? await settle(wikidataFor(slug).then((w) => w?.links ?? null), null, PART_MS) : null;

  const developers = ids.igdbId ? (hints.developers ?? []).slice(0, 2) : [];
  const [steamSpy, pcgw, speedrun, mods, people, studios] = await Promise.all([
    ids.steam ? settle(steamSpyFor(ids.steam), undefined, PART_MS) : null,
    ids.steam || links?.pcGamingWiki || name
      ? settle(pcgwFeatures({ pcgwUrl: links?.pcGamingWiki, steam: ids.steam, name }), undefined, PART_MS)
      : null,
    name ? settle(speedrunRecords(name), undefined, PART_MS) : null,
    name ? settle(modsFor({ name, steam: ids.steam }), { mods: { thunderstore: null, links: modLinks(name, null) }, failed: true }, PART_MS) : null,
    slug ? settle(peopleFor(slug), undefined, PART_MS) : [],
    developers.length > 0 ? settle(studioRecords(developers), undefined, PART_MS) : [],
  ]);

  if (steamSpy === undefined) unavailable.push("steamSpy");
  if (pcgw === undefined) unavailable.push("pcgw");
  if (speedrun === undefined) unavailable.push("speedrun");
  if (mods?.failed) unavailable.push("mods");
  if (people === undefined) unavailable.push("people");
  if (studios === undefined) unavailable.push("studios");

  return {
    ids: { igdbId: ids.igdbId, steam: ids.steam, slug },
    steamSpy: steamSpy ?? null,
    pcgw: pcgw ?? null,
    speedrun: speedrun ?? null,
    mods: mods?.mods ?? { thunderstore: null, links: modLinks(name ?? "", null) },
    people: people ?? [],
    studios: studios ?? [],
    unavailable,
  };
}
