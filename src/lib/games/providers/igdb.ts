/**
 * IGDB provider — the primary and, when configured, the only live backend.
 *
 * IGDB (Twitch/Amazon) covers ~300k games across every platform with covers,
 * artwork, screenshots, trailers, companies, engines, franchises, critic
 * aggregates, age ratings and release windows. Free tier; needs a Twitch
 * client id + secret.
 *
 * Three things shape this file:
 *
 * 1. Queries are POST with an APICalypse body. Next's fetch data cache only
 *    covers GET, so everything goes through `unstable_cache`, keyed on
 *    endpoint + body.
 *
 * 2. Failures throw rather than return null. `unstable_cache` stores whatever a
 *    function returns, so a null on an outage would be pinned in the cache for
 *    hours. Throwing leaves the cache empty; public methods catch and return
 *    null so the resolver can fall through.
 *
 * 3. The field list is *negotiated*, not assumed. IGDB has renamed several
 *    fields across API revisions (`release_dates.category` → `date_format`,
 *    `age_ratings.category`/`rating` → `organization`/`rating_category`).
 *    Requesting a field that no longer exists fails the entire query with a
 *    400 — which would silently degrade every page to whatever Steam has (or
 *    to an honest "unavailable" state if Steam has no answer either). So on
 *    first use the client probes which spelling this account's API speaks,
 *    caches the answer, and builds queries accordingly. Anything genuinely
 *    uncertain is derived instead: store links and the Steam appid come from
 *    `websites.url` hostnames rather than a category enum.
 */

import { unstable_cache } from "next/cache";
import type {
  AgeRating,
  BrowseFilters,
  CharacterRef,
  CompanyRef,
  DirectoryRef,
  GameDetail,
  GameLogo,
  GameSummary,
  LogoRef,
  MultiplayerModes,
  PlatformRef,
  Ref,
  ReleaseEvent,
  StoreRef,
  Trailer,
  WebsiteRef,
} from "../types";
import { REQUEST_TIMEOUT_MS, TTL, type GameProvider } from "./types";
import { platformKey, type PlatformKey } from "@/lib/utils/format";
import { classifyUrl, storeFromUrl } from "../stores";
import { buildDirectoryWhere, type DirectoryOrder } from "../directory";
import type { SearchHit } from "../search";
import { searchQueryVariants } from "../fuzzy-search";
import { releaseState } from "../release-state";

const API = "https://api.igdb.com/v4";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

function credentials() {
  const clientId = process.env.IGDB_CLIENT_ID?.trim();
  const clientSecret = process.env.IGDB_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function igdbConfigured(): boolean {
  return credentials() !== null;
}

/* ---------------------------------------------------------------------------
 * Auth
 * ------------------------------------------------------------------------ */

let tokenCache: { value: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

/**
 * How long Next may reuse a cached token response.
 *
 * Must not be *lower* than any route's own revalidate window. A fetch that
 * declares a shorter lifetime than the page it renders in drags the whole
 * route down to match, and because the token is fetched lazily that hit landed
 * on whichever page happened to authenticate first — one game page silently
 * revalidating every 50 minutes instead of daily, and re-querying IGDB 28×
 * more often than intended.
 *
 * A week clears the longest route window (a day) while staying far inside the
 * token's real lifetime, which Twitch currently issues at around eight weeks.
 * Freshness is governed by `tokenCache` below regardless, and a revoked token
 * self-heals through the 401 path rather than waiting this out.
 */
const TOKEN_CACHE_SECONDS = 604_800;

/**
 * Twitch distinguishes its two credential failures, and the difference is the
 * single most useful thing to know when the site goes quiet:
 *
 *   400 "invalid client"        → the client id is wrong or the app was deleted
 *   403 "invalid client secret" → the id is fine, the secret is wrong/rotated
 *
 * Both used to surface as a bare status code, so the message is preserved here
 * and mapped to an actionable hint by `igdbDiagnostics`.
 *
 * `refresh` busts the cache entry after a 401. It is part of the URL rather
 * than the body because the URL is what makes this a distinct cache key.
 */
async function fetchToken(
  clientId: string,
  clientSecret: string,
  refresh = 0,
): Promise<string> {
  const res = await fetch(refresh > 0 ? `${TOKEN_URL}?refresh=${refresh}` : TOKEN_URL, {
    method: "POST",
    // Form-encoded body is Twitch's documented form for this grant.
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    /*
     * Deliberately cached, not `no-store`.
     *
     * `/game/[slug]` is statically prerendered, and schema negotiation forces a
     * token exchange outside any `unstable_cache` boundary. A `no-store` fetch
     * opts the request out of caching "even if Request-time APIs are not
     * detected", which promotes the static route to dynamic *at runtime* — a
     * hard error in Next 16, so every affected detail page returned a 500.
     *
     * Caching is opt-in and covers POST with credentials, so `force-cache` plus
     * a lifetime is the documented way to make this request static-safe. It
     * also stops a cold lambda re-authenticating on every render.
     */
    cache: "force-cache",
    next: { revalidate: TOKEN_CACHE_SECONDS, tags: ["igdb-token"] },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res
      .json()
      .then((body: { message?: string }) => body?.message ?? "")
      .catch(() => "");
    throw new TokenError(res.status, detail);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new TokenError(res.status, "response had no access_token");

  tokenCache = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

/** Carries Twitch's status and message so callers can explain the failure. */
export class TokenError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`[igdb] token request failed: ${status}${detail ? ` — ${detail}` : ""}`);
    this.name = "TokenError";
  }
}

/** Increments on every forced refresh so each retry is its own cache entry. */
let tokenGeneration = 0;
/** Which generation the in-flight request was built for. */
let tokenInFlightGeneration = -1;

async function getToken(forceRefresh = false): Promise<string> {
  const creds = credentials();
  if (!creds) throw new Error("[igdb] not configured");

  if (forceRefresh) {
    tokenCache = null;
    tokenGeneration += 1;
  } else if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.value;
  }

  /*
   * Collapse concurrent refreshes so a cold start doesn't fire one token
   * request per in-flight render — but only across the *same* generation.
   *
   * Reusing any in-flight promise meant a forced refresh after a 401 could be
   * handed a request already in progress for the previous generation: the same
   * revoked token that caused the 401. The retry then failed identically, and
   * 401 is not in the retry set, so the provider degraded to Steam. That is
   * precisely the credential-rotation case this refresh path exists to survive.
   */
  if (!tokenInFlight || tokenInFlightGeneration !== tokenGeneration) {
    tokenInFlightGeneration = tokenGeneration;
    tokenInFlight = fetchToken(creds.clientId, creds.clientSecret, tokenGeneration).finally(
      () => {
        tokenInFlight = null;
      },
    );
  }
  return tokenInFlight;
}

/* ---------------------------------------------------------------------------
 * Transport
 * ------------------------------------------------------------------------ */

/** Carries the HTTP status so callers can tell *why* a query failed. */
export class IgdbHttpError extends Error {
  constructor(
    readonly status: number,
    readonly endpoint: string,
    readonly detail: string,
  ) {
    super(`[igdb] ${endpoint} → ${status} ${detail.slice(0, 240)}`);
    this.name = "IgdbHttpError";
  }
}

export type IgdbTransportFailure = "timeout" | "network" | "invalid-response";

/** A request that never produced a usable HTTP response. */
export class IgdbTransportError extends Error {
  constructor(
    readonly endpoint: string,
    readonly failure: IgdbTransportFailure,
    readonly attempts: number,
    readonly detail: string,
  ) {
    super(`[igdb] ${endpoint} ${failure} after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${detail}`);
    this.name = "IgdbTransportError";
  }
}

/*
 * Rate limiting.
 *
 * IGDB's free tier allows roughly four requests a second and answers anything
 * above that with a 429. Nothing here used to bound concurrency, so a single
 * homepage render (six parallel queries, each expanding covers and platforms)
 * or a `generateStaticParams` build sweep would burst straight through the
 * ceiling. Every 429 then surfaced as "IGDB can't answer", and the resolver
 * fell through to Steam — which is exactly the "everything is from Steam"
 * symptom, with working credentials the whole time.
 *
 * This is per-instance, not global, so it cannot guarantee the account-wide
 * rate. It removes the self-inflicted bursts, which are the dominant cause;
 * `retryAfter` handles whatever still slips through.
 */
const MAX_CONCURRENT = 3;
const MIN_SPACING_MS = 260;

let inFlight = 0;
let nextSlotAt = 0;
const waiting: Array<() => void> = [];

function pump() {
  while (inFlight < MAX_CONCURRENT && waiting.length > 0) {
    inFlight += 1;
    waiting.shift()!();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRateLimit<T>(run: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    waiting.push(resolve);
    pump();
  });

  // Space request *starts* so a burst of permitted-concurrency calls still
  // can't exceed the per-second ceiling.
  const now = Date.now();
  const startAt = Math.max(now, nextSlotAt);
  nextSlotAt = startAt + MIN_SPACING_MS;
  if (startAt > now) await sleep(startAt - now);

  try {
    return await run();
  } finally {
    inFlight -= 1;
    pump();
  }
}

/** How long to wait before retrying, honouring either Retry-After format. */
function retryDelayMs(res: Response | null, attempt: number): number {
  const retryAfter = res?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 5000);

    const date = Date.parse(retryAfter);
    if (Number.isFinite(date) && date > Date.now()) return Math.min(date - Date.now(), 5000);
  }

  const base = Math.min(MIN_SPACING_MS * 2 ** attempt, 4000);
  return base + Math.floor(Math.random() * Math.min(180, base / 3));
}

const MAX_ATTEMPTS = 3;

async function rawQuery<T>(endpoint: string, body: string): Promise<T> {
  const creds = credentials();
  if (!creds) throw new Error("[igdb] not configured");

  const run = async (token: string) =>
    fetch(`${API}/${endpoint}`, {
      method: "POST",
      headers: {
        "Client-ID": creds.clientId,
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
        Accept: "application/json",
      },
      body,
      // Not `no-store`: see `fetchToken`. Caching is opt-in, so an uncached
      // POST is still fetched every time — without opting the whole route out
      // of static rendering. `queryFor` provides the real caching layer.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withRateLimit(async () => {
        let response = await run(await getToken());
        // A revoked or expired token reads as 401; force a fresh one and retry.
        if (response.status === 401) {
          response = await run(await getToken(true));
        }
        return response;
      });

      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(res, attempt));
        continue;
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new IgdbHttpError(res.status, endpoint, detail);
      }

      try {
        return (await res.json()) as T;
      } catch (err) {
        throw new IgdbTransportError(
          endpoint,
          "invalid-response",
          attempt + 1,
          err instanceof Error ? err.message : String(err),
        );
      }
    } catch (err) {
      if (err instanceof IgdbHttpError) throw err;
      if (err instanceof IgdbTransportError) {
        if (err.failure === "invalid-response" && attempt < MAX_ATTEMPTS - 1) {
          await sleep(retryDelayMs(null, attempt));
          continue;
        }
        throw err;
      }

      const failure: IgdbTransportFailure =
        err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")
          ? "timeout"
          : "network";
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(null, attempt));
        continue;
      }
      throw new IgdbTransportError(
        endpoint,
        failure,
        attempt + 1,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  throw new IgdbHttpError(429, endpoint, "rate limited after retries");
}

/** One cached wrapper per TTL bucket; arguments form the rest of the key. */
const queryFor = (() => {
  const cache = new Map<number, <T>(endpoint: string, body: string) => Promise<T>>();
  return (revalidate: number) => {
    const existing = cache.get(revalidate);
    if (existing) return existing;
    const fn = unstable_cache(
      async (endpoint: string, body: string) => rawQuery<unknown>(endpoint, body),
      ["igdb", String(revalidate)],
      { revalidate, tags: ["igdb"] },
    ) as <T>(endpoint: string, body: string) => Promise<T>;
    cache.set(revalidate, fn);
    return fn;
  };
})();

/**
 * The cached, rate-limited query path, for sibling modules (`igdb-extras.ts`)
 * that need IGDB endpoints this file doesn't wrap. Same contract as every
 * query here: throws on failure, so an outage is never cached.
 */
export function igdbCachedQuery<T>(endpoint: string, body: string, revalidate: number): Promise<T> {
  return queryFor(revalidate)<T>(endpoint, body);
}

/**
 * The app access token and client id, for Twitch Helix — which accepts the
 * same app token IGDB uses. Exported so live-data code shares one token (and
 * its refresh/caching rules) instead of minting a second. Null when IGDB
 * credentials are absent or the token request fails.
 */
export async function igdbAppAuth(): Promise<{ clientId: string; token: string } | null> {
  const creds = credentials();
  if (!creds) return null;
  try {
    return { clientId: creds.clientId, token: await getToken() };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Schema negotiation
 * ------------------------------------------------------------------------ */

/**
 * Returns the first candidate field-set the API accepts.
 *
 * Probes with `limit 1` so the cost is one tiny request per field group, once
 * per server lifetime. An empty array is always the final candidate, meaning
 * "skip this data entirely" — losing one optional field is infinitely better
 * than failing every query.
 *
 * Only a 400 answers the question being asked. IGDB rejects an unknown field
 * with 400, so that genuinely means "this spelling is gone, try the next one".
 * Every other failure — 429, 5xx, a timeout — says nothing about the schema.
 * Treating those as rejection too was silently catastrophic: under rate
 * limiting all three candidates "failed", the empty set won, and the client
 * concluded IGDB had dropped `release_dates` and `age_ratings` entirely. Those
 * fields were then stripped from every query for the life of the server, so
 * release dates and age ratings vanished site-wide until the next deploy.
 * Rethrowing instead lets `schema()` discard the attempt and probe again.
 */
async function negotiate(label: string, candidates: string[][]): Promise<string[]> {
  for (const fields of candidates) {
    if (fields.length === 0) {
      console.warn(`[igdb] no supported spelling for ${label}; omitting`);
      return [];
    }
    try {
      await rawQuery("games", `fields ${fields.join(",")};\nlimit 1;`);
      return fields;
    } catch (err) {
      if (err instanceof IgdbHttpError && err.status === 400) continue;
      throw err;
    }
  }
  return [];
}

let schemaPromise: Promise<{
  release: string[];
  ageRating: string[];
  descriptors: string[];
  /** Absent from schemas cached before the field was negotiated. */
  region?: string[];
}> | null = null;

/**
 * The negotiated field set, cached across instances.
 *
 * `schemaPromise` alone is module-scoped, so every cold lambda paid three
 * sequential probe round trips before its first real query — and those are the
 * requests most likely to meet the rate limiter. Worse, a 429 during probing
 * propagated out of `summaryFields()`, failed the provider, and dropped the
 * whole site to the Steam fallback: the exact "everything is from Steam"
 * symptom, reached by a different path.
 *
 * Sharing the negotiated result through the data cache means one instance pays
 * for all of them, and only once a week.
 */
const cachedSchema = unstable_cache(
  async () => negotiateSchema(),
  // Versioned: adding a negotiated group must not wait out a week-old entry.
  ["igdb", "schema", "v2"],
  { revalidate: TTL.taxonomy, tags: ["igdb"] },
);

function schema() {
  if (!schemaPromise) {
    schemaPromise = cachedSchema().catch((err) => {
      // Never cache a rejected probe — a transient outage would otherwise
      // permanently strip these fields for the life of the server.
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function negotiateSchema() {
  return (async () => {
      // Run these tiny cold-start probes in sequence so schema detection does
      // not consume most of the per-second request budget before the real page
      // query starts.
      const release = await negotiate("release_dates", [
          [
            "release_dates.date_format",
            "release_dates.date",
            "release_dates.human",
            "release_dates.region",
            "release_dates.platform.name",
          ],
          [
            "release_dates.category",
            "release_dates.date",
            "release_dates.human",
            "release_dates.region",
            "release_dates.platform.name",
          ],
          ["release_dates.date_format", "release_dates.date", "release_dates.human"],
          ["release_dates.category", "release_dates.date", "release_dates.human"],
          [],
        ]);
      const ageRating = await negotiate("age_ratings", [
          ["age_ratings.rating_category", "age_ratings.organization"],
          ["age_ratings.category", "age_ratings.rating"],
          [],
        ]);
      // Content descriptors are a separate probe: they were renamed
      // independently of the rating fields, so pinning them to the same
      // candidate list would lose the ratings whenever the descriptors moved.
      const descriptors = await negotiate("age_rating_descriptions", [
          ["age_ratings.rating_content_descriptions.description"],
          ["age_ratings.content_descriptions.description"],
          [],
        ]);
      // The region enum moved to a `release_region` reference (same ids, 1–10)
      // and the old `region` field now comes back empty — which is why every
      // release row used to read "unspecified region". Its own probe for the
      // same reason as descriptors: it changed independently.
      const region = await negotiate("release_region", [
          ["release_dates.release_region"],
          ["release_dates.region"],
          [],
        ]);
      return { release, ageRating, descriptors, region };
    })();
}

/* ---------------------------------------------------------------------------
 * Query building
 * ------------------------------------------------------------------------ */

interface QueryParts {
  fields: string;
  where?: string;
  sort?: string;
  /** IGDB forbids combining `search` with `sort`; the builder enforces it. */
  search?: string;
  limit?: number;
  offset?: number;
}

function apicalypse(parts: QueryParts): string {
  const lines = [`fields ${parts.fields};`];
  if (parts.search) lines.push(`search "${parts.search.replace(/"/g, '\\"')}";`);
  if (parts.where) lines.push(`where ${parts.where};`);
  if (parts.sort && !parts.search) lines.push(`sort ${parts.sort};`);
  lines.push(`limit ${Math.min(parts.limit ?? 24, 500)};`);
  if (parts.offset) lines.push(`offset ${parts.offset};`);
  return lines.join("\n");
}

/** Fields present in every IGDB revision we support. */
const CORE_SUMMARY = [
  "name",
  "slug",
  "first_release_date",
  "cover.image_id",
  "screenshots.image_id",
  "genres.name",
  "genres.slug",
  "platforms.name",
  "platforms.slug",
  "platforms.abbreviation",
  "aggregated_rating",
  "aggregated_rating_count",
  "rating",
  "rating_count",
  "total_rating",
  "total_rating_count",
  "hypes",
  "status",
  // Needed by the homepage hero, which autoplays a trailer straight from a
  // list query rather than fetching each game's full record.
  "videos.video_id",
  "videos.name",
];

const CORE_DETAIL = [
  ...CORE_SUMMARY,
  "summary",
  "storyline",
  "url",
  "artworks.image_id",
  "themes.name",
  "themes.slug",
  "game_modes.name",
  "game_modes.slug",
  "player_perspectives.name",
  "player_perspectives.slug",
  "game_engines.name",
  "game_engines.slug",
  "game_engines.logo.image_id",
  "keywords.name",
  "keywords.slug",
  "franchises.name",
  "franchises.slug",
  "collections.name",
  "collections.slug",
  "collections.games",
  // Platform marks and hardware metadata, so a platform row can show real
  // logos and say what generation of hardware it is.
  "platforms.platform_logo.image_id",
  "platforms.generation",
  "platforms.category",
  "involved_companies.developer",
  "involved_companies.publisher",
  "involved_companies.porting",
  "involved_companies.supporting",
  "involved_companies.company.name",
  "involved_companies.company.slug",
  "involved_companies.company.logo.image_id",
  "involved_companies.company.websites.url",
  "parent_game.name",
  "parent_game.slug",
  "version_parent.name",
  "version_parent.slug",
  "remakes.name",
  "remakes.slug",
  "remakes.first_release_date",
  "remakes.cover.image_id",
  "remakes.total_rating",
  "remakes.aggregated_rating",
  "remasters.name",
  "remasters.slug",
  "remasters.first_release_date",
  "remasters.cover.image_id",
  "remasters.total_rating",
  "remasters.aggregated_rating",
  "ports.name",
  "ports.slug",
  "ports.first_release_date",
  "ports.cover.image_id",
  "ports.total_rating",
  "ports.aggregated_rating",
  "standalone_expansions.name",
  "standalone_expansions.slug",
  "standalone_expansions.first_release_date",
  "standalone_expansions.cover.image_id",
  "standalone_expansions.total_rating",
  "standalone_expansions.aggregated_rating",
  "alternative_names.name",
  "language_supports.language.name",
  "multiplayer_modes.campaigncoop",
  "multiplayer_modes.dropin",
  "multiplayer_modes.lancoop",
  "multiplayer_modes.offlinecoop",
  "multiplayer_modes.onlinecoop",
  "multiplayer_modes.splitscreen",
  "multiplayer_modes.onlinemax",
  "multiplayer_modes.offlinemax",
  "dlcs.name",
  "dlcs.slug",
  "dlcs.first_release_date",
  "dlcs.cover.image_id",
  "dlcs.total_rating",
  "dlcs.aggregated_rating",
  "expansions.name",
  "expansions.slug",
  "expansions.first_release_date",
  "expansions.cover.image_id",
  "expansions.total_rating",
  "expansions.aggregated_rating",
  "bundles.name",
  "bundles.slug",
  "bundles.first_release_date",
  "bundles.cover.image_id",
  "bundles.total_rating",
  "bundles.aggregated_rating",
  "similar_games.name",
  "similar_games.slug",
  "similar_games.cover.image_id",
  "similar_games.first_release_date",
  "similar_games.total_rating",
  "similar_games.aggregated_rating",
  "similar_games.genres.name",
  "similar_games.genres.slug",
  "similar_games.platforms.name",
  "similar_games.platforms.slug",
  // Store links are classified by hostname rather than a category enum, which
  // has been renamed across revisions. The URL itself never changes shape.
  "websites.url",
];

async function summaryFields(): Promise<string> {
  const { release } = await schema();
  return [...CORE_SUMMARY, ...release].join(",");
}

async function detailFields(): Promise<string> {
  const { release, ageRating, descriptors, region = [] } = await schema();
  return [...new Set([...CORE_DETAIL, ...release, ...ageRating, ...descriptors, ...region])].join(",");
}

/**
 * Excludes DLC, expansions, bundles and alternate editions.
 *
 * Filters on `parent_game` / `version_parent`, whose names have been stable
 * across revisions, rather than the `category` enum which has not.
 */
/**
 * IGDB theme 42 is "Erotic". Excluded from every list and search: about 10k
 * adult titles otherwise surface in ordinary queries ("cyberpunk" returned
 * seven). `themes != (42)` keeps games with no themes at all (verified: it
 * removes exactly the erotic count from the total).
 */
const SAFE_GAMES = "themes != (42)";

export const MAIN_GAMES = `parent_game = null & version_parent = null & ${SAFE_GAMES}`;

/**
 * Keeps collection ids from colliding with franchise ids in search results.
 *
 * They come from two different IGDB tables that both surface as
 * `kind: "franchise"`, and their id spaces overlap. Large enough to clear any
 * real id, and only ever used for React keys and cursor identity — never sent
 * back to the API.
 */
const SERIES_ID_OFFSET = 1_000_000_000;
/** Search includes DLC and expansions; alternate editions remain separate. */
const SEARCHABLE_GAMES = `version_parent = null & ${SAFE_GAMES}`;

/* ---------------------------------------------------------------------------
 * Payload shapes
 * ------------------------------------------------------------------------ */

interface IgdbNamed {
  id: number;
  name: string;
  slug?: string;
  games?: number[];
}

interface IgdbReleaseDate {
  /** Modern spelling. 0 = exact day, 1 = month, 2 = year, 3–6 = quarters, 7 = TBD. */
  date_format?: number;
  /** Legacy spelling of the same enum. */
  category?: number;
  date?: number;
  human?: string;
  /** Legacy region enum; see `RELEASE_REGIONS`. Now returned empty. */
  region?: number;
  /** Current spelling: a `release_date_regions` id with the same 1–10 values. */
  release_region?: number | { id?: number };
  platform?: IgdbNamed;
}

interface IgdbLogo {
  image_id?: string;
}

interface IgdbCompany extends IgdbNamed {
  logo?: IgdbLogo;
  websites?: { url?: string }[];
}

interface IgdbPlatform extends IgdbNamed {
  abbreviation?: string;
  platform_logo?: IgdbLogo;
  generation?: number;
  category?: number;
}

interface IgdbCharacter extends IgdbNamed {
  description?: string;
  mug_shot?: IgdbLogo;
  species?: number;
  gender?: number;
}

interface IgdbGame {
  id: number;
  name: string;
  slug: string;
  summary?: string;
  storyline?: string;
  first_release_date?: number;
  cover?: { image_id?: string };
  screenshots?: { image_id?: string }[];
  artworks?: { image_id?: string }[];
  videos?: { video_id?: string; name?: string }[];
  genres?: IgdbNamed[];
  themes?: IgdbNamed[];
  game_modes?: IgdbNamed[];
  player_perspectives?: IgdbNamed[];
  game_engines?: (IgdbNamed & { logo?: IgdbLogo })[];
  keywords?: IgdbNamed[];
  franchises?: IgdbNamed[];
  collections?: IgdbNamed[];
  platforms?: IgdbPlatform[];
  release_dates?: IgdbReleaseDate[];
  involved_companies?: {
    developer?: boolean;
    publisher?: boolean;
    porting?: boolean;
    supporting?: boolean;
    company?: IgdbCompany;
  }[];
  parent_game?: IgdbNamed;
  version_parent?: IgdbNamed;
  remakes?: IgdbGame[];
  remasters?: IgdbGame[];
  ports?: IgdbGame[];
  standalone_expansions?: IgdbGame[];
  alternative_names?: { name?: string }[];
  language_supports?: { language?: { name?: string } }[];
  multiplayer_modes?: {
    campaigncoop?: boolean;
    dropin?: boolean;
    lancoop?: boolean;
    offlinecoop?: boolean;
    onlinecoop?: boolean;
    splitscreen?: boolean;
    onlinemax?: number;
    offlinemax?: number;
  }[];
  dlcs?: IgdbGame[];
  expansions?: IgdbGame[];
  bundles?: IgdbGame[];
  similar_games?: IgdbGame[];
  websites?: { url?: string }[];
  age_ratings?: {
    rating_category?: number | { rating?: string };
    organization?: number | { name?: string };
    category?: number;
    rating?: number;
    /** Modern spelling of the descriptor list. */
    rating_content_descriptions?: { description?: string }[];
    /** Legacy spelling of the same list. */
    content_descriptions?: { description?: string }[];
  }[];
  aggregated_rating?: number;
  aggregated_rating_count?: number;
  rating?: number;
  rating_count?: number;
  total_rating?: number;
  total_rating_count?: number;
  hypes?: number;
  status?: number;
  /**
   * Not an IGDB field — attached locally from `/popularity_primitives`, which
   * is a separate endpoint keyed by game id. Carried here so the value can flow
   * through the normal mapping path.
   */
  popScore?: number;
}

interface IgdbGameVersion {
  game?: number | { id?: number };
  games?: Array<number | { id?: number }>;
}

/* ---------------------------------------------------------------------------
 * Images
 * ------------------------------------------------------------------------ */

export type IgdbImageSize =
  | "cover_small"
  | "cover_big"
  | "cover_big_2x"
  | "screenshot_med"
  | "screenshot_big"
  | "screenshot_huge"
  | "logo_med"
  | "thumb"
  | "720p"
  | "1080p";

/**
 * Company, platform and engine marks are served as PNG.
 *
 * These are transparent logos; requesting them as `.jpg` — which every other
 * IGDB asset uses — flattens the alpha onto black, so a dark logo becomes an
 * unreadable black rectangle on a dark page.
 */
const TRANSPARENT_SIZES = new Set<IgdbImageSize>(["logo_med"]);

export function igdbImage(imageId: string | null | undefined, size: IgdbImageSize): string | null {
  if (!imageId) return null;
  const extension = TRANSPARENT_SIZES.has(size) ? "png" : "jpg";
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.${extension}`;
}

/* ---------------------------------------------------------------------------
 * Game logos
 *
 * IGDB keeps wordmarks as artworks with a dedicated `artwork_type`: 5 is the
 * white mark, 7 the full-colour one, 6 the black one. They are transparent
 * masters, so they are always requested as PNG — `.jpg` would flatten the
 * alpha onto black. Lists use `t_logo_med` (284px wide, ~5 KB); hero and
 * detail use `t_720p` (1280px wide, ~25 KB), which stays crisp at full-bleed
 * hero sizes on a 2× display without the 1080p rendition's weight.
 * ------------------------------------------------------------------------ */

export type IgdbLogoSize = "logo_med" | "720p";

/** White first: it reads best on this dark UI, over cover art or not. */
const LOGO_TYPES: Array<{ type: number; tone: GameLogo["tone"] }> = [
  { type: 5, tone: "light" },
  { type: 7, tone: "color" },
  { type: 6, tone: "dark" },
];

/** Artwork rows per id are ≤ 3 in practice; 150 ids keeps a page under IGDB's 500 cap. */
const LOGO_CHUNK = 150;

interface LogoArt {
  imageId: string;
  tone: GameLogo["tone"];
  /** Index into LOGO_TYPES; lower is preferred. */
  rank: number;
}

/**
 * The preferred logo artwork for each id, in one batched query per 150 ids —
 * never one per game. Cached for a day: logos almost never change, and a
 * window at least as long as any route's keeps it from shortening a page's
 * own revalidate. Throws on failure like every other query; callers decide.
 */
async function fetchLogoArt(rawIds: number[]): Promise<Map<number, LogoArt>> {
  const ids = [...new Set(rawIds.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
  const out = new Map<number, LogoArt>();
  if (ids.length === 0) return out;

  const query = queryFor(TTL.detail);
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += LOGO_CHUNK) chunks.push(ids.slice(i, i + LOGO_CHUNK));

  const rows = (
    await Promise.all(
      chunks.map((chunk) =>
        query<Array<{ id: number; game?: number; artwork_type?: number; image_id?: string }>>(
          "artworks",
          apicalypse({
            fields: "game,artwork_type,image_id",
            where: `game = (${chunk.join(",")}) & artwork_type = (${LOGO_TYPES.map((t) => t.type).join(",")})`,
            sort: "id asc",
            limit: 500,
          }),
        ),
      ),
    )
  ).flat();

  for (const row of rows) {
    if (typeof row.game !== "number" || !row.image_id) continue;
    const rank = LOGO_TYPES.findIndex((entry) => entry.type === row.artwork_type);
    if (rank < 0) continue;
    // Rows arrive oldest-first, so among equals the original upload wins.
    const current = out.get(row.game);
    if (current && current.rank <= rank) continue;
    out.set(row.game, { imageId: row.image_id, tone: LOGO_TYPES[rank].tone, rank });
  }
  return out;
}

const logoFromArt = (art: LogoArt | undefined, size: IgdbLogoSize): GameLogo | null =>
  art
    ? {
        url: `https://images.igdb.com/igdb/image/upload/t_${size}/${art.imageId}.png`,
        tone: art.tone,
        source: "igdb",
      }
    : null;

/**
 * Returns `games` with `logo` filled from IGDB: a logo, or null when IGDB has
 * none. On a failed lookup the games come back untouched (`logo` undefined)
 * — a missing wordmark degrades to the typographic fallback, never an error.
 */
async function attachLogos<T extends GameSummary>(games: T[], size: IgdbLogoSize): Promise<T[]> {
  if (games.length === 0) return games;
  try {
    const art = await fetchLogoArt(games.map((game) => game.id));
    return games.map((game) => ({ ...game, logo: logoFromArt(art.get(game.id), size) }));
  } catch (err) {
    warn("logos", err);
    return games;
  }
}

/** Logos for a batch of IGDB ids, for callers outside the provider. */
export async function igdbLogosFor(
  ids: number[],
  size: IgdbLogoSize = "logo_med",
): Promise<Map<number, GameLogo>> {
  const out = new Map<number, GameLogo>();
  if (!igdbConfigured()) return out;
  try {
    for (const [id, art] of await fetchLogoArt(ids)) {
      const logo = logoFromArt(art, size);
      if (logo) out.set(id, logo);
    }
  } catch (err) {
    warn("logos", err);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Platform families
 * ------------------------------------------------------------------------ */

const FAMILY_IDS: Record<PlatformKey, number> = {
  pc: 1, playstation: 2, xbox: 3, nintendo: 4, mac: 5, linux: 6, mobile: 7, web: 8,
};

const FAMILY_NAMES: Record<PlatformKey, string> = {
  pc: "PC", playstation: "PlayStation", xbox: "Xbox", nintendo: "Nintendo",
  mac: "macOS", linux: "Linux", mobile: "Mobile", web: "Browser",
};

export const PLATFORM_FAMILIES: Ref[] = (
  ["pc", "playstation", "xbox", "nintendo", "mac", "linux", "mobile"] as PlatformKey[]
).map((key) => ({ id: FAMILY_IDS[key], slug: key, name: FAMILY_NAMES[key] }));

/** IGDB has its own platform vocabulary; collapse it to our icon families. */
function toFamilies(platforms: IgdbNamed[] | undefined): Ref[] {
  const seen = new Map<PlatformKey, Ref>();
  for (const platform of platforms ?? []) {
    const key = platformKey(platform.slug ?? platform.name ?? "");
    if (key && !seen.has(key)) {
      seen.set(key, { id: FAMILY_IDS[key], slug: key, name: FAMILY_NAMES[key] });
    }
  }
  return [...seen.values()];
}

const toRefs = (items: IgdbNamed[] | undefined): Ref[] =>
  (items ?? []).map((item) => ({
    id: item.id,
    slug: item.slug ?? String(item.id),
    name: item.name,
  }));

/**
 * IGDB's platform category enum.
 *
 * Only the values worth naming in the UI are mapped; anything else reads as
 * unknown rather than being guessed at.
 */
const PLATFORM_CATEGORIES: Record<number, string> = {
  1: "Console",
  2: "Arcade",
  3: "Platform",
  4: "Operating system",
  5: "Portable console",
  6: "Computer",
};

function toPlatformDetails(platforms: IgdbPlatform[] | undefined): PlatformRef[] {
  return (platforms ?? []).map((platform) => ({
    id: platform.id,
    slug: platform.slug ?? String(platform.id),
    name: platform.name,
    logo: igdbImage(platform.platform_logo?.image_id, "logo_med"),
    family: platformKey(platform.slug ?? platform.name ?? ""),
    abbreviation: platform.abbreviation ?? null,
    category:
      typeof platform.category === "number"
        ? PLATFORM_CATEGORIES[platform.category] ?? null
        : null,
    generation: typeof platform.generation === "number" ? platform.generation : null,
  }));
}

function toCompanies(game: IgdbGame): CompanyRef[] {
  const out: CompanyRef[] = [];
  for (const entry of game.involved_companies ?? []) {
    const company = entry.company;
    if (!company) continue;
    out.push({
      id: company.id,
      slug: company.slug ?? String(company.id),
      name: company.name,
      logo: igdbImage(company.logo?.image_id, "logo_med"),
      developer: Boolean(entry.developer),
      publisher: Boolean(entry.publisher),
      porting: Boolean(entry.porting),
      supporting: Boolean(entry.supporting),
      // The studio's own domain, not whichever social profile IGDB lists first.
      website: company.websites?.find((site) => site.url && !classifyUrl(site.url))?.url ?? company.websites?.[0]?.url ?? null,
    });
  }
  return out;
}

/**
 * IGDB's release region enum.
 *
 * Worth resolving rather than dropping: "out in Japan, not yet in Europe" is
 * exactly the kind of thing a release calendar exists to answer.
 */
const RELEASE_REGIONS: Record<number, string> = {
  1: "Europe",
  2: "North America",
  3: "Australia",
  4: "New Zealand",
  5: "Japan",
  6: "China",
  7: "Asia",
  8: "Worldwide",
  9: "Korea",
  10: "Brazil",
};

function releaseRegionName(entry: IgdbReleaseDate): string | null {
  const id =
    typeof entry.release_region === "number"
      ? entry.release_region
      : entry.release_region?.id ?? entry.region;
  return typeof id === "number" ? RELEASE_REGIONS[id] ?? null : null;
}

/* ---------------------------------------------------------------------------
 * Release resolution
 * ------------------------------------------------------------------------ */

const isoFromUnix = (seconds: number): string =>
  new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * Resolves a release into an exact ISO date or a human window.
 *
 * `first_release_date` carries a full timestamp even when only a quarter is
 * known, so trusting it blindly would render "Oct 1, 2026" for a game dated
 * only "Q4 2026". The `release_dates` entries carry a precision enum — under
 * either spelling — so the earliest of those wins; the bare timestamp is a last
 * resort.
 */
function resolveRelease(game: IgdbGame): {
  released: string | null;
  releaseWindow: string | null;
  tba: boolean;
} {
  const dated = (game.release_dates ?? [])
    .filter((entry) => typeof entry.date === "number")
    .sort((a, b) => (a.date ?? 0) - (b.date ?? 0));

  const earliest = dated[0];
  const precision = earliest?.date_format ?? earliest?.category;

  if (earliest && typeof precision === "number") {
    if (precision === 0 && typeof earliest.date === "number") {
      return { released: isoFromUnix(earliest.date), releaseWindow: null, tba: false };
    }
    if (precision === 7) {
      return { released: null, releaseWindow: null, tba: true };
    }
    return {
      released: null,
      releaseWindow: earliest.human?.trim() || null,
      tba: !earliest.human?.trim(),
    };
  }

  if (typeof game.first_release_date === "number") {
    return { released: isoFromUnix(game.first_release_date), releaseWindow: null, tba: false };
  }

  return { released: null, releaseWindow: null, tba: true };
}

/**
 * Every dated release, one row per region and platform.
 *
 * `resolveRelease` above collapses all of this into the single headline date a
 * card needs. This keeps the full picture for the detail page, where staggered
 * launches are genuinely interesting. Only day-level entries get an ISO date —
 * the same rule as everywhere else, so a "Q4 2026" row renders as its window
 * rather than as an invented day.
 */
function toReleaseEvents(game: IgdbGame): ReleaseEvent[] {
  const events: ReleaseEvent[] = [];

  for (const entry of game.release_dates ?? []) {
    const precision = entry.date_format ?? entry.category;
    const exact = precision === 0 && typeof entry.date === "number";
    const human = entry.human?.trim();

    // A row with neither a date nor a label says nothing worth rendering.
    if (!exact && !human) continue;

    events.push({
      date: exact ? isoFromUnix(entry.date!) : null,
      human: human || (exact ? isoFromUnix(entry.date!) : ""),
      region: releaseRegionName(entry),
      platform: entry.platform?.name ?? null,
    });
  }

  // Chronological, with undated windows last so the concrete dates lead.
  return events.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
}

/* ---------------------------------------------------------------------------
 * Age ratings
 * ------------------------------------------------------------------------ */

const ESRB_LEGACY: Record<number, string> = {
  6: "RP", 7: "EC", 8: "E", 9: "E10+", 10: "T", 11: "M", 12: "AO",
};
const PEGI_LEGACY: Record<number, string> = {
  1: "3", 2: "7", 3: "12", 4: "16", 5: "18",
};

function mapAgeRatings(game: IgdbGame): AgeRating[] {
  const out: AgeRating[] = [];
  for (const entry of game.age_ratings ?? []) {
    // Either spelling of the descriptor list; whichever the account's API
    // revision actually returned.
    const descriptors = [
      ...new Set(
        [...(entry.rating_content_descriptions ?? []), ...(entry.content_descriptions ?? [])]
          .map((item) => item.description?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    // Modern spelling expands to objects; legacy returns bare enum ids.
    const modernRating =
      typeof entry.rating_category === "object" ? entry.rating_category?.rating : undefined;
    const modernOrg =
      typeof entry.organization === "object" ? entry.organization?.name : undefined;

    if (modernRating && modernOrg) {
      out.push({ organization: modernOrg, rating: modernRating, descriptors });
      continue;
    }

    if (typeof entry.category === "number" && typeof entry.rating === "number") {
      if (entry.category === 1 && ESRB_LEGACY[entry.rating]) {
        out.push({ organization: "ESRB", rating: ESRB_LEGACY[entry.rating], descriptors });
      } else if (entry.category === 2 && PEGI_LEGACY[entry.rating]) {
        out.push({ organization: "PEGI", rating: PEGI_LEGACY[entry.rating], descriptors });
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Mapping
 * ------------------------------------------------------------------------ */

/** Drops cancelled titles, which IGDB keeps in the index with status 6. */
const CANCELLED = 6;

/** IGDB hosts no media itself — `video_id` is always a YouTube id. */
function toTrailers(game: IgdbGame): Trailer[] {
  const seen = new Set<string>();
  return (game.videos ?? [])
    .filter((video): video is { video_id: string; name?: string } => {
      if (!video.video_id || seen.has(video.video_id)) return false;
      seen.add(video.video_id);
      return true;
    })
    .map((video, index) => ({
      id: index,
      name: video.name?.trim() || "Trailer",
      kind: "youtube" as const,
      youtubeId: video.video_id!,
      preview: `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${video.video_id}`,
    }));
}

function mapSummary(game: IgdbGame): GameSummary {
  const release = resolveRelease(game);
  const ratings = mapAgeRatings(game);
  const screenshots = (game.screenshots ?? [])
    .map((shot) => igdbImage(shot.image_id, "screenshot_huge"))
    .filter((url): url is string => Boolean(url));

  return {
    id: game.id,
    slug: game.slug,
    name: game.name,
    ...release,
    image: igdbImage(game.cover?.image_id, "cover_big_2x"),
    // A minority of valid IGDB records have no cover. Real key media is a
    // stronger fallback than generated initials, even when cropped to a card.
    imageFallback: screenshots[0] ?? null,
    // IGDB user ratings are 0–100; the UI's star scale is 0–5.
    rating: typeof game.rating === "number" ? Math.round((game.rating / 20) * 10) / 10 : 0,
    ratingsCount: game.rating_count ?? 0,
    metacritic:
      typeof game.aggregated_rating === "number" ? Math.round(game.aggregated_rating) : null,
    platforms: toRefs(game.platforms),
    parentPlatforms: toFamilies(game.platforms),
    genres: toRefs(game.genres),
    screenshots,
    // Null on card-level queries and populated on detail ones, because only
    // `detailFields()` requests `age_ratings`. That is the honest result rather
    // than a bug: `mapDetail` builds on this, so the derivation has to live
    // here, and a summary genuinely does not know the rating.
    esrb: ratings.find((r) => r.organization.toUpperCase().includes("ESRB"))?.rating ?? null,
    heroTrailer: toTrailers(game).at(0) ?? null,
    popScore: typeof game.popScore === "number" ? game.popScore : null,
    playtime: 0,
    // `hypes` counts pre-release anticipation, `total_rating_count` post-release
    // engagement. Either is a reasonable popularity proxy for its lifecycle stage.
    added: game.total_rating_count ?? game.hypes ?? 0,
  };
}

/** Nested game relations only request summary fields, which is exactly enough
 * for a stable poster card without issuing one request per DLC. */
function mapRelatedGames(games: IgdbGame[] | undefined): GameSummary[] {
  return (games ?? [])
    .filter((game) => Boolean(game?.id && game?.name && game?.slug) && game.status !== CANCELLED)
    .map(mapSummary);
}

function mapDetail(game: IgdbGame): GameDetail {
  const summary = mapSummary(game);

  const companiesWhere = (predicate: (entry: NonNullable<IgdbGame["involved_companies"]>[number]) => boolean) =>
    (game.involved_companies ?? [])
      .filter((entry) => predicate(entry) && entry.company)
      .map((entry) => ({
        id: entry.company!.id,
        slug: entry.company!.slug ?? String(entry.company!.id),
        name: entry.company!.name,
      }));

  const trailers = toTrailers(game);

  // Summary and storyline answer different questions and have dedicated UI.
  // Fall back to the storyline only when IGDB has no summary, without then
  // rendering the same prose twice on the page.
  const summaryText = game.summary?.trim() || "";
  const storylineText = game.storyline?.trim() || "";
  const description = summaryText || storylineText;

  // Websites are classified by hostname, which is stable across API revisions
  // and also yields the Steam appid without a separate lookup.
  const websites: WebsiteRef[] = [];
  const stores: StoreRef[] = [];
  let steamAppId: number | null = null;
  let officialSite: string | null = null;

  for (const site of game.websites ?? []) {
    if (!site.url) continue;
    const classified = storeFromUrl(site.url);
    if (classified) {
      if (!stores.some((s) => s.slug === classified.slug)) {
        stores.push({
          id: stores.length + 1,
          slug: classified.slug,
          name: classified.name,
          domain: classified.domain,
          url: site.url,
        });
      }
      if (classified.slug === "steam" && classified.steamAppId) {
        steamAppId = classified.steamAppId;
      }
    } else if (!officialSite && !classifyUrl(site.url)) {
      // Socials and wikis are known hosts too; only an unrecognised domain is
      // the publisher's own site (Elden Ring's "Website" read "twitch.tv").
      officialSite = site.url;
    }
    websites.push({ kind: classified?.slug ?? "official", url: site.url });
  }

  const multiplayer = game.multiplayer_modes?.[0];
  const multiplayerModes: MultiplayerModes | null = multiplayer
    ? {
        campaignCoop: Boolean(multiplayer.campaigncoop),
        dropIn: Boolean(multiplayer.dropin),
        lanCoop: Boolean(multiplayer.lancoop),
        offlineCoop: Boolean(multiplayer.offlinecoop),
        onlineCoop: Boolean(multiplayer.onlinecoop),
        splitScreen: Boolean(multiplayer.splitscreen),
        onlineMax: multiplayer.onlinemax ?? null,
        offlineMax: multiplayer.offlinemax ?? null,
      }
    : null;
  const artworks = (game.artworks ?? [])
    .map((art) => igdbImage(art.image_id, "1080p"))
    .filter((url): url is string => Boolean(url));

  return {
    ...summary,
    imageFallback: summary.imageFallback ?? artworks[0] ?? null,
    description,
    storyline: summaryText && storylineText ? storylineText : null,
    steamAppId,
    website: officialSite,
    companies: toCompanies(game),
    developers: companiesWhere((entry) => Boolean(entry.developer)),
    publishers: companiesWhere((entry) => Boolean(entry.publisher)),
    supportingStudios: companiesWhere(
      (entry) => Boolean(entry.porting) || Boolean(entry.supporting),
    ),
    tags: [...toRefs(game.themes), ...toRefs(game.game_modes)].slice(0, 18),
    themes: toRefs(game.themes),
    gameModes: toRefs(game.game_modes),
    playerPerspectives: toRefs(game.player_perspectives),
    engines: (game.game_engines ?? []).map((engine) => ({
      id: engine.id,
      slug: engine.slug ?? String(engine.id),
      name: engine.name,
      logo: igdbImage(engine.logo?.image_id, "logo_med"),
    })),
    series: toRefs(
      (game.collections ?? []).filter((collection) => (collection.games?.length ?? 0) >= 2),
    ),
    franchises: toRefs(game.franchises),
    keywords: toRefs(game.keywords).slice(0, 24),
    ageRatings: mapAgeRatings(game),
    languages: [
      ...new Set(
        (game.language_supports ?? [])
          .map((entry) => entry.language?.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ],
    multiplayerModes,
    artworks,
    platformDetails: toPlatformDetails(game.platforms),
    releases: toReleaseEvents(game),
    // Filled by `detail()`, which fetches the cast separately — characters are
    // their own IGDB endpoint rather than an expandable field on a game.
    characters: [],
    dlcs: mapRelatedGames(game.dlcs),
    expansions: mapRelatedGames(game.expansions),
    standaloneExpansions: mapRelatedGames(game.standalone_expansions),
    // Filled from the dedicated game_versions endpoint in detail().
    editions: [],
    bundles: mapRelatedGames(game.bundles),
    remakes: mapRelatedGames(game.remakes),
    remasters: mapRelatedGames(game.remasters),
    ports: mapRelatedGames(game.ports),
    parentGame: game.parent_game || game.version_parent
      ? {
          id: (game.parent_game ?? game.version_parent)!.id,
          slug:
            (game.parent_game ?? game.version_parent)!.slug ??
            String((game.parent_game ?? game.version_parent)!.id),
          name: (game.parent_game ?? game.version_parent)!.name,
        }
      : null,
    similar: (game.similar_games ?? [])
      .filter((candidate) => candidate?.slug && candidate.status !== CANCELLED)
      .map(mapSummary),
    totalRating:
      typeof game.total_rating === "number" ? Math.round(game.total_rating) : null,
    criticCount:
      typeof game.aggregated_rating_count === "number" ? game.aggregated_rating_count : null,
    hypes: game.hypes ?? 0,
    websites,
    stores,
    requirements: [],
    trailers,
    redditUrl: null,
    metacriticUrl: null,
    alternativeNames: (game.alternative_names ?? [])
      .map((entry) => entry.name)
      .filter((name): name is string => Boolean(name)),
  };
}

/* ---------------------------------------------------------------------------
 * Taxonomy
 * ------------------------------------------------------------------------ */

async function fetchGenres(): Promise<Ref[]> {
  const query = queryFor(TTL.taxonomy);
  const rows = await query<IgdbNamed[]>(
    "genres",
    apicalypse({ fields: "name,slug", sort: "name asc", limit: 60 }),
  );
  return toRefs(rows);
}

async function fetchThemes(): Promise<Ref[]> {
  const query = queryFor(TTL.taxonomy);
  const rows = await query<IgdbNamed[]>(
    "themes",
    apicalypse({ fields: "name,slug", sort: "name asc", limit: 60 }),
  );
  return toRefs(rows);
}

async function fetchPlatformIndex(): Promise<IgdbNamed[]> {
  const query = queryFor(TTL.taxonomy);
  return query<IgdbNamed[]>(
    "platforms",
    apicalypse({ fields: "name,slug,abbreviation", sort: "name asc", limit: 500 }),
  );
}

async function platformIdsForFamilies(slugs: string[]): Promise<number[]> {
  const index = await fetchPlatformIndex();
  const wanted = new Set(slugs);
  return index
    .filter((platform) => {
      const key = platformKey(platform.slug ?? platform.name ?? "");
      return wanted.has(platform.slug ?? "") || (key !== null && wanted.has(key));
    })
    .map((platform) => platform.id);
}

async function genreIdsForSlugs(slugs: string[]): Promise<number[]> {
  const genres = await fetchGenres();
  const wanted = new Set(slugs);
  return genres.filter((genre) => wanted.has(genre.slug)).map((genre) => genre.id);
}

/* ---------------------------------------------------------------------------
 * Characters
 * ------------------------------------------------------------------------ */

/** IGDB's gender and species enums, resolved only where the label is useful. */
const CHARACTER_GENDERS: Record<number, string> = { 0: "Male", 1: "Female", 2: "Other" };
const CHARACTER_SPECIES: Record<number, string> = {
  1: "Human", 2: "Alien", 3: "Animal", 4: "Android", 5: "Unknown",
};

/**
 * The named cast of a game.
 *
 * Characters are their own endpoint keyed by game, not an expandable field, so
 * this is a second request. Sorted by whether they have a portrait first —
 * a cast row of blank silhouettes is worse than a shorter one with faces.
 */
async function fetchCharacters(gameId: number): Promise<CharacterRef[]> {
  const query = queryFor(TTL.detail);
  const rows = await query<IgdbCharacter[]>(
    "characters",
    apicalypse({
      fields: "name,slug,description,mug_shot.image_id,species,gender",
      where: `games = (${gameId})`,
      limit: 500,
    }),
  );

  return rows
    .map((row) => ({
      id: row.id,
      slug: row.slug ?? String(row.id),
      name: row.name,
      description: row.description?.trim() || null,
      image: igdbImage(row.mug_shot?.image_id, "thumb"),
      species: typeof row.species === "number" ? CHARACTER_SPECIES[row.species] ?? null : null,
      gender: typeof row.gender === "number" ? CHARACTER_GENDERS[row.gender] ?? null : null,
    }))
    .sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)));
}

/* ---------------------------------------------------------------------------
 * PopScore
 * ------------------------------------------------------------------------ */

/**
 * IGDB's popularity signals, recomputed every 24 hours.
 *
 * `popularity_primitives` carries one row per game per *type*, and the types
 * are not interchangeable. Verified against the live API:
 *
 *   1 "Visits"            unusable — tops out on shovelware nobody has heard
 *                         of, so ordering by it fills a shelf with junk
 *   2 "Want to Play"      anticipation: Cyberpunk 2077, GTA VI, Elden Ring
 *   3 "Playing"           current activity: Roblox, GTA V, Minecraft, Fortnite
 *   4 "Played"            all-time completion, effectively a classics list
 *   5 "24hr Peak Players" Steam concurrents: Counter-Strike 2, PUBG
 *
 * `value` is a normalised float well below 1, not a count, so it is only ever
 * meaningful as an *ordering*. It is deliberately never shown to the reader:
 * "0.004" answers no question anyone has.
 */
const POPULARITY = {
  /** What people are playing now — the honest basis for "trending". */
  playing: 3,
  /** What people are waiting for. */
  wantToPlay: 2,
  /** All-time completions; effectively a canon/classics list. */
  played: 4,
  /** Steam concurrents over 24h — the sharpest "hot right now" signal there is. */
  steamPeak: 5,
  /** Steam's global top sellers. */
  steamTopSellers: 9,
  /** Steam's most-wishlisted upcoming titles. */
  steamWishlisted: 10,
} as const;

type PopularityType = (typeof POPULARITY)[keyof typeof POPULARITY];

/**
 * Returns an empty map on any failure. Popularity is an ordering hint, never a
 * reason to fail a page.
 */
async function fetchPopScores(
  gameIds: number[],
  revalidate: number = TTL.list,
): Promise<Map<number, number>> {
  if (gameIds.length === 0) return new Map();

  try {
    const query = queryFor(revalidate);
    const rows = await query<{ game_id?: number; value?: number }[]>(
      "popularity_primitives",
      apicalypse({
        fields: "game_id,value",
        where: `game_id = (${gameIds.join(",")}) & popularity_type = ${POPULARITY.playing}`,
        sort: "value desc",
        limit: Math.min(gameIds.length, 500),
      }),
    );

    const scores = new Map<number, number>();
    for (const row of rows) {
      // Kept as the raw float: rounding a value of 0.004 to an integer erases
      // the entire signal, which is what made every score read as zero.
      if (typeof row.game_id === "number" && typeof row.value === "number") {
        scores.set(row.game_id, row.value);
      }
    }
    return scores;
  } catch (err) {
    warn("popularity", err);
    return new Map();
  }
}

/**
 * The most popular games right now, best-first, for a given signal.
 *
 * This is the honest basis for a "trending" shelf: it reflects what people are
 * doing this week, rather than a rating count that took years to accumulate and
 * therefore never changes.
 */
async function fetchPopularGameIds(
  limit: number,
  type: PopularityType = POPULARITY.playing,
): Promise<number[]> {
  const query = queryFor(TTL.list);
  const rows = await query<{ game_id?: number }[]>(
    "popularity_primitives",
    apicalypse({
      fields: "game_id,value",
      where: `popularity_type = ${type}`,
      sort: "value desc",
      limit,
    }),
  );
  return rows
    .map((row) => row.game_id)
    .filter((id): id is number => typeof id === "number");
}

/* ---------------------------------------------------------------------------
 * Provider
 * ------------------------------------------------------------------------ */

/**
 * Today at 00:00 UTC, in seconds.
 *
 * Every bound that goes into a *query body* must be day-aligned like this, and
 * never a second-granular `Date.now()`. `queryFor` keys `unstable_cache` on the
 * endpoint and the body, so a timestamp that moves every second makes the key
 * unique on every single render — the cache hit rate for that query is then
 * exactly zero, and each render fires a fresh IGDB request while accumulating
 * single-use cache entries. `newReleases` sits on the home page, so that was one
 * guaranteed uncached round trip per home-page visit.
 *
 * Rounding to the day keeps the key stable for 24 hours, which is exactly what
 * these "released in the last N days" windows actually mean.
 */
const todayStartSeconds = () =>
  Math.floor(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) / 1000);

/** Day-aligned offset from today, for use in cacheable query bodies. */
const daysFromNow = (days: number) => todayStartSeconds() + days * 86_400;

/** Tomorrow at 00:00 UTC — a day-stable upper bound for "already released". */
const todayEndSeconds = () => todayStartSeconds() + 86_400;

const usable = (games: IgdbGame[]) => games.filter((game) => game.status !== CANCELLED);

/**
 * Every list path funnels through here, so this is also where wordmarks are
 * attached: one batched `artworks` query per result set.
 */
async function listGames(
  parts: Omit<QueryParts, "fields">,
  revalidate: number,
  logoSize: IgdbLogoSize = "logo_med",
) {
  const query = queryFor(revalidate);
  const rows = await query<IgdbGame[]>(
    "games",
    apicalypse({ ...parts, fields: await summaryFields() }),
  );
  return attachLogos(usable(rows).map(mapSummary), logoSize);
}

/**
 * Loads every game linked by an IGDB relationship.
 *
 * A single IGDB request is capped at 500 records. Series, franchises and
 * prolific studios can exceed that, so relationship ids must be chunked
 * instead of silently slicing the catalogue to a UI-sized number.
 */
export async function listGamesByIds(
  rawIds: number[],
  order: "release-desc" | "popularity" = "release-desc",
): Promise<GameSummary[]> {
  const ids = [...new Set(rawIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return [];

  const chunks: number[][] = [];
  for (let index = 0; index < ids.length; index += 450) {
    chunks.push(ids.slice(index, index + 450));
  }

  const pages = await Promise.all(
    chunks.map((chunk) =>
      listGames(
        {
          where: `id = (${chunk.join(",")})`,
          limit: chunk.length,
        },
        TTL.detail,
      ),
    ),
  );

  const games = pages.flat();
  return games.sort((a, b) => {
    if (order === "popularity") {
      const engagement = b.added - a.added;
      if (engagement !== 0) return engagement;
    }
    const release = (b.released ?? "0000").localeCompare(a.released ?? "0000");
    return release || a.name.localeCompare(b.name);
  });
}

/** True alternate editions from IGDB's dedicated version relationship. */
async function fetchEditions(gameId: number): Promise<GameSummary[]> {
  const query = queryFor(TTL.detail);
  const rows = await query<IgdbGameVersion[]>(
    "game_versions",
    apicalypse({
      fields: "game,games",
      where: `(game = ${gameId} | games = (${gameId}))`,
      limit: 500,
    }),
  );
  const ids = [
    ...new Set(
      rows
        .flatMap((row) => row.games ?? [])
        .map((entry) => (typeof entry === "number" ? entry : entry.id))
        .filter((id): id is number => typeof id === "number" && id !== gameId),
    ),
  ];
  if (ids.length === 0) return [];
  return listGamesByIds(ids);
}

async function countGames(where: string, revalidate: number): Promise<number> {
  const query = queryFor(revalidate);
  const result = await query<{ count?: number }>("games/count", `where ${where};`);
  return result?.count ?? 0;
}

/** Total number of main games in IGDB. Surfaced on the homepage. */
export async function igdbTotalGames(): Promise<number | null> {
  if (!igdbConfigured()) return null;
  try {
    return await countGames(MAIN_GAMES, TTL.taxonomy);
  } catch (err) {
    warn("count", err);
    return null;
  }
}

function sortClause(ordering: BrowseFilters["ordering"]): string | undefined {
  switch (ordering) {
    case "released":
      return "first_release_date asc";
    case "-released":
      return "first_release_date desc";
    case "-rating":
      return "total_rating desc";
    case "rating":
      return "total_rating asc";
    case "-metacritic":
      return "aggregated_rating desc";
    case "metacritic":
      return "aggregated_rating asc";
    case "name":
      return "name asc";
    case "-name":
      return "name desc";
    case "-hypes":
      return "hypes desc";
    case "hypes":
      return "hypes asc";
    case "-reviews":
      return "total_rating_count desc";
    case "-added":
    default:
      return "total_rating_count desc";
  }
}

/** Filter clauses shared by browse and the upcoming calendar. */
async function buildWhere(filters: BrowseFilters): Promise<string | null> {
  const clauses = [MAIN_GAMES];

  /*
   * Both taxonomy lookups start together.
   *
   * They are separate queries against different endpoints and neither depends
   * on the other, but awaiting them in sequence put a filtered browse four
   * round trips deep before its main query had even been built.
   */
  const [genreIds, platformIds] = await Promise.all([
    filters.genres
      ? genreIdsForSlugs(filters.genres.split(",").filter(Boolean))
      : Promise.resolve(null),
    filters.platforms
      ? platformIdsForFamilies(filters.platforms.split(",").filter(Boolean))
      : Promise.resolve(null),
  ]);

  if (genreIds !== null) {
    if (genreIds.length === 0) return null;
    clauses.push(`genres = (${genreIds.join(",")})`);
  }

  if (platformIds !== null) {
    if (platformIds.length === 0) return null;
    clauses.push(`platforms = (${platformIds.join(",")})`);
  }

  if (filters.dates) {
    const [from, to] = filters.dates.split(",");
    const toUnix = (value: string) => Math.floor(Date.parse(`${value}T00:00:00Z`) / 1000);
    if (!from || !to || !Number.isFinite(toUnix(from)) || !Number.isFinite(toUnix(to))) return null;
    clauses.push(
      `first_release_date >= ${toUnix(from)} & first_release_date <= ${toUnix(to)}`,
    );
  }

  if (filters.metacritic) {
    const [lo, hi] = filters.metacritic.split(",").map(Number);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi > 100 || lo > hi) return null;
    clauses.push(`aggregated_rating >= ${lo} & aggregated_rating <= ${hi}`);
  }

  if (filters.notableOnly) {
    // `hypes` counts pre-release follows, which is the only audience signal an
    // unreleased game has. Requiring a cover as well removes the placeholder
    // records that carry a date and nothing else.
    clauses.push("hypes > 0 & cover != null");
  }

  return clauses.join(" & ");
}

/** Strips punctuation and case so "Marvel's Spider-Man" matches "marvels spiderman". */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Titles that are an *edition of* something rather than a distinct game.
 *
 * IGDB indexes these as full records, so a search for "elden ring" returns the
 * Collector's Edition and the Tarnished Edition alongside the game itself. They
 * are legitimate results, just never the one someone means first.
 */
const EDITION_MARKERS =
  /\b(collector|deluxe|ultimate|goty|game of the year|complete|definitive|remaster|bundle|edition|pack|season pass|demo|trial|beta)\b/;

/** How well one string answers the query. Lower is better. */
function matchTier(candidate: string, q: string): number {
  const n = normalise(candidate);
  if (!n) return 5;
  if (n === q) return 0;
  if (n.startsWith(`${q} `)) return 1;
  if (n.startsWith(q)) return 2;
  if (new RegExp(`\\b${escapeRegExp(q)}\\b`).test(n)) return 3;
  if (n.includes(q)) return 4;
  return 5;
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);
  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        current[j] = Math.min(current[j], previous[j - 2] + 1);
      }
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

const distanceRatio = (left: string, right: string) =>
  editDistance(left, right) / Math.max(left.length, right.length, 1);

/** Exact, acronym, and typo-aware title score. Lower is better. */
export function fuzzyTitleScore(candidate: string, query: string): number {
  const title = normalise(candidate);
  const q = normalise(query);
  if (!title || !q) return 99;
  const tier = matchTier(title, q);
  if (tier < 5) return tier;

  const titleTokens = title.split(" ").filter(Boolean);
  const queryTokens = q.split(" ").filter(Boolean);
  const initials = titleTokens.map((token) => token[0]).join("");
  const compactQuery = queryTokens.join("");
  if (compactQuery.length >= 2 && initials === compactQuery) return 2.5;

  const tokenCost = queryTokens.reduce((sum, token) => {
    return sum + Math.min(...titleTokens.map((candidateToken) => distanceRatio(candidateToken, token)));
  }, 0) / Math.max(queryTokens.length, 1);
  const phraseCost = distanceRatio(titleTokens.slice(0, queryTokens.length).join(""), compactQuery);
  const cost = Math.min(tokenCost, phraseCost);
  return cost <= 0.45 ? 6 + cost : 99;
}

/**
 * Re-ranks IGDB search results against the query the reader actually typed.
 *
 * IGDB's own `search` ordering routinely puts editions, bundles and loosely
 * related titles above the obvious answer, and it cannot be combined with
 * `sort`, so ranking has to happen here.
 *
 * Strongest signal first: an exact title match, then a prefix, then whole-word
 * containment, then a loose substring. Alternative names are scored too and the
 * best of the two wins, which is what makes "GTA V" find "Grand Theft Auto V"
 * and "FF7" find "Final Fantasy VII".
 *
 * Popularity only ever breaks ties within a tier — letting it cross tiers is
 * the usual failure mode of naive relevance sorting, where a famous unrelated
 * game outranks the precise answer. Editions are demoted one step for the same
 * reason: "Elden Ring" should outrank "Elden Ring: Collector's Edition", but
 * still beat an unrelated title.
 */
export function rankSearchResults(
  games: GameSummary[],
  query: string,
  /** Alternative titles per game id, when the caller fetched them. */
  altNames?: Map<number, string[]>,
): GameSummary[] {
  const q = normalise(query);
  if (!q) return games;

  const scoreOf = (game: GameSummary): number => {
    const candidates = [game.name, ...(altNames?.get(game.id) ?? [])];
    const best = Math.min(...candidates.map((name) => fuzzyTitleScore(name, q)));
    // An edition is a worse answer than the plain title at the same tier, but
    // must not fall below a genuinely weaker match.
    const isEdition = EDITION_MARKERS.test(normalise(game.name)) && !EDITION_MARKERS.test(q);
    return best * 2 + (isEdition ? 1 : 0);
  };

  return [...games]
    .map((game, index) => ({ game, index, score: scoreOf(game) }))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      // Within a tier, prefer what people actually engage with — PopScore when
      // IGDB has it, since it reflects current attention, then library saves.
      const pop = (b.game.popScore ?? 0) - (a.game.popScore ?? 0);
      if (pop !== 0) return pop;
      const engagement = b.game.added - a.game.added;
      if (engagement !== 0) return engagement;
      // …then fall back to IGDB's own ordering rather than reshuffling.
      return a.index - b.index;
    })
    .map((entry) => entry.game);
}

/**
 * Search that also reads alternative names.
 *
 * A plain summary query omits them, so "GTA V" scored no better than an
 * unrelated title and fell back to popularity order. Fetching them costs one
 * extra field on a query that already runs, and it is the single biggest
 * accuracy win available here.
 */
async function searchPool(term: string, where: string, limit: number, revalidate: number) {
  const query = queryFor(revalidate);
  const { release } = await schema();
  const rows = await query<IgdbGame[]>(
    "games",
    apicalypse({
      fields: [...CORE_SUMMARY, ...release, "alternative_names.name"].join(","),
      search: term,
      where,
      limit,
    }),
  );

  const usableRows = usable(rows);
  const altNames = new Map<number, string[]>(
    usableRows.map((row) => [
      row.id,
      (row.alternative_names ?? [])
        .map((entry) => entry.name)
        .filter((name): name is string => Boolean(name)),
    ]),
  );

  return { games: usableRows.map(mapSummary), altNames };
}

/** Official-IGDB candidate pool used only when strict full-text misses a typo. */
async function typoSearchPool(term: string, where: string, limit: number, revalidate: number) {
  const query = queryFor(revalidate);
  const { release } = await schema();
  /*
   * Three characters, not two.
   *
   * These become `name ~ *"abc"*` wildcards across ~300k rows, so the prefix
   * length is the difference between a selective match and something close to a
   * full-catalogue scan — against a 9s timeout, on the hottest path in the app.
   * Three still catches the typos this pool exists for while cutting the
   * candidate set by roughly an order of magnitude.
   */
  const prefixes = [...new Set(
    searchQueryVariants(term)
      .flatMap((variant) => variant.split(" "))
      .filter((part) => part.length >= 3)
      .map((part) => part.slice(0, 3)),
  )].slice(0, 5);
  if (prefixes.length === 0) {
    return { games: [] as GameSummary[], altNames: new Map<number, string[]>() };
  }
  // Several stable prefixes survive missing letters, swapped words and common
  // abbreviations while one bounded query still respects IGDB's rate limit.
  const nameCandidates = prefixes.map((prefix) => `name ~ *"${prefix}"*`).join(" | ");
  const rows = await query<IgdbGame[]>(
    "games",
    apicalypse({
      fields: [...CORE_SUMMARY, ...release, "alternative_names.name"].join(","),
      where: `${where} & (${nameCandidates})`,
      sort: "total_rating_count desc",
      limit: Math.min(500, Math.max(limit, 240)),
    }),
  );
  const usableRows = usable(rows);
  const altNames = new Map<number, string[]>(usableRows.map((row) => [
    row.id,
    (row.alternative_names ?? []).map((entry) => entry.name).filter((name): name is string => Boolean(name)),
  ]));
  const games = usableRows.map(mapSummary).filter((game) =>
    Math.min(...[game.name, ...(altNames.get(game.id) ?? [])].map((name) => fuzzyTitleScore(name, term))) < 99,
  );
  return { games, altNames };
}

async function intelligentSearchPool(term: string, where: string, limit: number, revalidate: number) {
  /*
   * Both pools always run, so they run together.
   *
   * Merging the loose pool unconditionally is deliberate — returning early
   * after eight strong matches is what hid a franchise's less-popular games
   * from otherwise valid searches. But that argues for *always merging*, not
   * for waiting on the first before starting the second: awaiting them in
   * sequence made every keystroke-driven search two full round trips deep, and
   * the typo pool is the slowest query shape in the file.
   */
  const [direct, fuzzy] = await Promise.all([
    searchPool(term, where, limit, revalidate),
    typoSearchPool(term, where, limit, revalidate),
  ]);
  const merged = new Map<number, GameSummary>();
  for (const game of [...direct.games, ...fuzzy.games]) merged.set(game.id, game);
  return {
    games: [...merged.values()],
    altNames: new Map([...direct.altNames, ...fuzzy.altNames]),
  };
}

/* ---------------------------------------------------------------------------
 * Multi-entity search
 * ------------------------------------------------------------------------ */

export type IgdbSearchHit = SearchHit;

export interface IgdbSearchLimits {
  games: number;
  characters: number;
  companies: number;
  series: number;
  franchises: number;
  genres: number;
  platforms: number;
}

const DEFAULT_SEARCH_LIMITS: IgdbSearchLimits = {
  games: 8,
  characters: 3,
  companies: 3,
  series: 3,
  franchises: 3,
  genres: 3,
  platforms: 3,
};

interface IgdbMultiQueryResult {
  name: string;
  result?: unknown[];
}

/**
 * Searches every entity the product can route with two upstream requests.
 *
 * Multi-Query keeps one palette request from consuming seven of IGDB's four
 * requests-per-second allowance. Games retain native full-text relevance and
 * alternative-name matching; the other indexes use sanitised name filters.
 */
export async function igdbSearchAll(
  term: string,
  requestedLimits: Partial<IgdbSearchLimits> = {},
): Promise<IgdbSearchHit[]> {
  if (!igdbConfigured() || term.trim().length < 2) return [];
  const limits = { ...DEFAULT_SEARCH_LIMITS, ...requestedLimits };
  const query = queryFor(TTL.search);
  const safeTerm = term.trim().slice(0, 80);
  const nameWhere = (base: string) => buildDirectoryWhere(base, safeTerm);
  const block = (endpoint: string, name: string, body: string) =>
    `query ${endpoint} "${name}" {\n${body}\n};`;
  const gamePoolLimit = Math.min(300, Math.max(limits.games * 5, 120));

  try {
    // IGDB's native `search` statement is not executed inside Multi-Query.
    // Keep the relevance-ranked game search as one direct request and batch
    // every name-indexed entity into one second request.
    const [gameSearch, response] = await Promise.all([
      intelligentSearchPool(safeTerm, SEARCHABLE_GAMES, gamePoolLimit, TTL.search).catch((err) => {
        warn("search.games", err);
        return { games: [] as GameSummary[], altNames: new Map<number, string[]>() };
      }),
      query<IgdbMultiQueryResult[]>("multiquery", [
        block("characters", "characters", apicalypse({
          fields: "name,slug,mug_shot.image_id,species",
          where: nameWhere("slug != null"),
          sort: "name asc",
          limit: limits.characters,
        })),
        block("companies", "companies", apicalypse({
          fields: "name,slug,logo.image_id",
          where: nameWhere("slug != null"),
          sort: "name asc",
          limit: limits.companies,
        })),
        block("collections", "series", apicalypse({
          fields: "name,slug,games",
          where: nameWhere("slug != null & games != null"),
          sort: "name asc",
          limit: limits.series,
        })),
        block("franchises", "franchises", apicalypse({
          fields: "name,slug,games",
          where: nameWhere("slug != null & games != null"),
          sort: "name asc",
          limit: limits.franchises,
        })),
        block("genres", "genres", apicalypse({
          fields: "name,slug",
          where: nameWhere("slug != null"),
          sort: "name asc",
          limit: limits.genres,
        })),
        block("platforms", "platforms", apicalypse({
          fields: "name,slug,abbreviation,platform_logo.image_id",
          where: nameWhere("slug != null"),
          sort: "name asc",
          limit: limits.platforms,
        })),
      ].join("\n\n")).catch((err) => {
        warn("search.entities", err);
        return [] as IgdbMultiQueryResult[];
      }),
    ]);

    const result = <T>(name: string): T[] =>
      (response.find((entry) => entry.name === name)?.result ?? []) as T[];
    const games = rankSearchResults(gameSearch.games, safeTerm, gameSearch.altNames).slice(0, limits.games);
    const characters = result<IgdbCharacter>("characters");
    const companies = result<IgdbCompany>("companies");
    const series = result<IgdbNamed>("series");
    const franchises = result<IgdbNamed>("franchises");
    const genres = result<IgdbNamed>("genres");
    const platforms = result<IgdbPlatform>("platforms");

    return [
      ...games.map((game): IgdbSearchHit => ({
        kind: "game", id: game.id, name: game.name, slug: game.slug,
        subtitle: game.genres.slice(0, 2).map((genre) => genre.name).join(" · ") || "Game",
        image: game.image,
        released: game.released,
        releaseWindow: game.releaseWindow,
        tba: game.tba,
      })),
      /*
       * Franchises and collections ("series") are separate IGDB tables whose
       * ids overlap, but both surface here as `kind: "franchise"`. Carrying the
       * raw id meant two different entities could collide on
       * `franchise-<id>` — duplicate React keys, and `activeIndex` matching the
       * wrong row so Enter opened a result the reader hadn't highlighted.
       * Offsetting the collection ids keeps them distinct without changing the
       * slug, which is what actually drives routing.
       */
      ...[...franchises, ...series.map((entry) => ({ ...entry, id: entry.id + SERIES_ID_OFFSET }))]
        .filter((entry, index, all) => all.findIndex((candidate) =>
          (candidate.slug ?? candidate.name.toLowerCase()) === (entry.slug ?? entry.name.toLowerCase()),
        ) === index)
        .map((entry): IgdbSearchHit => ({
        kind: "franchise", id: entry.id, name: entry.name, slug: entry.slug ?? String(entry.id),
        subtitle: `${entry.games?.length ?? 0} connected games`, image: null,
      })),
      ...companies.map((company): IgdbSearchHit => ({
        kind: "company", id: company.id, name: company.name,
        slug: company.slug ?? String(company.id), subtitle: "Studio or publisher",
        image: igdbImage(company.logo?.image_id, "logo_med"),
      })),
      ...characters.map((character): IgdbSearchHit => ({
        kind: "character", id: character.id, name: character.name,
        slug: character.slug ?? String(character.id),
        subtitle: CHARACTER_SPECIES[character.species ?? -1] ?? "Character",
        image: igdbImage(character.mug_shot?.image_id, "thumb"),
      })),
      ...genres.map((genre): IgdbSearchHit => ({
        kind: "genre", id: genre.id, name: genre.name,
        slug: genre.slug ?? String(genre.id), subtitle: "Game genre", image: null,
      })),
      ...platforms.map((platform): IgdbSearchHit => ({
        kind: "platform", id: platform.id, name: platform.name,
        slug: platform.slug ?? String(platform.id),
        subtitle: platform.abbreviation ? `${platform.abbreviation} · Platform` : "Platform",
        image: igdbImage(platform.platform_logo?.image_id, "logo_med"),
      })),
    ];
  } catch (err) {
    warn("search.multiquery", err);
    return [];
  }
}

export const igdbProvider: GameProvider = {
  id: "igdb",

  isConfigured: igdbConfigured,

  async browse(filters: BrowseFilters) {
    if (!igdbConfigured()) return null;
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = filters.pageSize ?? 24;

    try {
      const where = await buildWhere(filters);
      // An unmatched filter is unsatisfiable, not an error — report zero
      // results rather than silently dropping the filter.
      if (where === null) return { results: [], count: 0, hasNext: false, page };

      const revalidate = filters.search ? TTL.search : TTL.list;
      const term = filters.search?.trim();

      if (term) {
        // IGDB scores `search` internally and forbids combining it with `sort`,
        // and its raw ordering routinely puts editions, bundles and loosely
        // related titles above the obvious answer. Over-fetch, then re-rank
        // locally against the actual query so the exact title wins.
        const overFetch = Math.min(500, Math.max(pageSize * 4, page * pageSize * 2));
        const { games: pool, altNames } = await intelligentSearchPool(
          term,
          where.replace(MAIN_GAMES, SEARCHABLE_GAMES),
          overFetch,
          revalidate,
        );

        const ranked = rankSearchResults(pool, term, altNames);
        const start = (page - 1) * pageSize;
        return {
          // Logos for the visible page only — the pool is several times larger.
          results: await attachLogos(ranked.slice(start, start + pageSize), "logo_med"),
          count: ranked.length,
          hasNext: start + pageSize < ranked.length,
          page,
        };
      }

      // The page and its total are independent queries; awaiting them in
      // sequence doubled the latency of every unfiltered browse.
      const [results, count] = await Promise.all([
        listGames(
          {
            where,
            sort: sortClause(filters.ordering),
            limit: pageSize,
            offset: (page - 1) * pageSize,
          },
          revalidate,
        ),
        countGames(where, revalidate),
      ]);

      return {
        results,
        count,
        hasNext: results.length >= pageSize,
        page,
      };
    } catch (err) {
      warn("browse", err);
      return null;
    }
  },

  async upcoming(pageSize: number, page: number, filters: BrowseFilters = {}) {
    if (!igdbConfigured()) return null;
    try {
      const base = await buildWhere(filters);
      if (base === null) return { results: [], count: 0, hasNext: false, page };
      // Calendar days begin at UTC midnight, and a game releasing today is
      // already "released" (see `releaseState`). Starting the window tomorrow
      // keeps today's launches from filling the page only to be filtered out
      // below — which left the home rail with 2 of 18 slots. The bound is
      // day-aligned so the query body, and its cache key, stay stable.
      const tbaOnly = filters.releaseTiming === "tba";
      const releaseFields = tbaOnly ? (await schema()).release : [];
      const formatField = releaseFields.some((field) => field.endsWith(".date_format"))
        ? "date_format"
        : releaseFields.some((field) => field.endsWith(".category"))
          ? "category"
          : null;
      if (tbaOnly && !formatField) return { results: [], count: 0, hasNext: false, page };
      const where = tbaOnly
        ? `${base} & first_release_date = null & release_dates.${formatField} = 7`
        : `${base} & first_release_date >= ${todayEndSeconds()}`;
      // Independent queries — see `browse`.
      const [candidateResults, count] = await Promise.all([
        listGames(
          {
            where,
            // Soonest-first is the only sensible default for a calendar.
            sort: sortClause(filters.ordering ?? (tbaOnly ? "-hypes" : "released")),
            limit: pageSize,
            offset: (page - 1) * pageSize,
          },
          TTL.list,
        ),
        countGames(where, TTL.list),
      ]);
      const validResults = candidateResults.filter((game) => {
        if (tbaOnly) return game.tba && !game.released && !game.releaseWindow;
        return releaseState(game) === "upcoming" && !game.tba;
      });
      const results = validResults;
      return {
        results,
        count,
        hasNext: candidateResults.length >= pageSize,
        page,
      };
    } catch (err) {
      warn("upcoming", err);
      return null;
    }
  },

  /**
   * Trending, driven by IGDB's own PopScore rather than a rating count.
   *
   * A rating count measures accumulated attention over a title's whole life, so
   * ordering by it returns the same canonical hits every week — the opposite of
   * trending. PopScore is recomputed daily from page visits, so it moves.
   *
   * The popularity endpoint returns ids only, so the games are fetched in a
   * second query and re-sorted back into popularity order, which `where id =
   * (…)` does not preserve. If popularity is unavailable, this falls back to the
   * old engagement ordering rather than returning nothing.
   */
  async trending(pageSize: number) {
    if (!igdbConfigured()) return null;
    try {
      const popularIds = await fetchPopularGameIds(pageSize * 3).catch((err) => {
        warn("popularity", err);
        return [] as number[];
      });

      if (popularIds.length > 0) {
        const games = await listGames(
          { where: `${MAIN_GAMES} & id = (${popularIds.join(",")})`, limit: pageSize * 3 },
          TTL.list,
        );
        const rank = new Map(popularIds.map((id, index) => [id, index]));
        const ordered = games
          .filter((game) => rank.has(game.id))
          .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
          .slice(0, pageSize);
        if (ordered.length > 0) return ordered;
      }

      return await listGames(
        {
          where: `${MAIN_GAMES} & first_release_date > ${daysFromNow(-365)} & first_release_date < ${todayEndSeconds()}`,
          sort: "total_rating_count desc",
          limit: pageSize,
        },
        TTL.list,
      );
    } catch (err) {
      warn("trending", err);
      return null;
    }
  },

  async topRated(pageSize: number) {
    if (!igdbConfigured()) return null;
    try {
      return await listGames(
        {
          // A minimum critic count keeps single-review outliers off the shelf.
          where: `${MAIN_GAMES} & aggregated_rating_count > 7 & aggregated_rating > 80`,
          sort: "aggregated_rating desc",
          limit: pageSize,
        },
        TTL.list,
      );
    } catch (err) {
      warn("topRated", err);
      return null;
    }
  },

  async newReleases(pageSize: number) {
    if (!igdbConfigured()) return null;
    try {
      return await listGames(
        {
          // Strictly before tomorrow 00:00 UTC; `<=` let tomorrow's launches in.
          where: `${MAIN_GAMES} & first_release_date > ${daysFromNow(-60)} & first_release_date < ${todayEndSeconds()}`,
          sort: "first_release_date desc",
          limit: pageSize,
        },
        TTL.list,
      );
    } catch (err) {
      warn("newReleases", err);
      return null;
    }
  },

  async detail(slug: string) {
    if (!igdbConfigured()) return null;
    try {
      const query = queryFor(TTL.detail);
      const rows = await query<IgdbGame[]>(
        "games",
        apicalypse({
          fields: await detailFields(),
          where: `slug = "${slug.replace(/"/g, "")}"`,
          limit: 1,
        }),
      );
      if (rows.length === 0) return null;

      const detail = mapDetail(rows[0]);

      // Cast and popularity live on their own endpoints. Both are enrichment,
      // so a failure in either leaves the page intact rather than losing it.
      // One logo query covers the page's own wordmark and every nested card
      // (similar titles, DLC, remakes…), which is also what `related` serves.
      const nested = [
        detail.similar, detail.dlcs, detail.expansions, detail.standaloneExpansions,
        detail.bundles, detail.remakes, detail.remasters, detail.ports,
      ];
      const [characters, popScores, editions, logos] = await Promise.all([
        fetchCharacters(detail.id).catch((err) => {
          warn("characters", err);
          return [];
        }),
        // Detail's own TTL, not the shorter list one: a fetch that declares a
        // shorter lifetime than the page drags the whole route's revalidate
        // down with it, which silently cut game pages from daily to 6-hourly.
        fetchPopScores([detail.id], TTL.detail),
        fetchEditions(detail.id).catch((err) => {
          warn("gameVersions", err);
          return [];
        }),
        fetchLogoArt([detail.id, ...nested.flat().map((game) => game.id)]).catch((err) => {
          warn("logos", err);
          return null;
        }),
      ]);

      const withLogo = <T extends GameSummary>(games: T[]): T[] =>
        logos ? games.map((game) => ({ ...game, logo: logoFromArt(logos.get(game.id), "logo_med") })) : games;

      return {
        ...detail,
        logo: logos ? logoFromArt(logos.get(detail.id), "720p") : undefined,
        similar: withLogo(detail.similar),
        dlcs: withLogo(detail.dlcs),
        expansions: withLogo(detail.expansions),
        standaloneExpansions: withLogo(detail.standaloneExpansions),
        bundles: withLogo(detail.bundles),
        remakes: withLogo(detail.remakes),
        remasters: withLogo(detail.remasters),
        ports: withLogo(detail.ports),
        characters,
        editions,
        popScore: popScores.get(detail.id) ?? null,
      };
    } catch (err) {
      warn("detail", err);
      return null;
    }
  },

  async related(game: GameDetail, limit: number) {
    if (!igdbConfigured()) return null;
    // IGDB curates `similar_games` itself, and the detail query already
    // expanded it — no second request needed.
    if (game.similar.length > 0) return game.similar.slice(0, limit);
    if (game.genres.length === 0) return [];

    try {
      const ids = game.genres.map((genre) => genre.id).join(",");
      const results = await listGames(
        {
          where: `${MAIN_GAMES} & genres = (${ids}) & id != ${game.id}`,
          sort: "total_rating_count desc",
          limit: limit + 4,
        },
        TTL.detail,
      );
      return results.slice(0, limit);
    } catch (err) {
      warn("related", err);
      return null;
    }
  },

  async genres() {
    if (!igdbConfigured()) return null;
    try {
      return await fetchGenres();
    } catch (err) {
      warn("genres", err);
      return null;
    }
  },

  async platforms() {
    if (!igdbConfigured()) return null;
    // Families rather than IGDB's ~200 individual platforms: filtering by
    // "PlayStation" is what people mean, not "PlayStation Vita" specifically.
    return PLATFORM_FAMILIES;
  },
};

/**
 * Games for the homepage hero.
 *
 * IGDB-only by design, and exported separately from the provider interface so
 * it can never be answered by the fallback chain. The hero autoplays trailers
 * and leans on key art, and Steam supplies neither in a list query — a hero
 * quietly served from Steam is a row of static PC capsules, which is precisely
 * the "why does this look like a storefront?" failure this avoids.
 *
 * Ordered directly from IGDB's worldwide "Playing" popularity primitive. Art
 * is required, but trailers are not: refusing a genuinely trending game just
 * because its trailer is absent would corrupt the ranking the hero promises.
 */
export async function igdbSpotlight(limit = 6): Promise<GameSummary[] | null> {
  if (!igdbConfigured()) return null;

  try {
    // Preserve the upstream rank exactly. Re-sorting by rating or release date
    // would turn this back into a featured shelf instead of a trending hero.
    const popularIds = await fetchPopularGameIds(limit * 8, POPULARITY.playing)
      .catch((err) => {
        warn("spotlight.popularity", err);
        return [] as number[];
      });

    if (popularIds.length > 0) {
      const games = await listGames(
        { where: `${MAIN_GAMES} & id = (${popularIds.join(",")})`, limit: popularIds.length },
        TTL.list,
        // The hero sets the wordmark large over key art.
        "720p",
      );
      const rank = new Map(popularIds.map((id, index) => [id, index]));
      const ordered = games
        .filter((game) => game.image || game.screenshots.length > 0)
        .sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999))
        .slice(0, limit);
      if (ordered.length > 0) return ordered;
    }

    // IGDB-only resilience: if the popularity feed is temporarily empty, show
    // widely rated recent releases rather than a storefront or upcoming list.
    const recent = await listGames(
      {
        where: `${MAIN_GAMES} & first_release_date > ${daysFromNow(-365)} & first_release_date < ${todayEndSeconds()}`,
        sort: "total_rating_count desc",
        limit,
      },
      TTL.list,
      "720p",
    );
    return recent.slice(0, limit);
  } catch (err) {
    warn("spotlight", err);
    return null;
  }
}

/** Pre-release follows a launch needs to take over the hero (see `igdbReleasingToday`). */
export const RELEASE_DAY_MIN_HYPES = 25;

/**
 * Notable games releasing today (UTC calendar day), most anticipated first,
 * for the hero's release-day takeover.
 *
 * "Notable" is IGDB's `hypes` — follows gathered before release, the one
 * audience signal a brand-new game has — at or above 25, which in practice
 * admits the launches people were waiting for (Gears of War: E-Day 115,
 * Castlevania: Belmont's Curse 81) and leaves out the long tail. One cached
 * query (plus its batched wordmarks); the day-aligned bounds make the cache
 * key roll over at midnight UTC.
 */
export async function igdbReleasingToday(limit = 1): Promise<GameSummary[] | null> {
  if (!igdbConfigured()) return null;
  try {
    const start = todayStartSeconds();
    const today = new Date(start * 1000).toISOString().slice(0, 10);
    const games = await listGames(
      {
        where: `${MAIN_GAMES} & first_release_date >= ${start} & first_release_date < ${start + 86_400} & hypes >= ${RELEASE_DAY_MIN_HYPES} & cover != null`,
        sort: "hypes desc",
        limit: Math.max(1, Math.min(limit, 5)),
      },
      TTL.list,
      "720p",
    );
    return games.filter((game) => game.released === today && (game.image || game.screenshots.length > 0));
  } catch (err) {
    warn("releasingToday", err);
    return null;
  }
}

/**
 * A ranked Steam chart, straight from IGDB's popularity feed.
 *
 * IGDB ingests these from Steam itself (`popularity_source: 1`), which is what
 * makes a Steam-wide view possible at all: Steam's own public endpoints expose
 * no "top games" query, only curated storefront shelves. Recomputed daily.
 */
export interface SteamChart {
  key: string;
  title: string;
  description: string;
  games: GameSummary[];
}

export async function igdbSteamCharts(perChart = 12): Promise<SteamChart[] | null> {
  if (!igdbConfigured()) return null;

  const charts: { key: string; title: string; description: string; type: PopularityType }[] = [
    {
      key: "peak",
      title: "Most played right now",
      description: "Ranked by Steam's 24-hour peak concurrent players.",
      type: POPULARITY.steamPeak,
    },
    {
      key: "sellers",
      title: "Global top sellers",
      description: "Steam's worldwide revenue chart.",
      type: POPULARITY.steamTopSellers,
    },
    {
      key: "wishlisted",
      title: "Most wishlisted",
      description: "Unreleased games Steam players are waiting on.",
      type: POPULARITY.steamWishlisted,
    },
  ];

  try {
    const resolved = await Promise.all(
      charts.map(async (chart) => {
        const ids = await fetchPopularGameIds(perChart * 3, chart.type).catch((err) => {
          warn(`steam.${chart.key}`, err);
          return [] as number[];
        });
        if (ids.length === 0) return { ...chart, games: [] };

        const games = await listGames(
          { where: `id = (${ids.join(",")})`, limit: ids.length },
          TTL.list,
        );
        // `where id = (…)` does not preserve the ranking, so restore it.
        const rank = new Map(ids.map((id, index) => [id, index]));
        return {
          ...chart,
          games: games
            .sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999))
            .slice(0, perChart),
        };
      }),
    );

    const usableCharts = resolved.filter((chart) => chart.games.length > 0);
    return usableCharts.length > 0 ? usableCharts : null;
  } catch (err) {
    warn("steamCharts", err);
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Entity pages
 * ------------------------------------------------------------------------ */

export interface IgdbEntity {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  /** Country code for companies, species for characters — a one-line fact. */
  detail: string | null;
  games: GameSummary[];
}

/**
 * A studio and everything IGDB credits it with.
 *
 * `involved_companies` is the join table between games and companies, so the
 * game ids come from there rather than from the company record itself.
 */
export async function igdbCompany(slug: string): Promise<IgdbEntity | null> {
  if (!igdbConfigured()) return null;
  try {
    const query = queryFor(TTL.detail);
    const rows = await query<
      (IgdbCompany & { description?: string; country?: number; developed?: number[]; published?: number[] })[]
    >(
      "companies",
      apicalypse({
        fields: "name,slug,description,logo.image_id,country,developed,published",
        where: `slug = "${slug.replace(/"/g, "")}"`,
        limit: 1,
      }),
    );

    const company = rows[0];
    if (!company) return null;

    // Developed first, then published — a studio's own work leads.
    const gameIds = [...new Set([...(company.developed ?? []), ...(company.published ?? [])])];
    const games = await listGamesByIds(gameIds, "popularity");

    return {
      id: company.id,
      slug: company.slug ?? slug,
      name: company.name,
      description: company.description?.trim() || null,
      image: igdbImage(company.logo?.image_id, "logo_med"),
      detail: null,
      games,
    };
  } catch (err) {
    warn("company", err);
    return null;
  }
}

/** A character and the games they appear in. */
export async function igdbCharacter(slug: string): Promise<IgdbEntity | null> {
  if (!igdbConfigured()) return null;
  try {
    const query = queryFor(TTL.detail);
    const rows = await query<(IgdbCharacter & { games?: number[] })[]>(
      "characters",
      apicalypse({
        fields: "name,slug,description,mug_shot.image_id,species,gender,games",
        where: `slug = "${slug.replace(/"/g, "")}"`,
        limit: 1,
      }),
    );

    const character = rows[0];
    if (!character) return null;

    const games = await listGamesByIds(character.games ?? []);

    return {
      id: character.id,
      slug: character.slug ?? slug,
      name: character.name,
      description: character.description?.trim() || null,
      image: igdbImage(character.mug_shot?.image_id, "1080p"),
      detail:
        [
          typeof character.species === "number" ? CHARACTER_SPECIES[character.species] : null,
          typeof character.gender === "number" ? CHARACTER_GENDERS[character.gender] : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      games,
    };
  } catch (err) {
    warn("character", err);
    return null;
  }
}

/**
 * A fictional or product universe from IGDB's Franchise model.
 *
 * IGDB Collections are used only as a fallback when a title lacks a franchise,
 * keeping one stable public concept and route instead of competing labels.
 */
export async function igdbFranchise(slug: string): Promise<IgdbEntity | null> {
  if (!igdbConfigured()) return null;
  const safe = slug.replace(/"/g, "");

  try {
    const query = queryFor(TTL.detail);
    const rows = await query<(IgdbNamed & { games?: number[] })[]>(
      "franchises",
      apicalypse({ fields: "name,slug,games", where: `slug = "${safe}"`, limit: 1 }),
    );
    // A small number of games only carry IGDB's Collection relationship. The
    // product exposes one clear concept, Franchise, so a collection is the
    // precise fallback rather than a second competing destination.
    const fallback = rows[0] ? [] : await query<(IgdbNamed & { games?: number[] })[]>(
      "collections",
      apicalypse({ fields: "name,slug,games", where: `slug = "${safe}"`, limit: 1 }),
    );
    const entity = rows[0] ?? fallback[0];
    if (!entity) return null;

    const games = await listGamesByIds(entity.games ?? []);

    return {
      id: entity.id,
      slug: entity.slug ?? slug,
      name: entity.name,
      description: null,
      image: games.find((game) => game.image)?.image ?? null,
      detail: null,
      games,
    };
  } catch (err) {
    warn("franchise", err);
    return null;
  }
}

export interface IgdbDirectoryPage {
  results: DirectoryRef[];
  page: number;
  pageSize: number;
  /** Exact when every matching record is valid for this directory. */
  count: number | null;
  hasNext: boolean;
}

export interface IgdbDirectoryInput {
  query?: string;
  page?: number;
  pageSize?: number;
  order?: DirectoryOrder;
}

function directoryInput(input: IgdbDirectoryInput) {
  const query = (input.query ?? "").trim().slice(0, 80);
  return {
    query,
    // Prevent a hand-edited URL producing an unbounded offset or query size.
    page: Math.min(Math.max(Math.trunc(input.page ?? 1), 1), 1000),
    pageSize: Math.min(Math.max(Math.trunc(input.pageSize ?? 60), 12), 72),
    order: input.order === "-name" ? ("-name" as const) : ("name" as const),
  };
}

async function entityCount(
  endpoint: "companies" | "collections" | "franchises",
  where: string,
  revalidate: number,
) {
  const query = queryFor(revalidate);
  const result = await query<{ count?: number }>(`${endpoint}/count`, `where ${where};`);
  return result.count ?? 0;
}

/** Paginated franchise directory with an exact count and no 72-item ceiling. */
export async function igdbFranchiseDirectory(
  input: IgdbDirectoryInput = {},
): Promise<IgdbDirectoryPage | null> {
  if (!igdbConfigured()) return null;
  const options = directoryInput(input);
  const where = buildDirectoryWhere("slug != null & games != null", options.query);
  const offset = (options.page - 1) * options.pageSize;
  const revalidate = options.query ? TTL.search : TTL.taxonomy;

  try {
    const query = queryFor(revalidate);
    const [rows, count] = await Promise.all([
      query<IgdbNamed[]>(
        "franchises",
        apicalypse({
          fields: "name,slug,games",
          where,
          sort: options.order === "-name" ? "name desc" : "name asc",
          limit: options.pageSize + 1,
          offset,
        }),
      ),
      entityCount("franchises", where, revalidate),
    ]);

    if (options.query && rows.length === 0 && count === 0) {
      const prefix = normalise(options.query).charAt(0);
      if (prefix) {
        const candidates = await query<IgdbNamed[]>("franchises", apicalypse({
          fields: "name,slug,games",
          where: buildDirectoryWhere("slug != null & games != null", prefix),
          sort: "name asc",
          limit: 500,
        }));
        const matches = candidates
          .filter((entry) => fuzzyTitleScore(entry.name, options.query) < 99)
          .sort((a, b) => fuzzyTitleScore(a.name, options.query) - fuzzyTitleScore(b.name, options.query));
        const pageRows = matches.slice(offset, offset + options.pageSize);
        return {
          results: pageRows.map((franchise) => ({ id: franchise.id, slug: franchise.slug ?? String(franchise.id), name: franchise.name, gameCount: franchise.games?.length ?? 0 })),
          page: options.page,
          pageSize: options.pageSize,
          count: matches.length,
          hasNext: offset + options.pageSize < matches.length,
        };
      }
    }

    return {
      results: rows.slice(0, options.pageSize).map((franchise) => ({
        id: franchise.id,
        slug: franchise.slug ?? String(franchise.id),
        name: franchise.name,
        gameCount: franchise.games?.length ?? 0,
      })),
      page: options.page,
      pageSize: options.pageSize,
      count,
      hasNext: offset + options.pageSize < count,
    };
  } catch (err) {
    warn("franchiseDirectory", err);
    return null;
  }
}

/** Paginated studio directory across both developers and publishers. */
export async function igdbStudiosDirectory(
  input: IgdbDirectoryInput = {},
): Promise<IgdbDirectoryPage | null> {
  if (!igdbConfigured()) return null;
  const options = directoryInput(input);
  const base = "slug != null & logo != null & (developed != null | published != null)";
  const where = buildDirectoryWhere(base, options.query);
  const offset = (options.page - 1) * options.pageSize;
  const revalidate = options.query ? TTL.search : TTL.taxonomy;

  try {
    const query = queryFor(revalidate);
    const [rows, count] = await Promise.all([
      query<(IgdbCompany & { developed?: number[]; published?: number[] })[]>(
        "companies",
        apicalypse({
          fields: "name,slug,logo.image_id,developed,published",
          where,
          sort: options.order === "-name" ? "name desc" : "name asc",
          limit: options.pageSize + 1,
          offset,
        }),
      ),
      entityCount("companies", where, revalidate),
    ]);

    if (options.query && rows.length === 0 && count === 0) {
      const prefix = normalise(options.query).charAt(0);
      if (prefix) {
        const candidates = await query<(IgdbCompany & { developed?: number[]; published?: number[] })[]>("companies", apicalypse({
          fields: "name,slug,logo.image_id,developed,published",
          where: buildDirectoryWhere(base, prefix),
          sort: "name asc",
          limit: 500,
        }));
        const matches = candidates
          .filter((company) => fuzzyTitleScore(company.name, options.query) < 99)
          .sort((a, b) => fuzzyTitleScore(a.name, options.query) - fuzzyTitleScore(b.name, options.query));
        const pageRows = matches.slice(offset, offset + options.pageSize);
        return {
          results: pageRows.map((company) => ({ id: company.id, slug: company.slug ?? String(company.id), name: company.name, logo: igdbImage(company.logo?.image_id, "logo_med"), gameCount: new Set([...(company.developed ?? []), ...(company.published ?? [])]).size })),
          page: options.page,
          pageSize: options.pageSize,
          count: matches.length,
          hasNext: offset + options.pageSize < matches.length,
        };
      }
    }

    return {
      results: rows.slice(0, options.pageSize).map((company) => ({
        id: company.id,
        slug: company.slug ?? String(company.id),
        name: company.name,
        logo: igdbImage(company.logo?.image_id, "logo_med"),
        gameCount: new Set([...(company.developed ?? []), ...(company.published ?? [])]).size,
      })),
      page: options.page,
      pageSize: options.pageSize,
      count,
      hasNext: offset + options.pageSize < count,
    };
  } catch (err) {
    warn("studiosDirectory", err);
    return null;
  }
}

/**
 * A pool of currently-popular games, expanded far enough to read their credits.
 *
 * Shared by the studio and franchise directories, which both want the same
 * thing: "who and what is behind the games people actually play right now".
 * One cached query serves both.
 */
interface CreditPoolGame {
  id: number;
  involved_companies?: { developer?: boolean; publisher?: boolean; company?: IgdbCompany }[];
  franchises?: IgdbNamed[];
  collections?: IgdbNamed[];
}

async function fetchCreditPool(): Promise<CreditPoolGame[]> {
  // 450 keeps the id list inside one request; IGDB caps `limit` at 500.
  const popularIds = await fetchPopularGameIds(450, POPULARITY.playing);
  if (popularIds.length === 0) return [];

  const query = queryFor(TTL.taxonomy);
  return query<CreditPoolGame[]>(
    "games",
    apicalypse({
      fields: [
        "involved_companies.developer",
        "involved_companies.publisher",
        "involved_companies.company.name",
        "involved_companies.company.slug",
        "involved_companies.company.logo.image_id",
        "franchises.name",
        "franchises.slug",
        "collections.name",
        "collections.slug",
      ].join(","),
      where: `id = (${popularIds.join(",")})`,
      limit: popularIds.length,
    }),
  );
}

/**
 * The studios worth putting on an index page.
 *
 * Ranked by how many currently-popular games a studio is credited on, so the
 * directory opens on names people recognise.
 *
 * The previous implementation asked for `limit 500` with **no sort clause**.
 * APICalypse returns id order in that case, so it fetched the 500 *oldest*
 * company records and ranked those locally — the exact "alphabetical accident"
 * this function exists to avoid, and it fed the sitemap too. IGDB cannot sort
 * by the length of an array field, so there is no query-level fix; ranking has
 * to come from something scalar, and popularity is both scalar and meaningful.
 */
export async function igdbTopStudios(limit = 60): Promise<LogoRef[] | null> {
  if (!igdbConfigured()) return null;
  try {
    const pool = await fetchCreditPool();

    const tally = new Map<number, { ref: LogoRef; count: number }>();
    for (const game of pool) {
      // One credit per studio per game, so a company listed as both developer
      // and publisher doesn't count twice.
      const seen = new Set<number>();
      for (const entry of game.involved_companies ?? []) {
        const company = entry.company;
        if (!company?.logo?.image_id || seen.has(company.id)) continue;
        seen.add(company.id);

        const existing = tally.get(company.id);
        if (existing) {
          existing.count += 1;
        } else {
          tally.set(company.id, {
            count: 1,
            ref: {
              id: company.id,
              slug: company.slug ?? String(company.id),
              name: company.name,
              logo: igdbImage(company.logo.image_id, "logo_med"),
            },
          });
        }
      }
    }

    const ranked = [...tally.values()]
      .sort((a, b) => b.count - a.count || a.ref.name.localeCompare(b.ref.name))
      .slice(0, limit)
      .map((entry) => entry.ref);

    return ranked.length > 0 ? ranked : null;
  } catch (err) {
    warn("topStudios", err);
    return null;
  }
}

/** The largest connected franchises for crawler discovery. */
export async function igdbTopFranchises(limit = 60): Promise<Ref[] | null> {
  if (!igdbConfigured()) return null;
  try {
    // Same reasoning as `igdbTopStudios`: the old unsorted `limit 500` returned
    // id order, i.e. the oldest franchise records rather than the biggest.
    const pool = await fetchCreditPool();

    const tally = new Map<string, { ref: Ref; count: number }>();
    for (const game of pool) {
      // A game frequently belongs to both a franchise and an identically-named
      // collection; key on slug so the two don't double-count.
      const seen = new Set<string>();
      for (const entry of [...(game.franchises ?? []), ...(game.collections ?? [])]) {
        const slug = entry.slug ?? String(entry.id);
        if (seen.has(slug)) continue;
        seen.add(slug);

        const existing = tally.get(slug);
        if (existing) {
          existing.count += 1;
        } else {
          tally.set(slug, { count: 1, ref: { id: entry.id, slug, name: entry.name } });
        }
      }
    }

    const ranked = [...tally.values()]
      .sort((a, b) => b.count - a.count || a.ref.name.localeCompare(b.ref.name))
      .slice(0, limit)
      .map((entry) => entry.ref);

    return ranked.length > 0 ? ranked : null;
  } catch (err) {
    warn("topFranchises", err);
    return null;
  }
}

/** Themes power the recommendation engine's taste profile. */
export async function igdbThemes(): Promise<Ref[] | null> {
  if (!igdbConfigured()) return null;
  try {
    return await fetchThemes();
  } catch (err) {
    warn("themes", err);
    return null;
  }
}

/**
 * Games matching a taste profile, excluding anything already seen.
 *
 * Used by the recommendation rail: the caller derives genre and theme ids from
 * a user's library, and this returns well-regarded matches they don't have.
 */
export async function igdbRecommend(input: {
  genreIds: number[];
  themeIds: number[];
  platformSlugs: string[];
  excludeIds: number[];
  limit: number;
}): Promise<GameSummary[] | null> {
  if (!igdbConfigured()) return null;
  try {
    const clauses = [MAIN_GAMES, "total_rating_count > 12", "aggregated_rating > 70"];
    if (input.genreIds.length > 0) clauses.push(`genres = (${input.genreIds.join(",")})`);
    if (input.themeIds.length > 0) clauses.push(`themes = (${input.themeIds.join(",")})`);
    if (input.platformSlugs.length > 0) {
      const ids = await platformIdsForFamilies(input.platformSlugs);
      if (ids.length > 0) clauses.push(`platforms = (${ids.join(",")})`);
    }
    if (input.excludeIds.length > 0) {
      clauses.push(`id != (${input.excludeIds.join(",")})`);
    }

    return await listGames(
      { where: clauses.join(" & "), sort: "total_rating desc", limit: input.limit },
      TTL.list,
    );
  } catch (err) {
    warn("recommend", err);
    return null;
  }
}

export interface IgdbDiagnostics {
  ok: boolean;
  configured: boolean;
  /** Whether the Twitch OAuth exchange succeeded. */
  authenticated: boolean;
  /** Whether a real query returned rows. */
  querying: boolean;
  problem: string | null;
  /** Plain-language next step, when something is wrong. */
  hint: string | null;
}

/**
 * Reports exactly where the IGDB pipeline breaks.
 *
 * Deliberately never returns the credentials themselves — only whether each
 * stage succeeded, plus an actionable hint. This exists because a silent
 * provider failure is close to undiagnosable from a deployed site otherwise.
 */
export async function igdbDiagnostics(): Promise<IgdbDiagnostics> {
  const base: IgdbDiagnostics = {
    ok: false,
    configured: false,
    authenticated: false,
    querying: false,
    problem: null,
    hint: null,
  };

  if (!igdbConfigured()) {
    return {
      ...base,
      problem: "IGDB_CLIENT_ID and/or IGDB_CLIENT_SECRET are not set.",
      hint: "Add both as Worker secrets (npx wrangler secret put IGDB_CLIENT_ID / IGDB_CLIENT_SECRET), then redeploy.",
    };
  }

  try {
    await getToken();
  } catch (err) {
    if (err instanceof TokenError) {
      const hint =
        err.status === 403
          ? "The client id is valid but the secret is wrong — most likely it was rotated. Generate a new secret at dev.twitch.tv/console/apps and update IGDB_CLIENT_SECRET, then redeploy."
          : err.status === 400
            ? "Twitch doesn't recognise this client id. Check IGDB_CLIENT_ID matches your app at dev.twitch.tv/console/apps."
            : "Twitch rejected the token request. Check the credentials and try again shortly.";
      return { ...base, configured: true, problem: err.message, hint };
    }
    return {
      ...base,
      configured: true,
      problem: err instanceof Error ? err.message : String(err),
      hint: "Couldn't reach Twitch to authenticate. This is usually transient.",
    };
  }

  try {
    const rows = await rawQuery<unknown[]>("games", "fields name; limit 1;");
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        ...base,
        configured: true,
        authenticated: true,
        problem: "Authenticated, but a test query returned no rows.",
        hint: "The credentials work; IGDB may be rate-limiting. Try again shortly.",
      };
    }
  } catch (err) {
    const hint =
      err instanceof IgdbTransportError
        ? err.failure === "timeout"
          ? "Authentication works, but IGDB did not answer before the timeout. Check outbound connectivity and retry shortly."
          : err.failure === "network"
            ? "Authentication works, but this server cannot reach api.igdb.com. Check DNS, firewall, and hosting-provider egress."
            : "IGDB returned a response that was not valid JSON. Retry shortly; if it persists, inspect the upstream response."
        : err instanceof IgdbHttpError
          ? err.status === 429
            ? "IGDB is rate-limiting this deployment. Retry shortly; requests are automatically throttled and retried."
            : err.status >= 500
              ? "IGDB is returning a server error. The client will retry automatically."
              : err.status === 400
                ? "IGDB rejected the test query. This points to an API contract change rather than an authentication problem."
                : "IGDB rejected the query. Inspect the status and response before changing credentials."
          : "Authentication works but queries are failing. Check the reported transport error and hosting logs.";
    return {
      ...base,
      configured: true,
      authenticated: true,
      problem: err instanceof Error ? err.message : String(err),
      hint,
    };
  }

  return { ok: true, configured: true, authenticated: true, querying: true, problem: null, hint: null };
}

function warn(operation: string, err: unknown) {
  console.warn(`[igdb] ${operation} failed:`, err instanceof Error ? err.message : err);
}
