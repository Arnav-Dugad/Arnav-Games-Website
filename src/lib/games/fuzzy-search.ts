/** Shared human-friendly title matching for catalogue and Firebase lists. */

const ROMAN: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5",
  vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
};

const STOP_WORDS = new Set(["a", "an", "and", "of", "the", "to"]);

/**
 * Common gaming shorthand. Several are ambiguous on purpose ("gow" is both
 * God of War and Gears of War): every expansion is searched and ranking
 * decides, rather than guessing for the reader.
 */
const QUERY_ALIASES: Record<string, string[]> = {
  ac: ["assassins creed", "animal crossing"], acnh: ["animal crossing new horizons"],
  aoe: ["age of empires"], apex: ["apex legends"], bg3: ["baldurs gate 3"], bo: ["black ops"],
  botw: ["breath of the wild"], cod: ["call of duty"], cp2077: ["cyberpunk 2077"],
  cs: ["counter strike"], csgo: ["counter strike global offensive"], d2: ["destiny 2"],
  d4: ["diablo iv"], dbd: ["dead by daylight"], dmc: ["devil may cry"], ds: ["dark souls"],
  er: ["elden ring"], ff: ["final fantasy"], fh: ["forza horizon"], fifa: ["ea sports fc"],
  gow: ["god of war", "gears of war"], gt: ["gran turismo"], gta: ["grand theft auto"],
  hk: ["hollow knight"], hl: ["half life"], hzd: ["horizon zero dawn"],
  kcd: ["kingdom come deliverance"], kh: ["kingdom hearts"], l4d: ["left 4 dead"],
  lol: ["league of legends"], loz: ["the legend of zelda"], mc: ["minecraft"],
  mgs: ["metal gear solid"], mh: ["monster hunter"], mk: ["mortal kombat"], mw: ["modern warfare"],
  nfs: ["need for speed"], nms: ["no mans sky"], ow: ["overwatch"], poe: ["path of exile"],
  pubg: ["playerunknowns battlegrounds"], rdr: ["red dead redemption"], re: ["resident evil"],
  rl: ["rocket league"], ror2: ["risk of rain 2"], sc: ["starcraft"], sf: ["street fighter"],
  smb: ["super mario bros"], ssb: ["super smash bros"], ssbu: ["super smash bros ultimate"],
  tf2: ["team fortress 2"], tlou: ["the last of us"], tloz: ["the legend of zelda"],
  totk: ["tears of the kingdom"], tw3: ["the witcher 3"], wow: ["world of warcraft"],
  xc: ["xenoblade chronicles"],
};

/** "rdr2" → expansions of "rdr" + " 2"; whole-token entries win first. */
function aliasesFor(token: string): string[] {
  if (QUERY_ALIASES[token]) return QUERY_ALIASES[token];
  const split = /^([a-z]+)(\d+)$/.exec(token);
  return split && QUERY_ALIASES[split[1]] ? QUERY_ALIASES[split[1]].map((alias) => `${alias} ${split[2]}`) : [];
}

export const EDITION_MARKERS =
  /\b(collector|deluxe|ultimate|goty|game of the year|complete|definitive|remaster|bundle|edition|pack|season pass|demo|trial|beta)\b/;

/** Canonicalises punctuation, accents, ampersands, and Roman-numeral sequels. */
export function normaliseSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((token) => ROMAN[token] ?? token)
    .join(" ");
}

/** Expands common abbreviations without changing what the user typed. */
export function searchQueryVariants(query: string): string[] {
  const normalised = normaliseSearch(query);
  if (!normalised) return [];
  const variants = new Set([normalised]);
  const tokens = normalised.split(" ");
  for (const token of tokens) {
    for (const alias of aliasesFor(token)) {
      variants.add(normaliseSearch(tokens.map((part) => part === token ? alias : part).join(" ")));
    }
  }
  return [...variants];
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const matrix = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = 0; i <= left.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }
  return matrix[left.length][right.length];
}

const ratio = (left: string, right: string) =>
  editDistance(left, right) / Math.max(left.length, right.length, 1);
const meaningful = (tokens: string[]) => tokens.filter((token) => !STOP_WORDS.has(token));
const compact = (tokens: string[]) => meaningful(tokens).join("");
const initials = (tokens: string[]) => meaningful(tokens)
  .map((token) => /^\d+$/.test(token) ? token : token[0])
  .join("");

function directTier(title: string, query: string): number {
  if (title === query) return 0;
  if (title.startsWith(`${query} `)) return 1;
  if (title.startsWith(query)) return 2;
  if (` ${title} `.includes(` ${query} `)) return 3;
  if (title.includes(query)) return 4;
  return 5;
}

/** Exact, acronym, reordered-token, alias, and typo-aware title score. */
export function fuzzyTitleScore(candidate: string, query: string): number {
  const title = normaliseSearch(candidate);
  if (!title) return 99;
  let best = 99;

  for (const variant of searchQueryVariants(query)) {
    const tier = directTier(title, variant);
    if (tier < 5) best = Math.min(best, tier);

    const titleTokens = title.split(" ");
    const queryTokens = variant.split(" ");
    if (compact(queryTokens).length >= 2 && initials(titleTokens) === compact(queryTokens)) {
      best = Math.min(best, 2.5);
    }

    const requested = meaningful(queryTokens);
    const available = meaningful(titleTokens);
    if (requested.length === 0 || available.length === 0) continue;
    const tokenCost = requested.reduce((sum, token) => sum + Math.min(
      ...available.map((titleToken) => {
        if (titleToken.startsWith(token) || token.startsWith(titleToken)) {
          const gap = Math.abs(titleToken.length - token.length);
          if (gap <= 2) return gap / Math.max(titleToken.length, token.length);
        }
        return ratio(titleToken, token);
      }),
    ), 0) / requested.length;
    const phraseCost = ratio(compact(available), compact(requested));
    const cost = Math.min(tokenCost, phraseCost);
    if (cost <= 0.48) best = Math.min(best, 6 + cost);
  }

  return best;
}

export function fuzzyMatches(candidate: string, query: string): boolean {
  return !query.trim() || fuzzyTitleScore(candidate, query) < 99;
}

/**
 * Sort key for a search result: lower is better.
 *
 * Two bands. Anything whose title actually contains, starts with or spells
 * out the query (tiers 0–4) always beats a typo-tolerant match (6+), so a
 * famous game never jumps a precise answer on popularity alone.
 *
 * Inside a band, popularity carries most of the weight and the tier only
 * nudges. Strict tier-first ordering put an obscure game literally called
 * "Zelda" above Breath of the Wild, and GTA (1997) above GTA V: an exact
 * title match is weak evidence of intent when the exact title is a game
 * almost nobody has played. Editions sit half a step down, so "Elden Ring"
 * still opens Elden Ring rather than its bundle.
 *
 * `popularity` is a raw count (IGDB ratings, or hypes before release).
 */
export function searchSortKey(score: number, isEdition: boolean, popularity: number): number {
  const band = score < 5 ? 0 : 100;
  return band + score * 0.35 + (isEdition ? 0.5 : 0) - Math.log10(1 + Math.max(0, popularity));
}
