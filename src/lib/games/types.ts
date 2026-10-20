/**
 * Normalised game model.
 *
 * Everything in the UI speaks this shape — never a raw RAWG payload. That
 * boundary is what lets providers be swapped or added without a single
 * component changing.
 */

export interface Ref {
  id: number;
  slug: string;
  name: string;
}

export interface StoreRef extends Ref {
  domain: string | null;
  url: string | null;
}

export interface Trailer {
  id: number;
  name: string;
  /**
   * Providers differ in what they can hand us: Steam hosts real MP4s, while
   * IGDB only stores YouTube ids. The player branches on this rather than
   * guessing from the URL.
   */
  kind: "mp4" | "youtube";
  /** Set only when `kind` is "youtube". */
  youtubeId?: string;
  preview: string | null;
  /** Direct media URL for MP4, or the watch URL for YouTube. */
  url: string | null;
}

export interface Requirement {
  platform: string;
  minimum: string | null;
  recommended: string | null;
}

export interface AgeRating {
  /** e.g. "ESRB", "PEGI", "USK". */
  organization: string;
  /** e.g. "M", "18". */
  rating: string;
  /**
   * Why the board gave that rating — "Blood and Gore", "Strong Language".
   * Empty when the board publishes none, which is common outside ESRB/PEGI.
   */
  descriptors: string[];
}

/**
 * A company, platform or engine that has a brand mark on IGDB.
 *
 * `logo` is IGDB's own asset rather than a bundled icon, so it covers the long
 * tail of studios no icon set will ever have. Null when IGDB has none, which
 * the UI must handle rather than render a broken image.
 */
export interface LogoRef extends Ref {
  logo: string | null;
}

/** A directory entry with enough context to rank and describe it. */
export interface DirectoryRef extends Ref {
  logo?: string | null;
  gameCount: number;
}

/** A studio's role on a specific game. */
export interface CompanyRef extends LogoRef {
  developer: boolean;
  publisher: boolean;
  porting: boolean;
  supporting: boolean;
  /** The studio's own site, when IGDB has it. */
  website: string | null;
}

/** A platform, with IGDB's mark and the family it rolls up to. */
export interface PlatformRef extends LogoRef {
  /** Icon family slug — "playstation", "xbox" — for the bundled brand icons. */
  family: string | null;
  abbreviation: string | null;
  /** e.g. "console", "portable", "computer". */
  category: string | null;
  generation: number | null;
}

/** One dated release, for a specific region and platform. */
export interface ReleaseEvent {
  /** ISO `YYYY-MM-DD`, or null when only a window is known. */
  date: string | null;
  /** Human label as IGDB renders it — "Q4 2026", "Feb 25, 2022". */
  human: string;
  /** "North America", "Europe", "Japan", … or null when unspecified. */
  region: string | null;
  platform: string | null;
}

/** A named character appearing in a game. */
export interface CharacterRef extends Ref {
  description: string | null;
  /** Portrait, IGDB's "mug shot". */
  image: string | null;
  species: string | null;
  gender: string | null;
}

export interface WebsiteRef {
  /** Store/social slug from `classifyUrl`, or "official". */
  kind: string;
  url: string;
}

export interface MultiplayerModes {
  campaignCoop: boolean;
  dropIn: boolean;
  lanCoop: boolean;
  offlineCoop: boolean;
  onlineCoop: boolean;
  splitScreen: boolean;
  onlineMax: number | null;
  offlineMax: number | null;
}

/**
 * A game's wordmark. `tone` says what background it was drawn for:
 * "light" is a white mark (for dark UI), "dark" a black mark (for light UI,
 * or inverted on dark), "color" a full-colour mark that works on either.
 */
export interface GameLogo {
  url: string;
  tone: "light" | "dark" | "color";
  source: "igdb" | "steam" | "wikidata";
}

/** Colours sampled from a game's cover art, as hex strings. */
export interface CoverPalette {
  dominant: string;
  vibrant: string;
  muted: string;
  /** True when `dominant` is dark enough that white text reads on it. */
  isDark: boolean;
}

/** IGDB `game_time_to_beats`, converted to hours. */
export interface TimeToBeat {
  hastily: number | null;
  normally: number | null;
  completely: number | null;
  /** How many player submissions the figures are based on. */
  count: number;
}

/** Third-party identities for one game, used to join external data sources. */
export interface ExternalIds {
  steam: number | null;
  twitch: string | null;
  gog: string | null;
  /** Microsoft Store "BigId", which is also what Game Pass catalogues list. */
  microsoft: string | null;
  epic: string | null;
}

/** Outbound reference links resolved through Wikidata. */
export interface ReferenceLinks {
  wikipedia: string | null;
  howLongToBeat: string | null;
  openCritic: string | null;
  metacritic: string | null;
  pcGamingWiki: string | null;
}

/** 0–100 composite anticipation/attention score and the signals behind it. */
export interface HypeIndex {
  score: number;
  signals: {
    hypes: number;
    wantToPlay: number | null;
    visits: number | null;
    playing: number | null;
    peakPlayers24h: number | null;
  };
}

/** One observed change of a game's release date, from our own history. */
export interface ReleaseChange {
  /** What the date/window was before the change (ISO date or window label). */
  from: string;
  to: string;
  /** When we noticed the change, ISO timestamp. */
  observedAt: string;
}

export interface GameSummary {
  id: number;
  slug: string;
  name: string;
  /**
   * ISO `YYYY-MM-DD`, and only ever set when the source gave us a genuine
   * day-level date. Never synthesised from a looser window.
   */
  released: string | null;
  /**
   * Human label for a known-but-imprecise date — "Q4 2026", "March 2026",
   * "2027". Set when a source has committed to a window but not a day.
   * Rendering this instead of inventing a day is the difference between an
   * honest release calendar and a misleading one.
   */
  releaseWindow: string | null;
  /** No date information at all: announced, but nothing scheduled. */
  tba: boolean;
  /**
   * Preferred poster. Portrait 3:4 wherever the provider has one, since that is
   * the shape every card renders at.
   */
  image: string | null;
  /**
   * Used when `image` fails to load. Steam's portrait library capsule is the
   * best-looking asset it has but is missing for a minority of apps, so the
   * guaranteed 16:9 header sits behind it rather than being used by default.
   */
  imageFallback: string | null;
  /** 0–5 user score. */
  rating: number;
  ratingsCount: number;
  /** 0–100 critic score, or null when unscored. */
  metacritic: number | null;
  platforms: Ref[];
  parentPlatforms: Ref[];
  genres: Ref[];
  screenshots: string[];
  esrb: string | null;
  /**
   * IGDB's own popularity signal, recomputed daily from page visits and list
   * additions. Distinct from `added`, which counts library saves: this reflects
   * what people are *looking at* right now, which is what "trending" means.
   * Null when IGDB has no score for the title.
   */
  popScore: number | null;
  /**
   * A single trailer, carried on the summary so list views can autoplay one
   * without fetching the full detail record. Null when the provider has none.
   */
  heroTrailer: Trailer | null;
  /** Median hours to complete, per RAWG. */
  playtime: number;
  /** RAWG's popularity signal — how many users have it in a library. */
  added: number;
  /** Official wordmark when one is known; render via `GameLogo`, which falls back to a typographic mark. */
  logo?: GameLogo | null;
}

/**
 * A homepage hero slide: the summary plus what the stage needs to dress
 * itself. Both extras are optional in spirit — null simply means the hero
 * falls back to its neutral scrims and shows no tagline.
 */
export interface SpotlightGame extends GameSummary {
  /** Sampled from the slide's own backdrop, so the scrims match the art. */
  palette: CoverPalette | null;
  /** The opening sentence of IGDB's summary, trimmed for a hero line. */
  tagline: string | null;
  /** A notable game releasing today (UTC), moved to the front of the hero. */
  takeover?: boolean;
  /**
   * A clearly brighter screenshot for the light theme, with its palette
   * (see `art-light.ts`). Null when the slide's own art is as bright as any.
   */
  lightArt?: { image: string; palette: CoverPalette | null } | null;
}

/** A game with its 0–100 hype score, for anticipation-ranked shelves. */
export interface RankedGame {
  game: GameSummary;
  hype: number;
}

export interface GameDetail extends GameSummary {
  description: string;
  /** Narrative premise, kept separate from the marketing summary. */
  storyline: string | null;
  /**
   * Steam application id, when this title is known to have a Steam listing.
   * IGDB publishes it via `external_games`, which is what lets an IGDB record
   * be enriched with Steam's pricing and system requirements.
   */
  steamAppId: number | null;
  website: string | null;
  /** Every involved studio with its role and brand mark. */
  companies: CompanyRef[];
  developers: Ref[];
  publishers: Ref[];
  supportingStudios: Ref[];
  tags: Ref[];
  themes: Ref[];
  gameModes: Ref[];
  playerPerspectives: Ref[];
  engines: LogoRef[];
  /** Canonical release series from IGDB Collections. */
  series: Ref[];
  /** Wider fictional/product franchises; intentionally separate from series. */
  franchises: Ref[];
  /** Free-form IGDB keywords, useful for discovery beyond formal genres. */
  keywords: Ref[];
  ageRatings: AgeRating[];
  languages: string[];
  multiplayerModes: MultiplayerModes | null;
  /** Key art, distinct from in-game screenshots. */
  artworks: string[];
  /** Platforms with IGDB marks and hardware metadata. */
  platformDetails: PlatformRef[];
  /** Per-region, per-platform release dates. */
  releases: ReleaseEvent[];
  /** Named cast, when IGDB has character records for the title. */
  characters: CharacterRef[];
  /** Downloadable content that depends on the base game. */
  dlcs: GameSummary[];
  /** Non-standalone expansions that depend on the base game. */
  expansions: GameSummary[];
  /** Expansions that are sold and played as their own games. */
  standaloneExpansions: GameSummary[];
  /** Alternate editions/versions of the same game. */
  editions: GameSummary[];
  bundles: GameSummary[];
  remakes: GameSummary[];
  remasters: GameSummary[];
  ports: GameSummary[];
  /** The base game, when this record is itself a DLC or expansion. */
  parentGame: Ref | null;
  /** Provider-curated similar titles, already expanded. */
  similar: GameSummary[];
  /** Combined critic + user score, 0–100. */
  totalRating: number | null;
  /** Pre-release anticipation count. */
  hypes: number;
  websites: WebsiteRef[];
  stores: StoreRef[];
  requirements: Requirement[];
  trailers: Trailer[];
  redditUrl: string | null;
  metacriticUrl: string | null;
  alternativeNames: string[];
  /** How many critic reviews `metacritic` aggregates (IGDB only). */
  criticCount?: number | null;
  timeToBeat?: TimeToBeat | null;
  palette?: CoverPalette | null;
  /** A clearly brighter backdrop for the hero in the light theme (see `art-light.ts`). */
  lightBackdrop?: string | null;
  externalIds?: ExternalIds | null;
  links?: ReferenceLinks | null;
  hypeIndex?: HypeIndex | null;
  /** Release-date changes we have observed over time (oldest first). */
  releaseChanges?: ReleaseChange[];
  /**
   * IGDB's development status when it says something beyond "released"
   * ("Alpha", "Beta", "Early Access", "Rumored"); null or absent otherwise.
   */
  devStatus?: "alpha" | "beta" | "early-access" | "rumored" | null;
}

/**
 * Fast-moving data for one game, fetched client-side from
 * `/api/game/[id]/live` so the page itself stays cacheable.
 * Every field is null when its source has nothing or is unreachable.
 */
export interface GameLiveData {
  steamPlayers: number | null;
  steamReviews: {
    description: string;
    positive: number;
    negative: number;
    total: number;
    /** 0–100 share of positive reviews. */
    percent: number;
    /**
     * The last 30 days on their own (Steam's daily review histogram), so a
     * game whose patches won players back — or lost them — shows it. Null
     * when the histogram couldn't be read or has too few reviews to mean
     * anything (see `RECENT_MIN_REVIEWS` in `score-spread.ts`).
     */
    recent?: { positive: number; negative: number; total: number; percent: number } | null;
  } | null;
  twitch: {
    viewers: number;
    streams: number;
    /** `language` is Twitch's ISO 639-1 broadcast language ("en", "de"), when given. */
    top: Array<{ user: string; title: string; viewers: number; thumbnail: string; url: string; language?: string | null }>;
  } | null;
  deals: {
    cheapest: { store: string; price: number; retail: number; savings: number; url: string } | null;
    stores: Array<{ store: string; price: number; retail: number; savings: number; url: string }>;
    historicalLow: { price: number; date: string } | null;
  } | null;
  news: Array<{ title: string; url: string; date: string; source: string; excerpt: string }>;
  gamePass: {
    console: boolean;
    pc: boolean;
    leavingSoon: boolean;
    recentlyAdded: boolean;
  } | null;
  fetchedAt: string;
}

export interface Page<T> {
  results: T[];
  count: number;
  hasNext: boolean;
  page: number;
}

export type SortKey =
  | "relevance"
  | "released"
  | "-released"
  | "-added"
  | "-rating"
  | "rating"
  | "-metacritic"
  | "metacritic"
  | "-hypes"
  | "hypes"
  | "-reviews"
  | "name"
  | "-name";

export interface BrowseFilters {
  search?: string;
  genres?: string;
  platforms?: string;
  ordering?: SortKey;
  dates?: string;
  page?: number;
  pageSize?: number;
  metacritic?: string;
  /**
   * Drop titles nobody is following.
   *
   * IGDB lists every announced game, and roughly two thirds of the upcoming
   * calendar has zero anticipation and no audience — asset-flip shovelware
   * scheduled against placeholder dates. Chronologically it is all perfectly
   * valid, which is exactly the problem: page after page of it looks identical
   * and buries the releases anyone is actually waiting for.
   */
  notableOnly?: boolean;
  /** Dated calendar or a dedicated, honestly undated/TBA view. */
  releaseTiming?: "dated" | "tba";
}

/**
 * Which provider answered a request. Surfaced in the UI so the data's origin is
 * always attributable, and so a total outage can be told apart from a
 * legitimately empty result.
 */
export type DataSource = "igdb" | "steam" | "unavailable";

export const SOURCE_LABELS: Record<DataSource, string> = {
  igdb: "IGDB",
  steam: "Steam",
  unavailable: "Live data unavailable",
};

export const isLiveSource = (source: DataSource): boolean => source !== "unavailable";

export interface Sourced<T> {
  data: T;
  source: DataSource;
}

/* ---------------------------------------------------------------------------
 * Market & PC data (prices, players, Steam Deck, achievements).
 * Served by /api/game/[id]/market, /players and /pc — see the route files.
 * Money is always integer minor units (cents, paise…) in `currency`.
 * ------------------------------------------------------------------------ */

/** A store's current price for one game in one country, in that country's currency. */
export interface LocalPrice {
  /**
   * "gog" (round 5) is GOG's own price for that country, in the currency GOG
   * charges there — which is USD in many countries (India, Japan, Korea…),
   * exactly as GOG bills it. Never converted by us.
   */
  store: "steam" | "microsoft" | "gog";
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** ISO 4217. */
  currency: string;
  price: number;
  initial: number | null;
  /** Percent off, 0–100. */
  discount: number;
  /** Pre-formatted for the locale, e.g. "₹3,599". */
  formatted: string;
  url: string;
  /**
   * The store's own product name, set only when it differs from the game's
   * (GOG often sells an edition: "The Witcher 3: Wild Hunt — Remastered").
   * Show it so a bundle price is never mistaken for the base game's.
   */
  productTitle?: string;
}

export interface PricePoint {
  /** YYYY-MM-DD. */
  date: string;
  store: LocalPrice["store"];
  price: number;
  initial: number | null;
}

export type PriceVerdictKind = "buy" | "wait" | "fair" | "unknown";

export interface GameMarket {
  country: string;
  currency: string | null;
  prices: LocalPrice[];
  /** Our own daily observations in this country, oldest first. */
  history: PricePoint[];
  lowest: { price: number; date: string; store: LocalPrice["store"] } | null;
  verdict: { kind: PriceVerdictKind; reason: string };
  /** Steam price in other regions, converted into `currency` for comparison. */
  regional: RegionalPrice[];
  /** ISO date our tracking for this game/country began, if any. */
  trackingSince: string | null;
  /**
   * CheapShark's all-time low across the stores it tracks, in US dollars: a
   * labelled historic marker ("Lowest ever (US, all stores)"), never a local
   * price, and never mixed into `history`, `lowest` or the verdict. Filled on
   * `/insights` from the live deals lookup (no extra request); absent on
   * `/market`.
   */
  lowestEver?: LowestEverPrice | null;
}

/** See `GameMarket.lowestEver`. */
export interface LowestEverPrice {
  /** US cents. */
  price: number;
  currency: "USD";
  /** YYYY-MM-DD. */
  date: string;
  label: "Lowest ever (US, all stores)";
  source: "cheapshark";
  /**
   * That low as a discount off the US retail price CheapShark lists, 0–100
   * (null when no retail price is known). Comparable across currencies,
   * which the dollar figure isn't — it drives "has been X% off before".
   */
  deepestDiscount?: number | null;
}

export interface RegionalPrice {
  country: string;
  currency: string;
  /** Minor units, local currency. */
  price: number;
  formatted: string;
  /** Converted into the viewer's currency (minor units), or null without FX. */
  converted: number | null;
  discount: number;
}

export interface PlayerHistory {
  appId: number;
  /** Hourly samples, oldest first. `t` is unix seconds. */
  points: Array<{ t: number; players: number }>;
  peak24h: number | null;
  peakTracked: number | null;
  since: string | null;
}

export type DeckStatus = "verified" | "playable" | "unsupported" | "unknown";
export type ProtonTier = "platinum" | "gold" | "silver" | "bronze" | "borked" | "pending" | "native";

export interface AchievementStats {
  total: number;
  highlighted: Array<{ name: string; icon: string }>;
  /** How many achievements fall in each global-unlock-rate band. */
  rarity: { ultraRare: number; rare: number; uncommon: number; common: number };
  /** Percent of players. */
  rarest: number | null;
  mostCommon: number | null;
}

export interface GamePcInfo {
  deck: DeckStatus | null;
  proton: { tier: ProtonTier; reports: number; confidence: string | null } | null;
  achievements: AchievementStats | null;
  /** Parsed Steam PC requirements, when Steam publishes them. */
  requirements?: PcRequirements | null;
}

/* ---------------------------------------------------------------------------
 * Round 4 contracts: hardware, patches, review/Twitch/score history,
 * batch prices and Game Pass matching. Where they come from:
 *   /api/game/[id]/insights  → GameInsights (live + market + pc + patches)
 *   Firestore, read in the browser (see stats-docs.ts):
 *     reviewHistory/{appid}  → ReviewVelocity   twitchHistory/{id} → TwitchHistory
 *     scoreHistory/{igdbId}  → ScoreTimeline    playerHistory/{appid} → PlayerHistory
 *   POST /api/prices         → BatchPrices      body { ids: number[], cc }
 *   POST /api/gamepass/match → GamePassMatches  body { ids: number[] }
 * ------------------------------------------------------------------------ */

/** One tier of Steam's PC requirements, normalised for comparison. */
export interface PcRequirementTier {
  cpu: string | null;
  gpu: string | null;
  ramGb: number | null;
  vramGb: number | null;
  storageGb: number | null;
  os: string | null;
  /** The original text, for display when parsing is partial. */
  raw: string;
}

export interface PcRequirements {
  minimum: PcRequirementTier | null;
  recommended: PcRequirementTier | null;
}

export type PcFormFactor = "desktop" | "laptop" | "handheld";
export type PcStorageKind = "nvme" | "sata-ssd" | "hdd";
export type PcOs = "windows" | "macos" | "linux" | "steamos";
export type PcResolution = "720p" | "1080p" | "1440p" | "4k";
export type PcQuality = "low" | "medium" | "high" | "max";

/** What the reader wants from a game: "Smooth 1080p", "Max settings 1440p 60". */
export interface PcGoal {
  resolution: PcResolution;
  fps: 30 | 60 | 120;
  quality: PcQuality;
}

/**
 * The reader's own PC, entered once and kept on the device (mirrored to the
 * account when signed in). Only the three parts are required; everything
 * else was added later and is optional, so older saved specs stay valid.
 */
export interface UserPcSpecs {
  cpu: string;
  gpu: string;
  ramGb: number;
  formFactor?: PcFormFactor;
  /** Video memory, GB. */
  vramGb?: number;
  storage?: PcStorageKind;
  /** Free space on the drive games go on, GB. */
  freeStorageGb?: number;
  os?: PcOs;
  /** The screen games run on. */
  display?: { resolution: PcResolution; refreshHz?: number };
  goal?: PcGoal;
}

export type HardwareVerdictKind = "great" | "ok" | "below" | "unknown";

export type HardwarePart = "CPU" | "GPU" | "RAM" | "VRAM" | "Storage";

/** How a resolution/settings combination should go, judged from the GPU. */
export interface HardwareOutlook {
  /** "1080p High", "1440p Max". */
  label: string;
  fps: number;
  level: "great" | "ok" | "lower" | "no";
  /** The reader's own goal, when this row is it. */
  goal?: boolean;
}

export interface HardwareVerdict {
  kind: HardwareVerdictKind;
  /** Per-component comparison, e.g. { part: "GPU", yours: "RTX 3060", needed: "GTX 1060", ok: true }. */
  parts: Array<{ part: HardwarePart; yours: string; needed: string | null; ok: boolean | null }>;
  /** One plain sentence. */
  summary: string;
  /**
   * The smarter sentence when we know enough about the reader's goals and
   * GPU: "Runs well at 1080p High; 1440p needs lower settings".
   */
  headline?: string;
  /** Resolution ladder, each judged against the game's recommended GPU. */
  outlook?: HardwareOutlook[];
  /** Plain reasons and caveats (VRAM, storage, laptop power, OS), most important first. */
  reasons?: string[];
}

/** A Steam patch/update post condensed into "what changed". */
export interface PatchNote {
  title: string;
  date: string; // ISO
  url: string;
  /** Grouped bullet points ("Fixes", "Balance", "New"…), extracted, not invented. */
  sections: Array<{ heading: string; items: string[] }>;
  /** Up to 5 headline bullets for the collapsed card. */
  highlights: string[];
  /** Total bullet count in the original, so "+23 more" can be shown. */
  totalItems: number;
}

/**
 * One developer post from a game's Steam announcement feed, for the updates
 * timeline: patch posts and everything else (events, roadmaps, news). The
 * excerpt is plain text cut from the post — never markup.
 */
export interface UpdatePost {
  title: string;
  date: string; // ISO
  url: string;
  /** Steam's `patchnotes` tag, or a patch-like title backed by a real list (`isPatchPost`). */
  patch: boolean;
  excerpt: string;
}

export interface ReviewVelocity {
  appId: number;
  /** Cumulative Steam review totals over time, oldest first. `t` is unix seconds. */
  points: Array<{ t: number; total: number; positive: number }>;
  /** Reviews and % positive in the first 72h after launch, when we tracked that window. */
  first72h: { reviews: number; positivePct: number } | null;
  /** Average new reviews per day over the last 7 tracked days. */
  perDay: number | null;
  since: string | null;
}

export interface TwitchHistory {
  twitchId: string;
  /** Viewers across the top streams, sampled over time. `t` is unix seconds. */
  points: Array<{ t: number; viewers: number; streams: number }>;
  peak24h: number | null;
  peakTracked: number | null;
  since: string | null;
}

export interface ScoreTimeline {
  /** Daily IGDB critic aggregate observations, oldest first. */
  points: Array<{ date: string; score: number; count: number }>;
  since: string | null;
}

/** Keyed by IGDB id; null when no store price is known in that country. */
export type BatchPrices = Record<string, LocalPrice | null>;

export interface GamePassMatch {
  console: boolean;
  pc: boolean;
  leavingSoon: boolean;
  recentlyAdded: boolean;
}

/** Keyed by IGDB id; only games found in any Game Pass list are present. */
export type GamePassMatches = Record<string, GamePassMatch>

/** How reliably a studio ships on its announced dates (from our D1 history). */
export interface StudioReliability {
  tracked: number;
  delayed: number;
  avgDaysLate: number | null;
  since: string | null;
}

/**
 * Everything the game page fetches from the Worker, in one response
 * (`/api/game/[id]/insights?cc=`), so a page view costs one API request
 * instead of eight. History series are read from Firestore directly.
 */
export interface GameInsights {
  /** The ids the server resolved (hints confirmed or filled from IGDB). */
  ids: {
    key: number | null;
    igdbId: number | null;
    steam: number | null;
    microsoft: string | null;
    twitch: string | null;
  };
  live: GameLiveData;
  /** Null when the game has no store ids, or when the market failed (see `unavailable`). */
  market: GameMarket | null;
  /** Null without a Steam app. */
  pc: GamePcInfo | null;
  /** Null without a Steam app, or when Steam couldn't be reached (see `unavailable`). */
  patches: PatchNote[] | null;
  /**
   * The same feed as `patches`, every recent post (newest first, ≤ 12) for
   * the updates timeline; null exactly when `patches` is. Optional because
   * answers cached before it existed lack it.
   */
  updates?: UpdatePost[] | null;
  /** Parts that were applicable but failed — "couldn't ask", not "nothing to show". */
  unavailable: Array<"market" | "pc" | "patches" | "cloud" | "antiCheat">;
  /** GeForce NOW membership (round 5). `geforceNow` is null when NVIDIA's list couldn't be read. */
  cloud: { geforceNow: GeForceNowMembership | null };
  /**
   * Linux / Steam Deck anti-cheat status. Null when AreWeAntiCheatYet doesn't
   * track the game — which means "no known kernel/anti-cheat issue recorded",
   * not "has no anti-cheat".
   */
  antiCheat: AntiCheatStatus | null;
}

/* ---------------------------------------------------------------------------
 * Round 5: cloud play, community data, accessibility, people, free games and
 * recommendations v2. Where they come from:
 *   /api/game/[id]/insights       → GameInsights (+ cloud, antiCheat, GOG price, lowestEver)
 *   /api/game/[id]/extras         → GameExtras (SteamSpy, PCGamingWiki, speedrun.com, mods, people)
 *   POST /api/cloud/match         → CloudMatchResponse   body { ids: number[] }
 *   POST /api/recommendations/v2  → RecommendationsV2   body RecsProfile
 *   server functions: getGeForceNowHighlights(), getEpicFreeGames(cc), getPerson(qid)
 * ------------------------------------------------------------------------ */

/** A game's place in NVIDIA's public GeForce NOW catalogue. */
export interface GeForceNowMembership {
  /** Listed and currently playable (NVIDIA status "AVAILABLE"). */
  available: boolean;
  /** Store of the matched entry ("Steam", "Epic", "Ubisoft Connect", …), null when not listed. */
  store: string | null;
  /** Every store NVIDIA lists the game under (you need to own it on one). */
  stores: string[];
  /** NVIDIA's "fully optimized" flag. */
  optimized: boolean;
  status: "available" | "maintenance" | "patching" | "not-listed";
  /** How the match was made; title matches are exact after normalisation. */
  matchedBy: "steam" | "title" | null;
}

/** Cloud/subscription availability for one game; see `CloudMatches`. */
export interface CloudMatch {
  gamePass: GamePassMatch | null;
  geforceNow: GeForceNowMembership | null;
}

/** Keyed by IGDB id; only games on Game Pass or GeForce NOW are present. */
export type CloudMatches = Record<string, CloudMatch>;

/** `POST /api/cloud/match` response. `unavailable` names a catalogue that couldn't be read. */
export interface CloudMatchResponse {
  matches: CloudMatches;
  unavailable: Array<"gamePass" | "geforceNow">;
}

export type AntiCheatState = "supported" | "running" | "planned" | "broken" | "denied";

/** From AreWeAntiCheatYet: does the game's anti-cheat work on Linux / Steam Deck? */
export interface AntiCheatStatus {
  status: AntiCheatState;
  /** e.g. ["Easy Anti-Cheat"]. */
  anticheats: string[];
  /** Has a native Linux build. */
  native: boolean;
  /** ISO timestamp of the entry's last change, when given. */
  updated: string | null;
  /** The AreWeAntiCheatYet page for the game. */
  url: string;
}

/** SteamSpy's estimates for one Steam app (cached 24 h). */
export interface SteamSpyData {
  appId: number;
  /** User-applied Steam tags, most-voted first (≤ 20). */
  tags: Array<{ name: string; votes: number }>;
  /** SteamSpy's owner bracket, e.g. { low: 20000000, high: 50000000 }. An estimate. */
  owners: { low: number; high: number } | null;
  /** Peak concurrent players yesterday. */
  ccu: number | null;
  /**
   * Hours. SteamSpy stopped publishing playtime for most apps (it reports 0),
   * so these are usually null — never shown as zero.
   */
  playtime: { average: number | null; median: number | null; average2Weeks: number | null; median2Weeks: number | null };
  /** Steam review counts as SteamSpy last saw them. */
  positive: number;
  negative: number;
}

/** PCGamingWiki's support values, normalised. "n/a" = not applicable to the game. */
export type PcgwSupport = "true" | "false" | "limited" | "hackable" | "always on" | "n/a";

export type PcgwFeatureKey =
  | "ultrawide"
  | "4k"
  | "hdr"
  | "fov"
  | "borderless"
  | "fps60"
  | "fps120"
  | "upscaling"
  | "frameGen"
  | "rayTracing"
  | "vsync"
  | "colorBlind"
  | "keyRemap"
  | "controller"
  | "fullController"
  | "controllerRemap"
  | "playstationControllers"
  | "touchscreen"
  | "subtitles"
  | "closedCaptions"
  | "separateVolume"
  | "surround"
  | "monoAudio";

/** Features and accessibility from a PCGamingWiki article (`{{Video}}`, `{{Input}}`, `{{Audio}}`). */
export interface PcgwFeatures {
  /** Article title and URL (credit/link-out). */
  page: string;
  url: string;
  /** Only features the article states are present; "unknown" and blanks are left out. */
  values: Partial<Record<PcgwFeatureKey, PcgwSupport>>;
  /** Upscaler names from `upscaling tech`, e.g. ["DLSS", "FSR 2"]. */
  upscaling: string[];
}

/** World records from speedrun.com (full-game categories). */
export interface SpeedrunRecords {
  game: { id: string; name: string; url: string };
  records: Array<{
    category: string;
    /** Leaderboard URL for the category. */
    url: string;
    /** Seconds (primary timing). */
    seconds: number;
    /** e.g. "24:48.843" or "1:02:03". */
    time: string;
    date: string | null;
    runners: Array<{ name: string; url: string | null }>;
    runUrl: string;
    video: string | null;
    /** speedrun.com's "miscellaneous" flag: side categories after the main ones. */
    misc: boolean;
  }>;
}

export interface ThunderstoreMod {
  name: string;
  owner: string;
  description: string;
  downloads: number;
  /** Thunderstore "likes". */
  rating: number;
  icon: string | null;
  url: string;
  updated: string | null;
  categories: string[];
  /** Pinned by the community: usually the mod loader/manager everything else needs (BepInEx, r2modman). */
  pinned: boolean;
}

/** Mods: Thunderstore's most-downloaded packages, plus link-outs (no scraping). */
export interface GameMods {
  thunderstore: { community: string; name: string; url: string; total: number; top: ThunderstoreMod[] } | null;
  links: {
    /** Nexus Mods search (link-out; Nexus has no open API). */
    nexus: string;
    /** Only when Steam lists the "Steam Workshop" feature for the app. */
    steamWorkshop: string | null;
  };
}

export type PersonRole = "director" | "designer" | "composer" | "producer" | "writer";

/** A credited person on a game, from Wikidata. `qid` addresses `/person/[qid]`. */
export interface GamePerson {
  qid: string;
  name: string;
  roles: PersonRole[];
  /** Wikimedia Commons thumbnail (≈ 256 px wide), when Wikidata has a portrait. */
  image: string | null;
}

/** `getPerson(qid)` — a person page. */
export interface Person {
  qid: string;
  name: string;
  /** Wikidata's one-line English description, e.g. "Japanese video game director". */
  description: string | null;
  image: string | null;
  wikipedia: string | null;
  /** Every role across their games, most frequent first. */
  roles: PersonRole[];
  /** Their games on IGDB, newest first, each with the roles held on it. */
  games: Array<{ game: GameSummary; roles: PersonRole[] }>;
}

/** The lazily-requested second part of a game page (`/api/game/[id]/extras`). */
export interface GameExtras {
  ids: { igdbId: number | null; steam: number | null; slug: string | null };
  steamSpy: SteamSpyData | null;
  pcgw: PcgwFeatures | null;
  speedrun: SpeedrunRecords | null;
  mods: GameMods;
  people: GamePerson[];
  /**
   * Track records of the game's developers (≤ 2), in the order the `dev`
   * hint named them. Optional: answers cached before it existed lack it.
   */
  studios?: StudioRecord[];
  /** Parts that were applicable but failed — "couldn't ask", not "nothing to show". */
  unavailable: Array<"steamSpy" | "pcgw" | "speedrun" | "mods" | "people" | "studios">;
}

/**
 * A developer's track record (`studio-record.ts`): how its released games
 * scored with critics and, from our own delay tracker, how often its dates
 * held. Every figure carries its sample size so a two-game studio isn't
 * read like a fifty-game one.
 */
export interface StudioRecord {
  id: number;
  name: string;
  slug: string;
  /** Released main games (no DLC, editions or bundles). */
  released: number;
  upcoming: number;
  /** Released games with at least `MIN_CRITICS` critic reviews, and their mean. */
  scored: number;
  avgCritic: number | null;
  /** Highest-rated of those. */
  best: { name: string; slug: string; score: number } | null;
  /** IGDB listed more credits than one request returns: the counts are a floor. */
  truncated: boolean;
  /** Our delay history for the studio's games; null when it couldn't be read. */
  reliability: StudioReliability | null;
}

/** One free-to-keep promotion on the Epic Games Store. */
export interface EpicFreeGame {
  id: string;
  title: string;
  url: string;
  /** Portrait key art (OfferImageTall), else the wide one. */
  image: string | null;
  imageWide: string | null;
  /** ISO timestamps of the free window. */
  start: string;
  end: string;
  /** Normal local price, pre-formatted ("₹469.00"), when Epic gives one. */
  originalPrice: string | null;
  /** The IGDB game, when the title matches exactly. */
  game: GameSummary | null;
}

export interface EpicFreeGames {
  country: string;
  /** Free right now. */
  current: EpicFreeGame[];
  /** Announced next. */
  upcoming: EpicFreeGame[];
}

/* ---------------------------------------------------------------------------
 * Recommendations v2 (POST /api/recommendations/v2)
 * ------------------------------------------------------------------------ */

/**
 * The anonymous taste profile the browser sends — game ids and weights only,
 * built by `buildTasteProfile` in `src/lib/recs/profile.ts`.
 */
export interface RecsProfile {
  v: 2;
  /** Weighted seeds: w > 0 liked (≤ 3), w < 0 disliked (≥ -3). ≤ 16 positive + 8 negative. */
  seeds: Array<{ id: number; w: number }>;
  /** Everything already in the library (owned/played/playing/want/followed). ≤ 600. */
  exclude: number[];
  /** "Not interested" / thumbs-down ids. ≤ 200. */
  dismissed: number[];
  /** Recommended before and ignored. ≤ 200. */
  ignored: number[];
  /** Owned platforms: family keys ("pc", "playstation"…) or IGDB system slugs ("ps5", "switch"). ≤ 12. */
  platforms: string[];
  /** Subscription slugs that change availability: "game-pass", "geforce-now". */
  services: string[];
  /** Typical hours to finish the games they complete; null when unknown. */
  lengthHours: number | null;
}

export type RecReasonKind =
  | "seed"
  | "shares"
  | "series"
  | "developer"
  | "platform"
  | "gamePass"
  | "geforceNow"
  | "quality"
  | "gem"
  | "length"
  | "upcoming"
  | "new"
  | "steamTag";

export interface RecReason {
  kind: RecReasonKind;
  /** Display sentence: "Because you loved Elden Ring", "Shares: dark fantasy, open world". */
  text: string;
}

export interface RecommendedGame {
  game: GameSummary;
  /** 0–1 relevance after all boosts and penalties. */
  score: number;
  /** Most important first; at most 4. */
  reasons: RecReason[];
}

export interface RecommendationsV2 {
  /** False when the profile was too thin and these are quality picks, not taste picks. */
  personalised: boolean;
  forYou: RecommendedGame[];
  becauseYouLiked: Array<{ seed: { id: number; name: string; slug: string }; games: RecommendedGame[] }>;
  hiddenGems: RecommendedGame[];
  /** Released in the last ~4 months. */
  newForYou: RecommendedGame[];
  comingSoonForYou: RecommendedGame[];
  /** Playable on an owned platform (or via Game Pass / GeForce NOW when subscribed). */
  onYourDevices: RecommendedGame[];
  generatedAt: string;
}

