/**
 * Reference links (and a last-resort logo) from Wikidata.
 *
 * Wikidata records IGDB's slug as property P5794, which makes it a free join
 * table from an IGDB game to Wikipedia, HowLongToBeat, OpenCritic,
 * Metacritic and PCGamingWiki — and to the game's logo on Commons (P154).
 * One SPARQL request per game, cached for a week.
 */

import { unstable_cache } from "next/cache";
import type { GameLogo, ReferenceLinks } from "./types";
import { decodeImage } from "./image-decode";
import { logoToneFromPixels } from "./palette-core";

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "ArnavGames/1.0 (https://arnav-games.arnavrival12.workers.dev; arnavrival12@gmail.com)";
const WEEK = 60 * 60 * 24 * 7;
const TIMEOUT_MS = 4000;

/** IGDB slugs are lowercase words and hyphens; anything else never reaches SPARQL. */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

export interface WikidataGame {
  links: ReferenceLinks;
  logo: GameLogo | null;
}

interface Binding {
  [key: string]: { value: string } | undefined;
}

const encodePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");

/**
 * A Commons logo as a PNG rendition we have actually looked at.
 *
 * Commons serves SVG masters, and a P154 logo is often a plain black mark,
 * which vanishes on this dark UI unless we know to invert it. So the file is
 * fetched as a 600px PNG thumbnail and its tone measured from the pixels.
 * Marks without transparency are rejected: they are boxed images, not
 * wordmarks, and would render as a rectangle over the art.
 */
async function commonsLogo(fileUrl: string): Promise<GameLogo | null> {
  let url: URL;
  try {
    url = new URL(fileUrl.replace(/^http:/, "https:"));
  } catch {
    return null;
  }
  if (url.hostname !== "commons.wikimedia.org" || !url.pathname.startsWith("/wiki/Special:FilePath/")) return null;
  url.search = "?width=600";

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const final = new URL(res.url);
  // Commons answers from either media host, depending on thumbnail routing.
  if (final.hostname !== "upload.wikimedia.org" && final.hostname !== "thumb.wikimedia.org") return null;
  final.search = "";
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 2_000_000) return null;

  const image = await decodeImage(bytes);
  if (!image) return null;
  let transparent = false;
  for (let o = 3; o < image.data.length; o += 4) {
    if (image.data[o] < 16) {
      transparent = true;
      break;
    }
  }
  const tone = transparent ? logoToneFromPixels(image.data) : null;
  return tone ? { url: final.toString(), tone, source: "wikidata" } : null;
}

const lookup = unstable_cache(
  async (slug: string): Promise<WikidataGame | null> => {
    const query = `SELECT ?logo ?hltb ?oc ?mc ?pcgw ?wp WHERE {
  ?item wdt:P5794 "${slug}" .
  OPTIONAL { ?item wdt:P154 ?logo }
  OPTIONAL { ?item wdt:P2816 ?hltb }
  OPTIONAL { ?item wdt:P2864 ?oc }
  OPTIONAL { ?item wdt:P1712 ?mc }
  OPTIONAL { ?item wdt:P6337 ?pcgw }
  OPTIONAL { ?wp schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
} LIMIT 5`;
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`wikidata ${res.status}`);
    const json = (await res.json()) as { results?: { bindings?: Binding[] } };
    const bindings = json.results?.bindings ?? [];
    if (bindings.length === 0) return null;

    const first = (key: string) => bindings.map((row) => row[key]?.value).find(Boolean) ?? null;
    const hltb = first("hltb");
    const openCritic = first("oc");
    const metacritic = first("mc");
    const pcgw = first("pcgw");
    const wikipedia = first("wp");

    const links: ReferenceLinks = {
      wikipedia: wikipedia?.startsWith("https://en.wikipedia.org/") ? wikipedia : null,
      howLongToBeat: hltb && /^\d+$/.test(hltb) ? `https://howlongtobeat.com/game/${hltb}` : null,
      openCritic: openCritic ? `https://opencritic.com/game/${encodePath(openCritic)}` : null,
      metacritic: metacritic ? `https://www.metacritic.com/${encodePath(metacritic)}` : null,
      pcGamingWiki: pcgw ? `https://www.pcgamingwiki.com/wiki/${encodeURIComponent(pcgw)}` : null,
    };

    const logoFile = first("logo");
    const logo = logoFile ? await commonsLogo(logoFile).catch(() => null) : null;
    return { links, logo };
  },
  ["wikidata-game", "v1"],
  { revalidate: WEEK, tags: ["wikidata"] },
);

/** Links and logo for an IGDB slug; null when Wikidata has no item or is unreachable. */
export async function wikidataFor(igdbSlug: string): Promise<WikidataGame | null> {
  if (!SAFE_SLUG.test(igdbSlug)) return null;
  try {
    return await lookup(igdbSlug);
  } catch (err) {
    console.warn("[wikidata] lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
