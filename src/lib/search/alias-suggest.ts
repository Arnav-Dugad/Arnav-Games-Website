/**
 * Proposes games for a search that found nothing.
 *
 * Zero-result queries are mostly abbreviations ("botw", "rdr2"), number
 * styles ("ff7" vs "Final Fantasy VII") or fragments. So: expand common
 * gaming shorthand, try Roman numerals, try dropping a trailing fragment, run
 * the existing IGDB search for up to three variants, and rank the merged
 * games by how well their titles answer any variant — with an initials check
 * for titles whose subtitle is the abbreviation ("botw" → "…: Breath of the
 * Wild"). The owner confirms; nothing here changes search on its own.
 */

import { fuzzyTitleScore, igdbConfigured, igdbSearchAll } from "@/lib/games/providers/igdb";
import type { SearchHit } from "@/lib/games/search";
import type { AliasCandidate } from "@/lib/analytics/types";

/*
 * Shorthand people actually type. Deliberately short: IGDB's alternative
 * names already cover many, and this only needs to get the right game into
 * the candidate pool — the owner picks.
 */
const SHORTHAND: Record<string, string> = {
  ac: "assassins creed", acnh: "animal crossing new horizons", aoe: "age of empires", apex: "apex legends",
  bg3: "baldurs gate 3", bo: "black ops", botw: "breath of the wild", cod: "call of duty",
  cp2077: "cyberpunk 2077", cs: "counter strike", csgo: "counter strike global offensive", d2: "destiny 2",
  d4: "diablo iv", dbd: "dead by daylight", dmc: "devil may cry", ds: "dark souls", er: "elden ring",
  ff: "final fantasy", fh: "forza horizon", gow: "god of war", gt: "gran turismo", gta: "grand theft auto",
  hk: "hollow knight", hl: "half life", hzd: "horizon zero dawn", kcd: "kingdom come deliverance",
  kh: "kingdom hearts", l4d: "left 4 dead", lol: "league of legends", loz: "legend of zelda",
  mc: "minecraft", mgs: "metal gear solid", mh: "monster hunter", mk: "mortal kombat", mw: "modern warfare",
  nfs: "need for speed", nms: "no mans sky", ow: "overwatch", poe: "path of exile",
  pubg: "playerunknowns battlegrounds", rdr: "red dead redemption", re: "resident evil", rl: "rocket league",
  ror2: "risk of rain 2", sc: "starcraft", sf: "street fighter", smb: "super mario bros",
  ssb: "super smash bros", ssbu: "super smash bros ultimate", tf2: "team fortress 2", tlou: "the last of us",
  totk: "tears of the kingdom", tw3: "the witcher 3", wow: "world of warcraft", xc: "xenoblade chronicles",
};

const ROMAN = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi"];
const STOPWORDS = new Set(["the", "of", "a", "an", "and"]);

const normalise = (value: string) =>
  value.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** "rdr2" → ["rdr", "2"], "gta" → ["gta"]; whole-token shorthand wins first. */
function expandToken(token: string): string {
  if (SHORTHAND[token]) return SHORTHAND[token];
  const split = /^([a-z]+)(\d+)$/.exec(token);
  if (split && SHORTHAND[split[1]]) return `${SHORTHAND[split[1]]} ${split[2]}`;
  return split ? `${split[1]} ${split[2]}` : token;
}

const toRoman = (text: string) =>
  text.replace(/\b(\d{1,2})\b/g, (match, digits: string) => ROMAN[Number(digits)] || match);

/** Up to three distinct search strings worth asking IGDB, best first. */
export function aliasVariants(query: string): string[] {
  const base = normalise(query);
  if (!base) return [];
  const tokens = base.split(" ");
  const expanded = tokens.map(expandToken).join(" ");
  const variants = [expanded, toRoman(expanded)];
  // A trailing fragment ("elden rin") or stray word can sink a whole query.
  if (tokens.length > 1) variants.push(tokens.slice(0, -1).map(expandToken).join(" "));
  variants.push(base);
  return [...new Set(variants.filter((variant) => variant.length >= 2))].slice(0, 3);
}

/** First letters, keeping numbers whole: "red dead redemption 2" → "rdr2". */
function initials(words: string[], skipSmall: boolean): string {
  return words
    .filter((word) => !skipSmall || !STOPWORDS.has(word))
    .map((word) => (/^\d+$/.test(word) ? word : word[0]))
    .join("");
}

/** Lower is better; 99 = no textual relation (still a candidate, ranked last). */
export function aliasScore(title: string, query: string, variants: string[]): number {
  const fuzzy = Math.min(...variants.map((variant) => fuzzyTitleScore(title, variant)));
  const compact = normalise(query).replace(/ /g, "");
  if (compact.length < 2) return fuzzy;
  // Initials of the whole title and of the part after a colon, with and
  // without small words: "The Legend of Zelda: Breath of the Wild" → "botw".
  const parts = [title, ...title.split(/[:\-–—]/).slice(1)].map((part) => normalise(part).split(" ").filter(Boolean));
  const matches = parts.some(
    (words) => words.length >= 2 && (compact === initials(words, false) || compact === initials(words, true)),
  );
  return matches ? Math.min(fuzzy, 1) : fuzzy;
}

function toCandidate(hit: SearchHit): AliasCandidate {
  return {
    id: hit.id,
    slug: hit.slug,
    name: hit.name,
    image: hit.image,
    year: hit.released?.slice(0, 4) ?? hit.releaseWindow ?? null,
  };
}

const GAMES_ONLY = { games: 6, characters: 1, companies: 1, series: 1, franchises: 1, genres: 1, platforms: 1 };

/** Top three candidate games for a zero-result query; [] without IGDB. */
export async function proposeCandidates(query: string): Promise<AliasCandidate[]> {
  if (!igdbConfigured()) return [];
  const variants = aliasVariants(query);
  const results = await Promise.all(variants.map((variant) => igdbSearchAll(variant, GAMES_ONLY).catch(() => [])));

  const seen = new Map<number, { hit: SearchHit; order: number }>();
  results.forEach((hits, variantIndex) => {
    hits.forEach((hit, index) => {
      if (hit.kind !== "game" || seen.has(hit.id)) return;
      seen.set(hit.id, { hit, order: variantIndex * 100 + index });
    });
  });

  return [...seen.values()]
    .map((entry) => ({ ...entry, score: aliasScore(entry.hit.name, query, variants) }))
    // IGDB's own order (relevance, then popularity) breaks ties.
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, 3)
    .map((entry) => toCandidate(entry.hit));
}
