/**
 * Shared contracts for first-party analytics.
 *
 * Imported by the browser tracker, the ingest route and the admin dashboard,
 * so the wire format and the stats payload can't drift between them. Nothing
 * here touches the network or the runtime — it is safe on both sides.
 */

/** Event types a browser may send. `search` is deliberately absent: it is
 *  only ever recorded server-side, so it can't be inflated from a console. */
export const CLIENT_EVENT_TYPES = ["pageview", "vital", "follow", "own", "signup"] as const;
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export type Device = "mobile" | "tablet" | "desktop";
export const DEVICES: readonly Device[] = ["mobile", "tablet", "desktop"];

export const VITAL_NAMES = ["LCP", "INP", "CLS"] as const;
export type VitalName = (typeof VITAL_NAMES)[number];

/**
 * Core Web Vitals thresholds (web.dev). At or below `good` is good; above
 * `poor` is poor; anything between needs improvement. LCP/INP are in ms,
 * CLS is unitless.
 */
export const VITAL_THRESHOLDS: Record<VitalName, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
};

/** One event as the browser sends it. Every field but `type` is optional and
 *  validated per type on the server; unknown fields are ignored. */
export interface ClientEvent {
  type: ClientEventType;
  path?: string;
  /** External referrer host, first pageview of a page load only. */
  ref?: string | null;
  device?: Device;
  /** Game slug for follow/own. */
  slug?: string;
  /** Vital name for `vital`. */
  name?: VitalName;
  /**
   * Meaning depends on type: the metric for `vital`; 1 = follow / 0 =
   * unfollow for `follow`; 1 = the page load's entry pageview for `pageview`
   * (the cookieless stand-in for "a visit").
   */
  value?: number;
  /** ISO week of the device's first visit ("2026-W42"); first pageview of a day only. */
  cohort?: string;
  /** First pageview of a day only — see `VisitKind`. */
  visit?: VisitKind;
  /** The shelf/rail that led here (`home:trending`); see `lib/analytics/attribution`. */
  src?: string;
}

/**
 * How the first pageview of a UTC day relates to the device's history.
 *
 * - `new`: the first visit this browser has ever made (its cohort week starts).
 * - `return-wk`: a returning browser's first visit *this ISO week* — counting
 *   these per week gives "how many of a cohort came back that week" without
 *   any identifier, so retention can't exceed 100% from one keen visitor.
 * - `return`: any other returning day.
 *
 * Return days are therefore `return` + `return-wk`.
 */
export const VISIT_KINDS = ["new", "return", "return-wk"] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];

/** `2026-W42`. Shared by the tracker (writer) and the ingest validator. */
export const COHORT_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
/** `home:trending`, `game:related`, `search` — lowercase, short, no spaces. */
export const SRC_RE = /^[a-z0-9][a-z0-9:_.-]{0,63}$/;

/** The ingest route refuses anything larger; the tracker never comes close. */
export const MAX_TRACK_BODY_BYTES = 2048;
export const MAX_EVENTS_PER_REQUEST = 5;

// ---------------------------------------------------------------------------
// Stats payload (GET /api/admin/stats)
// ---------------------------------------------------------------------------

export const STATS_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export function isStatsRange(value: unknown): value is StatsRange {
  return typeof value === "string" && (STATS_RANGES as readonly string[]).includes(value);
}

/** A count for the selected period and the same elapsed span of the one before. */
export interface Kpi {
  current: number;
  previous: number;
}

export interface SeriesPoint {
  /** Bucket start, unix seconds (UTC). */
  t: number;
  pageviews: number;
  gameViews: number;
  searches: number;
  follows: number;
  owns: number;
  signups: number;
}

export interface VitalSummary {
  name: VitalName;
  /** Null when there are no samples. */
  p75: number | null;
  samples: number;
  good: number;
  needsImprovement: number;
  poor: number;
}

export interface FunnelRow {
  device: Device | "unknown";
  visits: number;
  gameViews: number;
  follows: number;
  signups: number;
}

export interface StatsResponse {
  range: StatsRange;
  bucket: "hour" | "day";
  /** Current period [since, until], unix seconds. */
  since: number;
  until: number;
  generatedAt: number;
  /** Lifetime totals, so an empty range can say "nothing *in this range*". */
  lifetime: { events: number; firstEventAt: number | null };
  kpis: {
    pageviews: Kpi;
    searches: Kpi;
    follows: Kpi;
    owns: Kpi;
    signups: Kpi;
    /** Game-page views — the denominator of follow rate. */
    gameViews: Kpi;
  };
  series: SeriesPoint[];
  topPages: { path: string; count: number }[];
  topGames: { slug: string; views: number; follows: number; owns: number }[];
  topSearches: { query: string; count: number; avgResults: number }[];
  zeroResultSearches: { query: string; count: number; lastSeen: number }[];
  referrers: { host: string; count: number }[];
  countries: { code: string; count: number }[];
  /** Pageviews with no country (local dev, Tor, or no Cloudflare header). */
  unknownCountry: number;
  devices: { device: Device | "unknown"; count: number }[];
  vitals: VitalSummary[];
  funnel: FunnelRow[];
  /**
   * First-of-day pageviews from returning browsers vs all first-of-day
   * pageviews ("visitor-days"), current and previous period.
   */
  returning: { current: number; previous: number; currentDays: number; previousDays: number };
  retention: RetentionCohort[];
  attribution: AttributionRow[];
}

/** One row of the retention triangle. Weeks are ISO weeks (Monday, UTC). */
export interface RetentionCohort {
  /** `2026-W42`. */
  cohort: string;
  /** Monday 00:00 UTC of the cohort week, unix seconds. */
  weekStart: number;
  /** Browsers whose first visit fell in this week (`visit = 'new'`). */
  size: number;
  /**
   * Index = weeks since the cohort week (0 is the cohort week itself).
   * `returners` counts first-of-week return pageviews (≈ distinct returning
   * browsers); `returnDays` counts every returning day. Null = week not reached yet.
   */
  weeks: ({ returners: number; returnDays: number } | null)[];
}

export interface AttributionRow {
  /** `home:trending`, or "" for game views with no recorded source. */
  src: string;
  views: number;
  follows: number;
  signups: number;
}

// ---------------------------------------------------------------------------
// Presence (GET /api/admin/presence)
// ---------------------------------------------------------------------------

export interface PresenceSnapshot {
  /** Null when live presence isn't available in this environment. */
  online: number | null;
  available: boolean;
  pages: { path: string; count: number }[];
  /** Unix ms. */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Search fixes (GET/POST /api/admin/search-fixes)
// ---------------------------------------------------------------------------

export interface AliasCandidate {
  id: number;
  slug: string;
  name: string;
  image: string | null;
  /** Release year or window, for telling remakes apart. */
  year: string | null;
}

export type AliasStatus = "suggested" | "approved" | "dismissed";

export interface SearchFix {
  alias: string;
  status: AliasStatus;
  /** Zero-result searches seen for this exact query. */
  hits: number;
  /** The mapped game once approved. */
  game: AliasCandidate | null;
  /** Null until proposed (fetched lazily, one IGDB round-trip each). */
  candidates: AliasCandidate[] | null;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Weekly digest (GET/POST /api/admin/digest)
// ---------------------------------------------------------------------------

export type DigestDelivery = "sent" | "not-configured" | "failed";

export interface DigestRecord {
  id: number;
  kind: "scheduled" | "test";
  /** Unix seconds. */
  createdAt: number;
  periodStart: number;
  periodEnd: number;
  subject: string;
  html: string;
  text: string;
  delivery: DigestDelivery;
  recipients: number;
  /** Provider error, trimmed — never shown outside /admin. */
  error: string | null;
}

/** Why the stats route refused — drives the dashboard's locked states. */
export type AdminDenial = "signed-out" | "unverified" | "not-admin" | "not-configured" | "invalid-token";
