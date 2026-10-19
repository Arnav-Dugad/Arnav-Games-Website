/**
 * Recommendations v2 — the server half (`POST /api/recommendations/v2`).
 *
 * Input is an anonymous `RecsProfile` (game ids + weights, built in the
 * browser by `buildTasteProfile`). Output is `RecommendationsV2`: explained,
 * scored, diversified groups. The maths is in `rank.ts`; this file gathers
 * candidates within a fixed request budget and turns scores into reasons.
 *
 * Pipeline and outbound requests with every cache cold (≈ 17 at worst):
 *   1. Seeds (1 IGDB multiquery): features of the liked/disliked games, their
 *      `similar_games`, series, developers and Steam appids.
 *   2. PC players only: SteamSpy tags of the two strongest Steam seeds (≤ 2,
 *      cached a day) → the best apps for their two most distinctive tags
 *      (≤ 2, cached a week).
 *   3. Candidate pool (1 IGDB multiquery of ≤ 10 queries): similar games of
 *      top seeds, same series/franchise, same developers, keyword matches,
 *      theme × genre matches, perspective × mode matches, hidden gems,
 *      upcoming hyped matches, new releases, Steam-tag neighbours. In
 *      parallel, names for the shared-feature reasons (1).
 *   4. For the ~200 best: time to beat (1, when the profile has a length),
 *      Game Pass / GeForce NOW availability (≤ 6, only for subscribers).
 *   5. Cards for the chosen games (2: games + logos).
 * Every IGDB body is day-stable, so pools are cached per seed set; the final
 * answer is cached 6 h per profile.
 */

import { unstable_cache } from "next/cache";
import { SYSTEM_NAMES } from "@/components/filters/platform-systems";
import { platformKey } from "@/lib/utils/format";
import { geForceNowRows } from "../games/cloud";
import { gfnLookup, gfnMembership } from "../games/external-rules";
import { gamePassList } from "../games/gamepass";
import { igdbCachedQuery, igdbConfigured, listGamesByIds, MAIN_GAMES } from "../games/providers/igdb";
import { externalIdsFor, timeToBeatFor } from "../games/providers/igdb-extras";
import { TTL } from "../games/providers/types";
import { steamSpyFor, steamSpyTagApps } from "../games/steamspy";
import type { GameSummary, RecReason, RecommendationsV2, RecommendedGame, RecsProfile } from "../games/types";
import { hasEnoughTaste, profileKey } from "./profile";
import {
  buildCorpus,
  clamp01,
  denseDot,
  denseTaste,
  denseToSparse,
  denseUnit,
  diversityOf,
  docToSparse,
  featureId,
  featureKey,
  featureType,
  lengthFit,
  mmr,
  popularity,
  qualityPrior,
  scoreCandidate,
  sharedFeatures,
  sortedDot,
  type DenseDoc,
  type SparseVector,
} from "./rank";

const EMPTY_DOC: DenseDoc = { idx: new Int32Array(0), w: new Float64Array(0), norm: 0 };

/* ---------------------------------------------------------------------------
 * IGDB rows
 * ------------------------------------------------------------------------ */

type Named = number | { id: number; name?: string };

interface RawGame {
  id: number;
  name?: string;
  slug?: string;
  genres?: number[];
  themes?: number[];
  keywords?: number[];
  player_perspectives?: number[];
  game_modes?: number[];
  collections?: Named[];
  franchises?: number[];
  involved_companies?: Array<{ company?: Named; developer?: boolean }>;
  platforms?: Array<{ slug?: string }>;
  first_release_date?: number;
  aggregated_rating?: number;
  aggregated_rating_count?: number;
  rating?: number;
  rating_count?: number;
  total_rating_count?: number;
  hypes?: number;
  status?: number;
  similar_games?: number[];
}

interface MultiResult {
  name: string;
  result?: unknown[];
}

const CANDIDATE_FIELDS = [
  "name",
  "slug",
  "genres",
  "themes",
  "keywords",
  "player_perspectives",
  "game_modes",
  "collections",
  "involved_companies.company",
  "involved_companies.developer",
  "platforms.slug",
  "first_release_date",
  "aggregated_rating",
  "aggregated_rating_count",
  "rating",
  "rating_count",
  "total_rating_count",
  "hypes",
  "status",
].join(",");

const SEED_FIELDS = `${CANDIDATE_FIELDS.replace("collections", "collections.name").replace("involved_companies.company", "involved_companies.company.name")},franchises,similar_games`;

/** IGDB status 6 = cancelled, 7 = rumoured, 8 = delisted: nothing to recommend. */
const DEAD_STATUS = new Set([6, 7, 8]);
const DAY = 86_400;
const NEW_WINDOW_DAYS = 120;
const GROUP_SIZE = { forYou: 20, seed: 8, gems: 10, fresh: 10, upcoming: 10, devices: 12 } as const;

/**
 * IGDB keywords that describe store features, not games ("steam trading
 * cards", "achievements", "controller support"). They sit on thousands of
 * titles and would make every reason read "Shares: steam achievements".
 * Resolved to ids once a week, shared by every profile.
 */
const JUNK_KEYWORD_NAMES = [
  "achievements", "trophies", "playstation trophies", "xbox live achievements", "in-game achievements", "controller support",
  "full controller support", "partial controller support", "cloud saves", "family sharing", "remote play", "remote play together",
  "digital distribution", "steam", "dlc", "downloadable content", "leaderboards", "online leaderboards", "microtransactions",
  "in-app purchases", "playstation plus", "xbox play anywhere", "crossplay", "cross-platform multiplayer", "ps4 pro enhanced",
  "xbox one x enhanced",
];

async function junkKeywords(): Promise<Set<number>> {
  try {
    const rows = await igdbCachedQuery<Array<{ id?: number }>>(
      "keywords",
      `fields id;
where name = (${JUNK_KEYWORD_NAMES.map((n) => `"${n}"`).join(",")}) | name ~ "steam "*;
limit 500;`,
      TTL.taxonomy,
    );
    return new Set(rows.map((r) => r.id).filter((id): id is number => typeof id === "number"));
  } catch {
    return new Set();
  }
}

const idOf = (value: Named | undefined) => (typeof value === "number" ? value : value?.id);
const nameOf = (value: Named | undefined) => (typeof value === "object" ? value?.name : undefined);
const ints = (list: number[] | undefined) => (list ?? []).filter((n) => Number.isInteger(n) && n > 0);
const todayStart = () => Math.floor(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) / 1000);

function multiquery(queries: Array<{ endpoint: string; name: string; body: string }>): Promise<MultiResult[]> {
  const body = queries.map((q) => `query ${q.endpoint} "${q.name}" {\n${q.body}\n};`).join("\n\n");
  return igdbCachedQuery<MultiResult[]>("multiquery", body, TTL.list);
}

const resultOf = <T>(results: MultiResult[], name: string): T[] => (results.find((r) => r.name === name)?.result ?? []) as T[];

/* ---------------------------------------------------------------------------
 * Model objects
 * ------------------------------------------------------------------------ */

interface Candidate {
  raw: RawGame;
  id: number;
  keys: number[];
  /** TF-IDF weights over the request's dense vocabulary (see `buildCorpus`). */
  doc: DenseDoc;
  released: boolean;
  upcoming: boolean;
  isNew: boolean;
  similarOf: number[];
  series: number | null;
  developer: number | null;
  steamTag: string | null;
  taste: number;
  quality: number;
  popularity: number;
  platform: number | null;
  platformReason: RecReason | null;
  length: number | null;
  hours: number | null;
  score: number;
}

interface Seed {
  raw: RawGame;
  weight: number;
  keys: number[];
  doc: DenseDoc;
  /** Unit dense vector; only built for the strongest liked seeds (reasons and "Because you liked"). */
  vector: Float64Array | null;
  steam: number | null;
}

function featureKeys(game: RawGame, tags: string[], tagIndex: Map<string, number>, junk: Set<number>): number[] {
  const keys: number[] = [];
  for (const id of ints(game.genres)) keys.push(featureKey("genre", id));
  for (const id of ints(game.themes)) if (id !== 42) keys.push(featureKey("theme", id));
  for (const id of ints(game.keywords)) if (!junk.has(id)) keys.push(featureKey("keyword", id));
  for (const id of ints(game.player_perspectives)) keys.push(featureKey("perspective", id));
  for (const id of ints(game.game_modes)) keys.push(featureKey("mode", id));
  for (const id of (game.collections ?? []).map(idOf)) if (id) keys.push(featureKey("series", id));
  // IGDB can list one studio twice on a game; keys must be unique per game (see documentFrequency).
  const developers = new Set<number>();
  for (const company of game.involved_companies ?? []) {
    const id = idOf(company.company);
    if (company.developer && id) developers.add(id);
  }
  for (const id of developers) keys.push(featureKey("developer", id));
  for (const tag of new Set(tags)) {
    const index = tagIndex.get(tag);
    if (index !== undefined) keys.push(featureKey("steamTag", index));
  }
  return keys;
}

/** Steam tags too broad to say anything about taste. */
const GENERIC_TAGS = new Set([
  "singleplayer", "multiplayer", "action", "adventure", "indie", "casual", "great soundtrack", "atmospheric", "story rich",
  "3d", "2d", "free to play", "early access", "co-op", "online co-op", "pvp", "third person", "first-person", "family friendly",
  "violent", "gore", "simulation", "strategy", "rpg", "fantasy", "colorful", "funny", "difficult", "controller", "replay value",
  "character customization", "multiple endings", "beautiful", "classic", "masterpiece", "sandbox",
]);

/* ---------------------------------------------------------------------------
 * Platforms
 * ------------------------------------------------------------------------ */

const FAMILY_NAMES: Record<string, string> = {
  pc: "PC",
  playstation: "PlayStation",
  xbox: "Xbox",
  nintendo: "Nintendo",
  mac: "Mac",
  linux: "Linux",
  mobile: "phone",
};

function platformFit(game: RawGame, profile: RecsProfile): { fit: number; reason: RecReason | null } {
  const owned = new Set(profile.platforms);
  const ownedFamilies = new Set(profile.platforms.map((p) => (FAMILY_NAMES[p] ? p : platformKey(p))).filter(Boolean) as string[]);
  let best: { fit: number; reason: RecReason | null } = { fit: 0, reason: null };
  for (const { slug } of game.platforms ?? []) {
    if (!slug) continue;
    const family = platformKey(slug);
    if (owned.has(slug)) return { fit: 1, reason: { kind: "platform", text: `On your ${SYSTEM_NAMES.get(slug) ?? slug}` } };
    if (family && owned.has(family) && best.fit < 0.9) best = { fit: 0.9, reason: { kind: "platform", text: `On your ${FAMILY_NAMES[family] ?? family}` } };
    // Owns a PS5, game is on PS4: same family, probably playable, said less firmly.
    if (family && ownedFamilies.has(family) && best.fit < 0.7) best = { fit: 0.7, reason: { kind: "platform", text: `On ${FAMILY_NAMES[family] ?? family}` } };
  }
  return best;
}

/* ---------------------------------------------------------------------------
 * Reasons
 * ------------------------------------------------------------------------ */

interface Lexicon {
  features: Map<number, string>;
  seedNames: Map<number, { name: string; slug: string }>;
  seriesNames: Map<number, string>;
  companyNames: Map<number, string>;
  tagNames: string[];
}

/** "Dark Fantasy" → "dark fantasy", "Open world" → "open world"; acronyms ("RPG") stay. */
const softCase = (name: string) =>
  /^[A-Z][a-z'-]*( [A-Z][a-z'-]*)*$/.test(name) ? name.toLowerCase() : /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const DAY_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function reasonsFor(
  c: Candidate,
  game: GameSummary,
  ctx: { user: SparseVector; vocab: number[]; seeds: Seed[]; lexicon: Lexicon; profile: RecsProfile },
  group: "forYou" | "seed" | "gem" | "new" | "upcoming" | "devices",
  focusSeed?: Seed,
): RecReason[] {
  const out: RecReason[] = [];
  const { lexicon } = ctx;
  const positive = ctx.seeds.filter((s) => s.weight > 0);
  const verb = (seed: Seed) => (seed.weight >= 2 ? "loved" : "liked");

  // 1. The seed it came from (or most resembles).
  const seed =
    focusSeed ??
    positive.filter((s) => c.similarOf.includes(s.raw.id)).sort((a, b) => b.weight - a.weight)[0] ??
    positive
      .slice(0, 6)
      .map((s) => ({ s, sim: s.vector ? denseDot(c.doc, s.vector) : 0 }))
      .filter((x) => x.sim > 0.3)
      .sort((a, b) => b.sim - a.sim || a.s.raw.id - b.s.raw.id)[0]?.s;
  const seedName = seed ? lexicon.seedNames.get(seed.raw.id)?.name : undefined;
  if (seed && seedName) out.push({ kind: "seed", text: `Because you ${verb(seed)} ${seedName}` });

  // 2. Series / studio ties to a liked game.
  if (c.series && lexicon.seriesNames.get(c.series)) out.push({ kind: "series", text: `More ${lexicon.seriesNames.get(c.series)}` });
  else if (c.developer && lexicon.companyNames.get(c.developer)) out.push({ kind: "developer", text: `From ${lexicon.companyNames.get(c.developer)}` });

  // 3. What it shares with their taste, in words.
  const shared = sharedFeatures(ctx.user, docToSparse(c.doc, ctx.vocab), 8)
    .filter((key) => {
      const type = featureType(key);
      return type === "keyword" || type === "theme" || type === "genre" || type === "perspective" || type === "steamTag";
    })
    .map((key) => (featureType(key) === "steamTag" ? lexicon.tagNames[featureId(key)] : lexicon.features.get(key)))
    .filter((name): name is string => Boolean(name && name.length <= 28))
    .map(softCase);
  const uniqueShared = [...new Set(shared)].slice(0, 3);
  if (uniqueShared.length > 0) out.push({ kind: "shares", text: `Shares: ${uniqueShared.join(", ")}` });

  // 4. Where they can play it.
  if (c.platformReason) {
    if (group === "devices") out.unshift(c.platformReason);
    else out.push(c.platformReason);
  }

  // 5. Release state, quality, length.
  if (group === "upcoming" || c.upcoming) {
    const when = game.released ? `Out ${DAY_FMT.format(new Date(`${game.released}T00:00:00Z`))}` : game.releaseWindow ? `Out ${game.releaseWindow}` : "Coming soon";
    out.push({ kind: "upcoming", text: when });
  } else if (group === "new" || c.isNew) {
    out.push({ kind: "new", text: game.released ? `New · ${MONTH.format(new Date(`${game.released}T00:00:00Z`))}` : "New release" });
  }
  const critic = c.raw.aggregated_rating;
  if (group === "gem" && typeof critic === "number") {
    out.push({ kind: "gem", text: `Critics: ${Math.round(critic)} · only ${c.raw.total_rating_count ?? 0} ratings on IGDB` });
  } else if (typeof critic === "number" && critic >= 85 && (c.raw.aggregated_rating_count ?? 0) >= 4) {
    out.push({ kind: "quality", text: `Critics: ${Math.round(critic)}` });
  }
  if (c.length !== null && c.length >= 0.75 && c.hours) {
    out.push({ kind: "length", text: `About ${Math.round(c.hours)} h, like the games you finish` });
  }
  if (c.steamTag && !uniqueShared.length) out.push({ kind: "steamTag", text: `Tagged ${c.steamTag} on Steam` });
  return out.slice(0, 4);
}

/* ---------------------------------------------------------------------------
 * The engine
 * ------------------------------------------------------------------------ */

function topBy<T>(entries: Map<T, number>, n: number): T[] {
  return [...entries].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([key]) => key);
}

async function compute(profile: RecsProfile): Promise<RecommendationsV2> {
  const now = todayStart();
  const personalised = hasEnoughTaste(profile);
  const seedWeights = new Map(personalised ? profile.seeds.map((s) => [s.id, s.w]) : []);
  const seedIds = [...seedWeights.keys()].sort((a, b) => a - b);

  /* 1. Seeds ------------------------------------------------------------- */
  const junkQuery = junkKeywords();
  const seedResults = seedIds.length
    ? await multiquery([
        { endpoint: "games", name: "seeds", body: `fields ${SEED_FIELDS};\nwhere id = (${seedIds.join(",")});\nlimit ${seedIds.length};` },
        {
          endpoint: "external_games",
          name: "steam",
          body: `fields game,uid;\nwhere game = (${seedIds.join(",")}) & external_game_source = 1;\nsort id asc;\nlimit 100;`,
        },
      ])
    : [];
  const steamOf = new Map<number, number>();
  for (const row of resultOf<{ game?: number; uid?: string }>(seedResults, "steam")) {
    const appid = Number(row.uid);
    if (row.game && Number.isInteger(appid) && appid > 0 && !steamOf.has(row.game)) steamOf.set(row.game, appid);
  }
  const junk = await junkQuery;
  const seedRaw = resultOf<RawGame>(seedResults, "seeds").filter((g) => g.id && g.name);
  const positiveRaw = seedRaw.filter((g) => (seedWeights.get(g.id) ?? 0) > 0).sort((a, b) => (seedWeights.get(b.id) ?? 0) - (seedWeights.get(a.id) ?? 0) || a.id - b.id);

  /* 2. SteamSpy tags (PC players) ---------------------------------------- */
  const pcPlayer = profile.platforms.length === 0 || profile.platforms.some((p) => p === "pc" || p === "win" || p === "linux" || p === "mac");
  const spySeeds = pcPlayer ? positiveRaw.filter((g) => steamOf.has(g.id)).slice(0, 2) : [];
  const spy = await Promise.all(spySeeds.map((g) => steamSpyFor(steamOf.get(g.id)!)));
  const tagVotes = new Map<string, number>();
  const seedTags = new Map<number, string[]>();
  spySeeds.forEach((g, i) => {
    const data = spy[i];
    if (!data) return;
    const total = data.tags.reduce((sum, t) => sum + t.votes, 0) || 1;
    seedTags.set(g.id, data.tags.map((t) => t.name));
    for (const tag of data.tags) {
      if (GENERIC_TAGS.has(tag.name.toLowerCase())) continue;
      tagVotes.set(tag.name, (tagVotes.get(tag.name) ?? 0) + (tag.votes / total) * (seedWeights.get(g.id) ?? 1));
    }
  });
  const tags = topBy(tagVotes, 2);
  const tagIndex = new Map(tags.map((tag, i) => [tag, i]));
  const tagApps = await Promise.all(tags.map((tag) => steamSpyTagApps(tag)));
  const appTag = new Map<string, string>();
  tags.forEach((tag, i) => tagApps[i].slice(0, 30).forEach((appid) => appTag.has(String(appid)) || appTag.set(String(appid), tag)));

  /* Query features from the seeds ---------------------------------------- */
  const seeds: Seed[] = [];
  const weighted = new Map<number, number>();
  for (const g of seedRaw) {
    const weight = seedWeights.get(g.id) ?? 0;
    const keys = featureKeys(g, seedTags.get(g.id)?.filter((t) => tagIndex.has(t)) ?? [], tagIndex, junk);
    seeds.push({ raw: g, weight, keys, doc: EMPTY_DOC, vector: null, steam: steamOf.get(g.id) ?? null });
    if (weight > 0) for (const key of new Set(keys)) weighted.set(key, (weighted.get(key) ?? 0) + weight);
  }
  const ofType = (type: Parameters<typeof featureKey>[0], n: number) =>
    topBy(new Map([...weighted].filter(([key]) => featureType(key) === type)), n).map(featureId);
  const topGenres = ofType("genre", 3);
  const topThemes = ofType("theme", 3);
  // Keywords shared by several liked games say the most; a lone game's 80 keywords say little.
  const topKeywords = topBy(new Map([...weighted].filter(([key]) => featureType(key) === "keyword" && (weighted.get(key) ?? 0) >= 1.5)), 10).map(featureId);
  const topPerspectives = ofType("perspective", 2);
  const topModes = ofType("mode", 2);
  const seriesIds = ofType("series", 8);
  const devIds = ofType("developer", 6);
  const franchiseIds = [...new Set(positiveRaw.flatMap((g) => ints(g.franchises)))].sort((a, b) => a - b).slice(0, 8);
  const similarIds = [...new Set(positiveRaw.slice(0, 10).flatMap((g) => ints(g.similar_games)))].sort((a, b) => a - b).slice(0, 150);

  /* 3. Candidate pool ---------------------------------------------------- */
  const base = `fields ${CANDIDATE_FIELDS};\nwhere ${MAIN_GAMES}`;
  const list = (ids: number[]) => ids.join(",");
  const genreOrTheme = [topGenres.length ? `genres = (${list(topGenres)})` : "", topThemes.length ? `themes = (${list(topThemes)})` : ""].filter(Boolean).join(" | ");
  const queries: Array<{ endpoint: string; name: string; body: string }> = [];
  if (similarIds.length) queries.push({ endpoint: "games", name: "similar", body: `${base} & id = (${list(similarIds)});\nlimit 150;` });
  if (seriesIds.length || franchiseIds.length) {
    const clause = [seriesIds.length ? `collections = (${list(seriesIds)})` : "", franchiseIds.length ? `franchises = (${list(franchiseIds)})` : ""].filter(Boolean).join(" | ");
    queries.push({ endpoint: "games", name: "series", body: `${base} & (${clause});\nsort total_rating_count desc;\nlimit 50;` });
  }
  if (devIds.length) {
    queries.push({ endpoint: "games", name: "devs", body: `${base} & involved_companies.company = (${list(devIds)}) & involved_companies.developer = true & total_rating_count > 5;\nsort total_rating_count desc;\nlimit 50;` });
  }
  if (topKeywords.length) {
    queries.push({ endpoint: "games", name: "keywords", body: `${base} & keywords = (${list(topKeywords)})${topGenres.length ? ` & genres = (${list(topGenres)})` : ""} & total_rating_count > 15;\nsort total_rating desc;\nlimit 60;` });
  }
  if (topThemes.length >= 1 && topGenres.length) {
    queries.push({ endpoint: "games", name: "themes", body: `${base} & themes = [${list(topThemes.slice(0, 2))}] & genres = (${list(topGenres)}) & total_rating_count > 30;\nsort total_rating desc;\nlimit 60;` });
  }
  if (topPerspectives.length && topModes.length && topGenres.length) {
    queries.push({ endpoint: "games", name: "style", body: `${base} & player_perspectives = (${list(topPerspectives)}) & game_modes = (${list(topModes)}) & genres = (${list(topGenres)}) & aggregated_rating >= 75 & total_rating_count > 15;\nsort total_rating desc;\nlimit 50;` });
  }
  const tasteFilter = genreOrTheme ? ` & (${genreOrTheme})` : "";
  queries.push({ endpoint: "games", name: "gems", body: `${base}${tasteFilter} & aggregated_rating >= 80 & aggregated_rating_count >= 3 & total_rating_count > 4 & total_rating_count < 300 & hypes < 60;\nsort aggregated_rating desc;\nlimit 60;` });
  queries.push({ endpoint: "games", name: "upcoming", body: `${base}${tasteFilter} & first_release_date > ${now + DAY} & hypes > ${personalised ? 3 : 25};\nsort hypes desc;\nlimit 60;` });
  queries.push({ endpoint: "games", name: "new", body: `${base}${tasteFilter} & first_release_date >= ${now - NEW_WINDOW_DAYS * DAY} & first_release_date < ${now + DAY} & total_rating_count > 3;\nsort total_rating_count desc;\nlimit 60;` });
  if (appTag.size > 0) {
    const uids = [...appTag.keys()].sort().map((id) => `"${id}"`).join(",");
    queries.push({
      endpoint: "games",
      name: "tagged",
      body: `fields ${CANDIDATE_FIELDS},external_games.uid,external_games.external_game_source;\nwhere ${MAIN_GAMES} & external_games.external_game_source = 1 & external_games.uid = (${uids});\nlimit 60;`,
    });
  } else if (!personalised) {
    queries.push({ endpoint: "games", name: "acclaimed", body: `${base} & aggregated_rating >= 85 & total_rating_count > 300;\nsort total_rating desc;\nlimit 80;` });
  }

  // Names for reasons, in parallel with the pool.
  const userKeywords = topBy(new Map([...weighted].filter(([key]) => featureType(key) === "keyword")), 40).map(featureId);
  const lexiconQuery = multiquery([
    { endpoint: "genres", name: "genres", body: "fields name;\nlimit 100;" },
    { endpoint: "themes", name: "themes", body: "fields name;\nlimit 100;" },
    { endpoint: "player_perspectives", name: "perspectives", body: "fields name;\nlimit 50;" },
    ...(userKeywords.length ? [{ endpoint: "keywords", name: "keywords", body: `fields name;\nwhere id = (${list([...userKeywords].sort((a, b) => a - b))});\nlimit 40;` }] : []),
  ]).catch(() => [] as MultiResult[]);
  const [pool, lexiconRows] = await Promise.all([multiquery(queries.slice(0, 10)), lexiconQuery]);

  /* Candidates ------------------------------------------------------------ */
  const blocked = new Set([...profile.exclude, ...profile.dismissed, ...seedIds]);
  const ignored = new Set(profile.ignored);
  const sources = new Map<number, Set<string>>();
  const rawById = new Map<number, RawGame>();
  for (const result of pool) {
    for (const g of (result.result ?? []) as RawGame[]) {
      if (!g?.id || !g.name || !g.slug || blocked.has(g.id) || DEAD_STATUS.has(g.status ?? 0)) continue;
      rawById.set(g.id, g);
      sources.set(g.id, (sources.get(g.id) ?? new Set()).add(result.name));
    }
  }
  if (rawById.size === 0) throw new Error("recs: empty candidate pool");

  // Which tag list put a game in the pool, via the Steam uids the tagged query echoes back.
  const tagOfGame = new Map<number, string>();
  for (const g of resultOf<RawGame & { external_games?: Array<{ uid?: string; external_game_source?: number }> }>(pool, "tagged")) {
    const tag = (g.external_games ?? []).filter((e) => e.external_game_source === 1).map((e) => appTag.get(e.uid ?? "")).find(Boolean);
    if (g.id && tag) tagOfGame.set(g.id, tag);
  }

  const similarOf = new Map<number, number[]>();
  for (const s of positiveRaw) for (const id of ints(s.similar_games)) similarOf.set(id, [...(similarOf.get(id) ?? []), s.id]);
  const candidates: Candidate[] = [];
  for (const g of rawById.values()) {
    const keys = featureKeys(g, tagOfGame.has(g.id) ? [tagOfGame.get(g.id)!] : [], tagIndex, junk);
    const date = g.first_release_date ?? null;
    const released = date !== null && date < now + DAY;
    candidates.push({
      raw: g,
      id: g.id,
      keys,
      doc: EMPTY_DOC,
      released,
      upcoming: !released && (date !== null || (g.hypes ?? 0) > 0),
      isNew: released && date !== null && date >= now - NEW_WINDOW_DAYS * DAY,
      similarOf: similarOf.get(g.id) ?? [],
      series: null,
      developer: null,
      steamTag: tagOfGame.get(g.id) ?? null,
      taste: 0,
      quality: 0,
      popularity: 0,
      platform: null,
      platformReason: null,
      length: null,
      hours: null,
      score: 0,
    });
  }
  // One vocabulary for candidates + seeds; IDF over the same set.
  const corpus = buildCorpus([...candidates.map((c) => c.keys), ...seeds.map((s) => s.keys)]);
  const size = corpus.vocab.length;
  candidates.forEach((c, i) => (c.doc = corpus.docs[i]));
  seeds.forEach((s, i) => (s.doc = corpus.docs[candidates.length + i]));
  const user = denseTaste(seeds.map((s) => ({ doc: s.doc, weight: s.weight })), size);
  const hasTaste = seeds.some((s) => s.weight !== 0);
  const strongest = seeds.filter((s) => s.weight > 0).sort((a, b) => b.weight - a.weight || a.raw.id - b.raw.id).slice(0, 6);
  for (const s of strongest) s.vector = denseUnit(s.doc, size);

  const seedSeries = new Map<number, number>();
  const seedDevs = new Map<number, number>();
  for (const s of seeds.filter((x) => x.weight > 0)) {
    for (const key of s.keys) {
      if (featureType(key) === "series") seedSeries.set(featureId(key), s.raw.id);
      if (featureType(key) === "developer") seedDevs.set(featureId(key), s.raw.id);
    }
  }
  const maxWeight = Math.max(1, ...seeds.map((s) => s.weight));
  const hasPlatforms = profile.platforms.length > 0 || profile.services.length > 0;

  const prelim = (c: Candidate) =>
    scoreCandidate({
      taste: c.taste,
      quality: c.quality,
      popularity: c.popularity,
      platform: c.platform,
      length: c.length,
      seedSimilar: Math.max(0, ...c.similarOf.map((id) => (seedWeights.get(id) ?? 0) / maxWeight)),
      sameSeries: c.series !== null,
      sameDeveloper: c.developer !== null,
      steamTag: c.steamTag !== null,
      ignored: ignored.has(c.id),
    });

  for (const c of candidates) {
    c.taste = hasTaste ? denseDot(c.doc, user) : 0;
    const r = c.raw;
    c.quality = c.released
      ? qualityPrior({ critic: r.aggregated_rating ?? null, criticCount: r.aggregated_rating_count ?? 0, user: r.rating ?? null, userCount: r.rating_count ?? 0 })
      : clamp01(Math.log10(1 + (r.hypes ?? 0)) / Math.log10(501));
    c.popularity = popularity(r.total_rating_count ?? 0, r.hypes ?? 0);
    c.series = (r.collections ?? []).map(idOf).find((id) => id !== undefined && seedSeries.has(id)) ?? null;
    c.developer = (r.involved_companies ?? []).filter((x) => x.developer).map((x) => idOf(x.company)).find((id) => id !== undefined && seedDevs.has(id)) ?? null;
    if (hasPlatforms) {
      const fit = platformFit(r, profile);
      c.platform = fit.fit;
      c.platformReason = fit.reason;
    }
    c.score = prelim(c);
  }

  /* 4. Length and cloud availability for the shortlist ------------------- */
  const shortlist = [...candidates].sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 200);
  const shortIds = shortlist.map((c) => c.id);
  const wantsGamePass = profile.services.includes("game-pass");
  const wantsGfn = profile.services.includes("geforce-now");
  const [ttb, external, gpConsole, gpPc, gfnRows] = await Promise.all([
    profile.lengthHours ? timeToBeatFor(shortIds) : null,
    wantsGamePass || wantsGfn ? externalIdsFor(shortIds) : null,
    wantsGamePass ? gamePassList("console") : null,
    wantsGamePass ? gamePassList("pc") : null,
    wantsGfn ? geForceNowRows() : null,
  ]);
  const gp = new Set([...(gpConsole ?? []), ...(gpPc ?? [])]);
  const gfn = gfnRows ? gfnLookup(gfnRows) : null;
  for (const c of shortlist) {
    const t = ttb?.get(c.id);
    c.hours = t?.normally ?? t?.hastily ?? null;
    c.length = lengthFit(c.hours, profile.lengthHours);
    const ext = external?.get(c.id);
    if ((c.platform ?? 0) < 1 && ext?.microsoft && gp.has(ext.microsoft)) {
      c.platform = 0.95;
      c.platformReason = { kind: "gamePass", text: "On Game Pass" };
    } else if ((c.platform ?? 0) < 0.9 && gfn && (ext?.steam || c.raw.name)) {
      const member = gfnMembership(gfn, { steam: ext?.steam ?? null, name: c.raw.name ?? null });
      if (member.available) {
        c.platform = 0.9;
        c.platformReason = { kind: "geforceNow", text: "Playable on GeForce NOW" };
      }
    }
    c.score = prelim(c);
  }
  shortlist.sort((a, b) => b.score - a.score || a.id - b.id);

  /* Groups --------------------------------------------------------------- */
  // Diversity compares each game's 12 strongest features; built only for games that reach a shortlist.
  const diversity = new Map<number, ReturnType<typeof diversityOf>>();
  const gist = (c: Candidate) => {
    let v = diversity.get(c.id);
    if (!v) diversity.set(c.id, (v = diversityOf(c.doc, 12)));
    return v;
  };
  const similarity = (a: Candidate, b: Candidate) => sortedDot(gist(a), gist(b));
  const pick = (items: Candidate[], k: number, lambda = 0.72) => mmr(items.slice(0, 48), k, lambda, similarity);
  const used = new Set<number>();
  const take = (items: Candidate[]) => {
    items.forEach((c) => used.add(c.id));
    return items;
  };

  const releasedRanked = shortlist.filter((c) => c.released);
  const forYou = take(pick(releasedRanked, GROUP_SIZE.forYou));
  const firstForYou = new Set(forYou.slice(0, 12).map((c) => c.id));

  const becauseYouLiked: Array<{ seed: Seed; games: Candidate[] }> = [];
  for (const seed of strongest.slice(0, 3)) {
    const seedVector = seed.vector!;
    const ranked = candidates
      .filter((c) => c.released && !becauseYouLiked.some((g) => g.games.some((x) => x.id === c.id)))
      .map((c) => ({
        ...c,
        score:
          0.55 * Math.max(0, denseDot(c.doc, seedVector)) +
          0.2 * c.quality +
          0.15 * Math.max(0, c.taste) +
          (c.similarOf.includes(seed.raw.id) ? 0.15 : 0) +
          (ignored.has(c.id) ? -0.1 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.id - b.id);
    const games = pick(ranked, GROUP_SIZE.seed, 0.75);
    if (games.length >= 3) becauseYouLiked.push({ seed, games: take(games) });
  }

  const gems = take(
    pick(
      candidates
        .filter((c) => c.released && !firstForYou.has(c.id) && (c.raw.aggregated_rating ?? 0) >= 78 && (c.raw.total_rating_count ?? 0) < 300 && (c.raw.hypes ?? 0) < 60)
        .map((c) => ({ ...c, score: 0.55 * Math.max(0, c.taste) + 0.45 * c.quality - (ignored.has(c.id) ? 0.1 : 0) }))
        .sort((a, b) => b.score - a.score || a.id - b.id),
      GROUP_SIZE.gems,
    ),
  );
  const fresh = take(pick(candidates.filter((c) => c.isNew).sort((a, b) => b.score - a.score || a.id - b.id), GROUP_SIZE.fresh + 4));
  const upcoming = take(
    pick(
      candidates
        .filter((c) => c.upcoming)
        .map((c) => ({ ...c, score: 0.6 * Math.max(0, c.taste) + 0.4 * c.quality + (c.platform === 0 ? -0.05 : 0) }))
        .sort((a, b) => b.score - a.score || a.id - b.id),
      GROUP_SIZE.upcoming,
    ),
  );
  // The top of "For you" is already on screen; this shelf shows what else they can play right now.
  const devices = hasPlatforms ? take(pick(releasedRanked.filter((c) => (c.platform ?? 0) >= 0.7 && !firstForYou.has(c.id)), GROUP_SIZE.devices)) : [];

  /* 5. Cards and reasons ------------------------------------------------- */
  // Cards are trimmed for a list response: one screenshot (the poster fallback) and no autoplay trailer.
  const cards = new Map(
    (await listGamesByIds([...used])).map((game) => [game.id, { ...game, screenshots: game.screenshots.slice(0, 1), heroTrailer: null }]),
  );
  if (cards.size === 0) throw new Error("recs: no cards");

  const lexicon: Lexicon = {
    features: new Map(),
    seedNames: new Map(seedRaw.map((g) => [g.id, { name: g.name!, slug: g.slug ?? String(g.id) }])),
    seriesNames: new Map(),
    companyNames: new Map(),
    tagNames: tags,
  };
  for (const [name, type] of [["genres", "genre"], ["themes", "theme"], ["perspectives", "perspective"], ["keywords", "keyword"]] as const) {
    for (const row of resultOf<{ id?: number; name?: string }>(lexiconRows, name)) {
      if (row.id && row.name) lexicon.features.set(featureKey(type, row.id), row.name);
    }
  }
  for (const g of seedRaw) {
    for (const col of g.collections ?? []) if (idOf(col) && nameOf(col)) lexicon.seriesNames.set(idOf(col)!, nameOf(col)!);
    for (const ic of g.involved_companies ?? []) if (idOf(ic.company) && nameOf(ic.company)) lexicon.companyNames.set(idOf(ic.company)!, nameOf(ic.company)!);
  }

  const byWeight = [...seeds].sort((a, b) => b.weight - a.weight || a.raw.id - b.raw.id);
  const ctx = { user: denseToSparse(user, corpus.vocab), vocab: corpus.vocab, seeds: byWeight, lexicon, profile };
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out = (items: Candidate[], group: Parameters<typeof reasonsFor>[3], focus?: Seed): RecommendedGame[] =>
    items.flatMap((item) => {
      const game = cards.get(item.id);
      const c = byId.get(item.id) ?? item;
      return game ? [{ game, score: Math.round(clamp01(item.score) * 1000) / 1000, reasons: reasonsFor(c, game, ctx, group, focus) }] : [];
    });

  return {
    personalised,
    forYou: out(forYou, "forYou"),
    becauseYouLiked: becauseYouLiked
      .map(({ seed, games }) => ({ seed: { id: seed.raw.id, name: seed.raw.name!, slug: seed.raw.slug ?? String(seed.raw.id) }, games: out(games, "seed", seed) }))
      .filter((group) => group.games.length >= 3),
    hiddenGems: out(gems, "gem"),
    // IGDB's first_release_date can be a 1.0 launch after years of early access; trust the card's date.
    newForYou: out(fresh, "new")
      .filter((r) => r.game.released !== null && Date.parse(`${r.game.released}T00:00:00Z`) / 1000 >= now - (NEW_WINDOW_DAYS + 30) * DAY)
      .slice(0, GROUP_SIZE.fresh),
    comingSoonForYou: out(upcoming, "upcoming"),
    onYourDevices: out(devices, "devices"),
    generatedAt: new Date().toISOString(),
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Recommendations for a validated profile, cached 6 h per profile (keyed by
 * a hash, so the cache key stays short whatever the library size). Null when
 * IGDB isn't configured or couldn't answer; failures are never cached.
 */
export async function recommendationsV2(profile: RecsProfile): Promise<RecommendationsV2 | null> {
  if (!igdbConfigured()) return null;
  const key = await sha256(profileKey(profile));
  try {
    // A wrapper per key: the profile itself stays out of the cache key.
    return await unstable_cache(() => compute(profile), ["recs-v2", "v1", key], { revalidate: 60 * 60 * 6, tags: ["recs"] })();
  } catch (err) {
    console.warn("[recs] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
