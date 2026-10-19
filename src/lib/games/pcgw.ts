/**
 * PC features and accessibility from PCGamingWiki.
 *
 * PCGamingWiki denies arbitrary Cargo queries, so this reads an article's
 * wikitext through the MediaWiki API and parses the `{{Video}}`, `{{Input}}`
 * and `{{Audio}}` templates (`parsePcgwWikitext`). The article is found, in
 * order of trust, from:
 *   1. Wikidata's PCGamingWiki id (`links.pcGamingWiki`), when the caller has it;
 *   2. PCGamingWiki's own Steam-appid redirect (`/api/appid.php`);
 *   3. a title search, accepting only an exact title match.
 * When we know the Steam app, an article whose infobox lists *other* appids is
 * rejected — a same-named game is not this game.
 *
 * Outbound: 1–2 cold (lookup + wikitext), cached 7 days per game.
 */

import { unstable_cache } from "next/cache";
import { normaliseTitle, parsePcgwWikitext, pcgwSteamAppids } from "./external-rules";
import { politeJson, USER_AGENT } from "./polite";
import type { PcgwFeatures } from "./types";

const WIKI = "https://www.pcgamingwiki.com";
const API = `${WIKI}/w/api.php`;
const TIMEOUT_MS = 5000;

/** "https://www.pcgamingwiki.com/wiki/The_Witcher_3:_Wild_Hunt" → "The Witcher 3: Wild Hunt". */
export function pcgwTitleFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.pcgamingwiki.com" || !parsed.pathname.startsWith("/wiki/")) return null;
    const title = decodeURIComponent(parsed.pathname.slice(6)).replace(/_/g, " ").trim();
    return title && title.length <= 200 && !title.includes("Special:") ? title : null;
  } catch {
    return null;
  }
}

/** PCGamingWiki's appid lookup answers with a redirect to the article. */
async function titleForAppid(appid: number): Promise<string | null> {
  const res = await fetch(`${WIKI}/api/appid.php?appid=${appid}`, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await res.body?.cancel().catch(() => undefined);
  if (res.status >= 500) throw new Error(`pcgw appid ${res.status}`);
  const location = res.headers.get("location");
  return location ? pcgwTitleFromUrl(new URL(location, WIKI).toString()) : null;
}

async function titleForName(name: string): Promise<string | null> {
  const json = await politeJson<{ query?: { search?: Array<{ title?: string }> } }>(
    `${API}?action=query&list=search&srsearch=${encodeURIComponent(name.slice(0, 100))}&srlimit=5&srnamespace=0&format=json&formatversion=2`,
    TIMEOUT_MS,
  );
  const key = normaliseTitle(name);
  return json.query?.search?.map((hit) => hit.title).find((title): title is string => Boolean(title && normaliseTitle(title) === key)) ?? null;
}

const cached = unstable_cache(
  async (page: string | null, steam: number, name: string): Promise<PcgwFeatures | null> => {
    const title = page ?? (steam > 0 ? await titleForAppid(steam) : null) ?? (name ? await titleForName(name) : null);
    if (!title) return null;
    const json = await politeJson<{ parse?: { title?: string; wikitext?: string }; error?: { code?: string } }>(
      `${API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&formatversion=2`,
      TIMEOUT_MS,
    );
    if (json.error?.code === "missingtitle") return null;
    const wikitext = json.parse?.wikitext;
    if (typeof wikitext !== "string") throw new Error("pcgw: no wikitext");
    const appids = pcgwSteamAppids(wikitext);
    if (steam > 0 && appids.length > 0 && !appids.includes(steam)) return null;
    const features = parsePcgwWikitext(wikitext, json.parse?.title ?? title);
    return Object.keys(features.values).length > 0 ? features : null;
  },
  ["pcgw-features-v1"],
  { revalidate: 60 * 60 * 24 * 7, tags: ["pcgw"] },
);

/**
 * Null when PCGamingWiki has no matching article (or it states nothing we
 * read); undefined when the wiki couldn't be reached.
 */
export async function pcgwFeatures(game: { pcgwUrl?: string | null; steam: number | null; name: string | null }): Promise<PcgwFeatures | null | undefined> {
  const page = pcgwTitleFromUrl(game.pcgwUrl);
  if (!page && !game.steam && !game.name) return null;
  try {
    // The name only matters when there's no Wikidata page; keep it out of the cache key otherwise.
    return await cached(page, game.steam ?? 0, page ? "" : (game.name ?? "").trim());
  } catch (err) {
    console.warn("[pcgw] failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}
