/**
 * Steam provider — the zero-configuration backend.
 *
 * Steam's storefront endpoints need no key, no account and no signup, so this
 * gives the deployed site real, current data out of the box. That is its whole
 * reason for existing: it sits between IGDB (better data, needs credentials)
 * and the bundled catalogue (no network, but static).
 *
 * Known limits, all deliberate trade-offs rather than oversights:
 *
 *  - PC only. Steam has no console data, so `parentPlatforms` is genuinely
 *    just PC/macOS/Linux — it is not pretending otherwise.
 *  - There is no public "query the whole catalogue" endpoint. Browsing is
 *    built from the storefront's own curated lists (top sellers, new releases,
 *    coming soon), which caps the reachable pool at a few hundred titles.
 *  - Listing endpoints return no dates or genres, so building a summary needs
 *    one `appdetails` call per game. Those are GETs, so Next's data cache
 *    handles them natively, and concurrency is bounded so a cold cache doesn't
 *    fan out into hundreds of simultaneous requests.
 */

import type {
  BrowseFilters,
  GameDetail,
  GameSummary,
  Page,
  Ref,
  Requirement,
  Trailer,
} from "../types";
import { REQUEST_TIMEOUT_MS, TTL, type GameProvider } from "./types";
import { slugify, stripHtml } from "@/lib/utils/html";
import { DETAIL_DEFAULTS } from "../detail";
import { releaseState } from "../release-state";
import { steamLogoFor } from "../steam-logo";

const STORE = "https://store.steampowered.com/api";
const DEFAULT_STEAM_REGION = "us";

/** Bounds how much of the storefront a browse query considers. */
const POOL_LIMIT = 60;
/** Simultaneous appdetails requests. Steam throttles aggressively above this. */
const CONCURRENCY = 6;

/* ---------------------------------------------------------------------------
 * Slugs
 *
 * Steam identifies games by numeric appid, but the app routes on slugs. Encode
 * the appid as a suffix so detail pages stay readable and still resolve
 * statelessly: "elden-ring-s1245620".
 * ------------------------------------------------------------------------ */

const APPID_SUFFIX = /-s(\d+)$/;

export function steamSlug(name: string, appid: number): string {
  const base = slugify(name) || "game";
  return `${base}-s${appid}`;
}

export function appidFromSlug(slug: string): number | null {
  const match = slug.match(APPID_SUFFIX);
  if (!match) return null;
  const appid = Number(match[1]);
  return Number.isFinite(appid) ? appid : null;
}

/* ---------------------------------------------------------------------------
 * Transport
 * ------------------------------------------------------------------------ */

async function getJson<T>(url: string, revalidate: number): Promise<T | null> {
  try {
    const res = await fetch(url, {
      next: { revalidate },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Runs `worker` over `items` with a fixed ceiling on in-flight requests. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

/* ---------------------------------------------------------------------------
 * Payload shapes
 * ------------------------------------------------------------------------ */

interface FeaturedItem {
  id: number;
  name: string;
  header_image?: string;
  large_capsule_image?: string;
  windows_available?: boolean;
  mac_available?: boolean;
  linux_available?: boolean;
}

interface FeaturedCategories {
  coming_soon?: { items?: FeaturedItem[] };
  top_sellers?: { items?: FeaturedItem[] };
  new_releases?: { items?: FeaturedItem[] };
}

interface StoreSearchResult {
  total?: number;
  items?: { id: number; name: string; tiny_image?: string; metascore?: string }[];
}

interface AppDetails {
  type?: string;
  name?: string;
  steam_appid?: number;
  short_description?: string;
  about_the_game?: string;
  detailed_description?: string;
  header_image?: string;
  capsule_image?: string;
  website?: string | null;
  developers?: string[];
  publishers?: string[];
  required_age?: number | string;
  genres?: { id?: string; description?: string }[];
  categories?: { id?: number; description?: string }[];
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
  metacritic?: { score?: number; url?: string };
  recommendations?: { total?: number };
  release_date?: { coming_soon?: boolean; date?: string };
  screenshots?: { id: number; path_thumbnail?: string; path_full?: string }[];
  movies?: {
    id: number;
    name?: string;
    thumbnail?: string;
    mp4?: { "480"?: string; max?: string };
    webm?: { "480"?: string; max?: string };
  }[];
  // Steam returns `[]` rather than an object when a platform is unsupported.
  pc_requirements?: { minimum?: string; recommended?: string } | unknown[];
  mac_requirements?: { minimum?: string; recommended?: string } | unknown[];
  linux_requirements?: { minimum?: string; recommended?: string } | unknown[];
}

/* ---------------------------------------------------------------------------
 * Release date parsing
 *
 * `release_date.date` is a localised human string, not a machine date. It may
 * be an exact day, a month, a quarter, a bare year, or marketing filler. Only
 * a real day-level match produces `released`; everything else is preserved
 * verbatim as a window so the UI shows "Q1 2026" instead of inventing a day.
 * ------------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const monthIndex = (name: string): number | null =>
  MONTHS[name.slice(0, 3).toLowerCase()] ?? null;

const pad = (value: number) => String(value).padStart(2, "0");

export function parseSteamDate(raw: string | undefined): {
  released: string | null;
  releaseWindow: string | null;
  tba: boolean;
} {
  const text = raw?.trim();
  if (!text || /^(coming soon|to be announced|tba|tbd)$/i.test(text)) {
    return { released: null, releaseWindow: null, tba: true };
  }

  // "25 Feb, 2022" / "25 February 2022"
  const dayFirst = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})$/);
  if (dayFirst) {
    const month = monthIndex(dayFirst[2]);
    if (month) {
      return {
        released: `${dayFirst[3]}-${pad(month)}-${pad(Number(dayFirst[1]))}`,
        releaseWindow: null,
        tba: false,
      };
    }
  }

  // "Feb 25, 2022"
  const monthFirst = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthFirst) {
    const month = monthIndex(monthFirst[1]);
    if (month) {
      return {
        released: `${monthFirst[3]}-${pad(month)}-${pad(Number(monthFirst[2]))}`,
        releaseWindow: null,
        tba: false,
      };
    }
  }

  // Anything coarser — "Q1 2026", "March 2026", "2027" — is kept as a window.
  return { released: null, releaseWindow: text, tba: false };
}

/* ---------------------------------------------------------------------------
 * Mapping
 * ------------------------------------------------------------------------ */

const PLATFORM_REFS: Record<"pc" | "mac" | "linux", Ref> = {
  pc: { id: 1, slug: "pc", name: "PC" },
  mac: { id: 5, slug: "mac", name: "macOS" },
  linux: { id: 6, slug: "linux", name: "Linux" },
};

function platformsOf(details: AppDetails): Ref[] {
  const out: Ref[] = [];
  if (details.platforms?.windows) out.push(PLATFORM_REFS.pc);
  if (details.platforms?.mac) out.push(PLATFORM_REFS.mac);
  if (details.platforms?.linux) out.push(PLATFORM_REFS.linux);
  return out;
}

function genresOf(details: AppDetails): Ref[] {
  return (details.genres ?? [])
    .filter((genre) => genre.description)
    .map((genre) => ({
      id: Number(genre.id) || 0,
      slug: slugify(genre.description!),
      name: genre.description!,
    }));
}

/** Steam's `required_age` is the closest thing it exposes to a content rating. */
function ageLabel(details: AppDetails): string | null {
  const age = Number(details.required_age);
  return Number.isFinite(age) && age > 0 ? `${age}+` : null;
}

function requirementsOf(details: AppDetails): Requirement[] {
  const blocks: [string, AppDetails["pc_requirements"]][] = [
    ["Windows", details.pc_requirements],
    ["macOS", details.mac_requirements],
    ["Linux", details.linux_requirements],
  ];

  const out: Requirement[] = [];
  for (const [platform, block] of blocks) {
    // Steam sends `[]` when the platform is unsupported.
    if (!block || Array.isArray(block)) continue;
    const minimum = block.minimum ? stripHtml(block.minimum) : null;
    const recommended = block.recommended ? stripHtml(block.recommended) : null;
    if (minimum || recommended) out.push({ platform, minimum, recommended });
  }
  return out;
}

function trailersOf(details: AppDetails): Trailer[] {
  return (details.movies ?? []).slice(0, 4).map((movie) => ({
    id: movie.id,
    name: movie.name?.trim() || "Trailer",
    kind: "mp4" as const,
    preview: movie.thumbnail ?? null,
    // Steam serves these over http on some records; force https so the page
    // doesn't trip mixed-content blocking.
    url: (movie.mp4?.max ?? movie.mp4?.["480"] ?? null)?.replace(/^http:/, "https:") ?? null,
  }));
}

const https = (url: string | undefined | null): string | null =>
  url ? url.replace(/^http:/, "https:") : null;

/**
 * Steam's portrait "library capsule" — a proper 600x900 poster, and by far the
 * best-looking asset Steam has for a 3:4 card.
 *
 * It is not part of the appdetails payload and is missing for a minority of
 * apps, so the URL is constructed and paired with the guaranteed 16:9 header as
 * `imageFallback`. `GameCover` swaps to the fallback on a load error, which
 * means a missing capsule costs one failed request rather than a broken image.
 */
function portraitCapsule(appid: number): string {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`;
}

function mapSummary(details: AppDetails): GameSummary | null {
  const appid = details.steam_appid;
  if (!appid || !details.name) return null;

  const release = parseSteamDate(details.release_date?.date);
  const platforms = platformsOf(details);

  return {
    id: appid,
    slug: steamSlug(details.name, appid),
    name: details.name,
    ...release,
    image: portraitCapsule(appid),
    imageFallback: https(details.header_image ?? details.capsule_image),
    // Steam publishes no aggregate user score on this endpoint, only a
    // recommendation count. Leaving `rating` at 0 hides the star rather than
    // fabricating one.
    rating: 0,
    ratingsCount: details.recommendations?.total ?? 0,
    metacritic: typeof details.metacritic?.score === "number" ? details.metacritic.score : null,
    platforms,
    parentPlatforms: platforms,
    genres: genresOf(details),
    screenshots: (details.screenshots ?? [])
      .map((shot) => https(shot.path_full ?? shot.path_thumbnail))
      .filter((url): url is string => Boolean(url)),
    esrb: ageLabel(details),
    heroTrailer: trailersOf(details).at(0) ?? null,
    // Steam publishes no popularity index comparable to IGDB's PopScore.
    popScore: null,
    playtime: 0,
    added: details.recommendations?.total ?? 0,
  };
}

function mapDetail(details: AppDetails): GameDetail | null {
  const summary = mapSummary(details);
  if (!summary) return null;

  const description = stripHtml(
    details.about_the_game || details.detailed_description || details.short_description || "",
  );

  return {
    ...summary,
    ...DETAIL_DEFAULTS,
    description,
    steamAppId: summary.id,
    website: https(details.website),
    developers: (details.developers ?? []).map((name, i) => ({
      id: i + 1,
      slug: slugify(name),
      name,
    })),
    publishers: (details.publishers ?? []).map((name, i) => ({
      id: i + 1,
      slug: slugify(name),
      name,
    })),
    tags: (details.categories ?? [])
      .filter((category) => category.description)
      .slice(0, 18)
      .map((category) => ({
        id: category.id ?? 0,
        slug: slugify(category.description!),
        name: category.description!,
      })),
    stores: [
      {
        id: summary.id,
        slug: "steam",
        name: "Steam",
        domain: "store.steampowered.com",
        url: `https://store.steampowered.com/app/${summary.id}/`,
      },
    ],
    requirements: requirementsOf(details),
    trailers: trailersOf(details),
    redditUrl: null,
    metacriticUrl: details.metacritic?.url ?? null,
    alternativeNames: [],
  };
}

/* ---------------------------------------------------------------------------
 * Fetch helpers
 * ------------------------------------------------------------------------ */

async function fetchAppDetails(
  appid: number,
  revalidate: number,
): Promise<AppDetails | null> {
  const payload = await getJson<Record<string, { success?: boolean; data?: AppDetails }>>(
    `${STORE}/appdetails?appids=${appid}&cc=${DEFAULT_STEAM_REGION}&l=english`,
    revalidate,
  );
  const entry = payload?.[String(appid)];
  if (!entry?.success || !entry.data) return null;
  // Filter out DLC, soundtracks, videos and demos — only base games belong in
  // a release database.
  if (entry.data.type && entry.data.type !== "game") return null;
  return entry.data;
}

async function summariesFor(appids: number[], revalidate: number): Promise<GameSummary[]> {
  const details = await mapWithLimit(appids, CONCURRENCY, (appid) =>
    fetchAppDetails(appid, revalidate),
  );
  const games = details
    .map((entry) => (entry ? mapSummary(entry) : null))
    .filter((game): game is GameSummary => game !== null);
  // Library logos are confirmed with a cached HEAD each (30 days), bounded
  // like the appdetails fan-out so a cold cache can't burst the CDN.
  const logos = await mapWithLimit(games, CONCURRENCY, (game) => steamLogoFor(game.id));
  return games.map((game, index) => ({ ...game, logo: logos[index] }));
}

async function fetchFeatured(): Promise<FeaturedCategories | null> {
  return getJson<FeaturedCategories>(
    `${STORE}/featuredcategories?cc=${DEFAULT_STEAM_REGION}&l=english`,
    TTL.search,
  );
}

type FeaturedKey = "coming_soon" | "top_sellers" | "new_releases";

/**
 * Several callers (trending, top rated, upcoming, related, browse) request the
 * same featured-categories URL concurrently via `Promise.all`. Next's fetch
 * deduping can hand back a shared response object to all of them, so this
 * reads defensively — an unexpected shape here degrades to "no ids found"
 * rather than throwing, since a best-effort helper should never crash its
 * caller over a malformed or partially-shared payload.
 */
async function featuredAppIds(
  keys: FeaturedKey[],
  limit: number,
): Promise<number[]> {
  const featured = await fetchFeatured();
  if (!featured || typeof featured !== "object") return [];

  const seen = new Set<number>();
  const out: number[] = [];
  for (const key of keys) {
    const bucket = featured[key];
    const items = bucket && typeof bucket === "object" ? bucket.items : undefined;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      if (item?.id && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item.id);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Provider
 * ------------------------------------------------------------------------ */

/** Steam's own storefront genre vocabulary. */
const STEAM_GENRES: Ref[] = [
  { id: 1, slug: "action", name: "Action" },
  { id: 25, slug: "adventure", name: "Adventure" },
  { id: 3, slug: "rpg", name: "RPG" },
  { id: 2, slug: "strategy", name: "Strategy" },
  { id: 28, slug: "simulation", name: "Simulation" },
  { id: 23, slug: "indie", name: "Indie" },
  { id: 4, slug: "casual", name: "Casual" },
  { id: 9, slug: "racing", name: "Racing" },
  { id: 18, slug: "sports", name: "Sports" },
  { id: 29, slug: "massively-multiplayer", name: "Massively Multiplayer" },
  { id: 37, slug: "free-to-play", name: "Free to Play" },
  { id: 70, slug: "early-access", name: "Early Access" },
];

const STEAM_PLATFORMS: Ref[] = [PLATFORM_REFS.pc, PLATFORM_REFS.mac, PLATFORM_REFS.linux];

function sortSummaries(games: GameSummary[], ordering: BrowseFilters["ordering"]): GameSummary[] {
  const out = [...games];
  const time = (game: GameSummary) => (game.released ? Date.parse(game.released) : Number.NaN);

  switch (ordering) {
    case "released":
      return out.sort((a, b) => (time(a) || Infinity) - (time(b) || Infinity));
    case "-released":
      return out.sort((a, b) => (time(b) || -Infinity) - (time(a) || -Infinity));
    case "-metacritic":
      return out.sort((a, b) => (b.metacritic ?? 0) - (a.metacritic ?? 0));
    case "metacritic":
      return out.sort((a, b) => (a.metacritic ?? 0) - (b.metacritic ?? 0));
    case "-rating":
      return out.sort((a, b) => b.rating - a.rating);
    case "rating":
      return out.sort((a, b) => a.rating - b.rating);
    case "name":
      return out.sort((a, b) => a.name.localeCompare(b.name));
    default:
      return out.sort((a, b) => b.added - a.added);
  }
}

export const steamProvider: GameProvider = {
  id: "steam",

  /** Always available — the storefront endpoints need no credentials. */
  isConfigured() {
    return true;
  },

  async browse(filters: BrowseFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = filters.pageSize ?? 24;

    // A search term maps onto a real search endpoint, so it's exact.
    if (filters.search?.trim()) {
      const found = await getJson<StoreSearchResult>(
        `${STORE}/storesearch/?term=${encodeURIComponent(filters.search.trim())}&l=english&cc=US`,
        TTL.search,
      );
      if (!found) return null;

      const all = found.items ?? [];
      const start = (page - 1) * pageSize;
      const appids = all.slice(start, start + pageSize).map((item) => item.id);
      const results = await summariesFor(appids, TTL.detail);
      return {
        results,
        // `total` counts Steam's whole match set, but only the returned window
        // is reachable — report what we can actually page through.
        count: all.length,
        hasNext: start + pageSize < all.length,
        page,
      };
    }

    // Without a search term there is no catalogue-wide query, so browse works
    // over the storefront's curated lists. The pool is capped, which is why
    // `count` reports the pool size rather than "all of Steam".
    const appids = await featuredAppIds(
      ["top_sellers", "new_releases", "coming_soon"],
      POOL_LIMIT,
    );
    if (appids.length === 0) return null;

    let pool = await summariesFor(appids, TTL.detail);
    if (pool.length === 0) return null;

    if (filters.genres) {
      const wanted = new Set(filters.genres.split(",").filter(Boolean));
      pool = pool.filter((game) => game.genres.some((genre) => wanted.has(genre.slug)));
    }
    if (filters.platforms) {
      const wanted = new Set(filters.platforms.split(",").filter(Boolean));
      pool = pool.filter((game) => game.parentPlatforms.some((p) => wanted.has(p.slug)));
    }

    const sorted = sortSummaries(pool, filters.ordering);
    const start = (page - 1) * pageSize;

    return {
      results: sorted.slice(start, start + pageSize),
      count: sorted.length,
      hasNext: start + pageSize < sorted.length,
      page,
    };
  },

  async upcoming(
    pageSize: number,
    page: number,
    filters: BrowseFilters = {},
  ): Promise<Page<GameSummary> | null> {
    const appids = await featuredAppIds(["coming_soon"], POOL_LIMIT);
    if (appids.length === 0) return null;

    const games = await summariesFor(appids, TTL.detail);
    // The storefront's "coming soon" shelf includes titles that shipped days
    // ago, so filter to genuinely future or undated entries.
    const tbaOnly = filters.releaseTiming === "tba";
    const upcoming = games.filter((game) =>
      releaseState(game) === "upcoming" && (tbaOnly ? game.tba : !game.tba),
    );
    if (upcoming.length === 0) return null;

    let pool = upcoming;
    if (filters.genres) {
      const wanted = new Set(filters.genres.split(",").filter(Boolean));
      pool = pool.filter((game) => game.genres.some((genre) => wanted.has(genre.slug)));
    }
    if (filters.platforms) {
      const wanted = new Set(filters.platforms.split(",").filter(Boolean));
      pool = pool.filter((game) => game.parentPlatforms.some((p) => wanted.has(p.slug)));
    }

    const sorted = sortSummaries(pool, filters.ordering ?? (tbaOnly ? "-added" : "released"));
    const start = (page - 1) * pageSize;
    return {
      results: sorted.slice(start, start + pageSize),
      count: sorted.length,
      hasNext: start + pageSize < sorted.length,
      page,
    };
  },

  async trending(pageSize: number) {
    const appids = await featuredAppIds(["top_sellers"], pageSize + 6);
    if (appids.length === 0) return null;
    const games = await summariesFor(appids, TTL.detail);
    return games.length > 0 ? games.slice(0, pageSize) : null;
  },

  async topRated(pageSize: number) {
    const appids = await featuredAppIds(
      ["top_sellers", "new_releases"],
      POOL_LIMIT,
    );
    if (appids.length === 0) return null;
    const games = (await summariesFor(appids, TTL.detail)).filter(
      (game) => game.metacritic !== null,
    );
    return games.length > 0
      ? sortSummaries(games, "-metacritic").slice(0, pageSize)
      : null;
  },

  async newReleases(pageSize: number) {
    const appids = await featuredAppIds(["new_releases"], pageSize + 6);
    if (appids.length === 0) return null;
    const games = await summariesFor(appids, TTL.detail);
    return games.length > 0 ? sortSummaries(games, "-released").slice(0, pageSize) : null;
  },

  async detail(slug: string) {
    const appid = appidFromSlug(slug);
    // Slugs minted by another provider simply aren't ours — fall through.
    if (appid === null) return null;
    const details = await fetchAppDetails(appid, TTL.detail);
    const detail = details ? mapDetail(details) : null;
    return detail ? { ...detail, logo: await steamLogoFor(detail.id) } : null;
  },

  async related(game: GameDetail, limit: number) {
    const appids = await featuredAppIds(["top_sellers", "new_releases"], POOL_LIMIT);
    if (appids.length === 0) return null;

    const wanted = new Set(game.genres.map((genre) => genre.slug));
    const games = await summariesFor(appids, TTL.detail);

    const scored = games
      .filter((candidate) => candidate.id !== game.id)
      .map((candidate) => ({
        candidate,
        score: candidate.genres.filter((genre) => wanted.has(genre.slug)).length,
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.candidate.added - a.candidate.added);

    return scored.slice(0, limit).map((entry) => entry.candidate);
  },

  async genres() {
    return STEAM_GENRES;
  },

  async platforms() {
    return STEAM_PLATFORMS;
  },
};

/* ---------------------------------------------------------------------------
 * Cross-provider enrichment
 * ------------------------------------------------------------------------ */

/**
 * Merges Steam data into a record that came from another provider.
 *
 * IGDB and Steam are complementary rather than competing: IGDB knows every
 * platform, has proper cover art and critic aggregates; Steam knows what a game
 * costs today and what hardware it needs. Neither publishes the other's data,
 * so a game with a Steam listing is strictly better described by both.
 *
 * The base record wins every contested field — this only fills gaps and adds
 * what Steam uniquely has. A failed or slow Steam lookup returns the original
 * untouched, so enrichment can never degrade a page that already rendered.
 */
export async function enrichWithSteam(base: GameDetail): Promise<GameDetail> {
  if (!base.steamAppId) return base;

  const details = await fetchAppDetails(base.steamAppId, TTL.detail);
  if (!details) return base;

  const steamStore = {
    id: base.steamAppId,
    slug: "steam",
    name: "Steam",
    domain: "store.steampowered.com",
    url: `https://store.steampowered.com/app/${base.steamAppId}/`,
  };

  const steamScreenshots = (details.screenshots ?? [])
    .map((shot) => https(shot.path_full ?? shot.path_thumbnail))
    .filter((url): url is string => Boolean(url));

  return {
    ...base,

    // Steam-only data — the entire point of the merge.
    requirements: base.requirements.length > 0 ? base.requirements : requirementsOf(details),
    stores: base.stores.some((store) => store.slug === "steam")
      ? base.stores
      : [...base.stores, steamStore],

    // Gap-fills. The base provider's value is kept whenever it has one.
    image: base.image ?? portraitCapsule(base.steamAppId),
    imageFallback: base.imageFallback ?? https(details.header_image ?? details.capsule_image),
    metacritic: base.metacritic ?? (details.metacritic?.score ?? null),
    screenshots: base.screenshots.length > 0 ? base.screenshots : steamScreenshots,
    trailers: base.trailers.length > 0 ? base.trailers : trailersOf(details),
    website: base.website ?? https(details.website),
    esrb: base.esrb ?? ageLabel(details),
    description: base.description || stripHtml(details.short_description ?? ""),
    metacriticUrl: base.metacriticUrl ?? (details.metacritic?.url ?? null),
  };
}
