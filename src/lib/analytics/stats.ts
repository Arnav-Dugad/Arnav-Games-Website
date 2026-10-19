/**
 * Dashboard aggregates, computed in SQL on D1.
 *
 * Everything for one range is a single `db.batch()` — one round-trip — and
 * every query is bounded by the range's timestamps so it rides the
 * `(type, ts)` / `(ts)` indexes rather than scanning history.
 *
 * Periods. Charts use buckets aligned to UTC hours (24h) or UTC days, ending
 * with the bucket that contains "now", so the latest bar is partial. Deltas
 * compare the current period with the *same elapsed span* of the previous
 * one ([since − span, now − span]) — comparing a part-finished day with a
 * whole one would make every morning look like a crash.
 */

import type { D1Database } from "@/lib/cloudflare/db";
import {
  DEVICES,
  VITAL_NAMES,
  VITAL_THRESHOLDS,
  type Device,
  type FunnelRow,
  type Kpi,
  type SeriesPoint,
  type StatsRange,
  type StatsResponse,
  type VitalName,
  type VitalSummary,
} from "./types";

const HOUR = 3600;
const DAY = 86_400;

const RANGES: Record<StatsRange, { span: number; bucket: number }> = {
  "24h": { span: DAY, bucket: HOUR },
  "7d": { span: 7 * DAY, bucket: DAY },
  "30d": { span: 30 * DAY, bucket: DAY },
  "90d": { span: 90 * DAY, bucket: DAY },
};

/** A pageview of a game detail page. `_` would be a LIKE wildcard; `/` isn't. */
const GAME_PATH = "path LIKE '/game/%'";
/** Follows only — unfollows are recorded with value 0 and excluded. */
const FOLLOW = "type = 'follow' AND value = 1";

// Thresholds come from the shared constants so the colour coding on the
// dashboard and the good/poor split here can never disagree.
const T = VITAL_THRESHOLDS;
const GOOD_CASE = `CASE name WHEN 'LCP' THEN value <= ${T.LCP.good} WHEN 'INP' THEN value <= ${T.INP.good} ELSE value <= ${T.CLS.good} END`;
const POOR_CASE = `CASE name WHEN 'LCP' THEN value > ${T.LCP.poor} WHEN 'INP' THEN value > ${T.INP.poor} ELSE value > ${T.CLS.poor} END`;

/** The game slug from `/game/<slug>[/…]`. */
const SLUG_FROM_PATH =
  "CASE WHEN instr(substr(path, 7), '/') > 0 THEN substr(substr(path, 7), 1, instr(substr(path, 7), '/') - 1) ELSE substr(path, 7) END";

type Row = Record<string, unknown>;
const n = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const s = (value: unknown): string => (typeof value === "string" ? value : "");

export async function computeStats(db: D1Database, range: StatsRange): Promise<StatsResponse> {
  const { span, bucket } = RANGES[range];
  const now = Math.floor(Date.now() / 1000);
  const until = Math.floor(now / bucket) * bucket + bucket; // end of the current bucket
  const since = until - span;
  const prevSince = since - span;
  const prevUntil = now - span;

  const q = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds);

  const statements = [
    // 0 — KPI counts, current vs previous
    q(
      `SELECT CASE WHEN ts >= ?1 THEN 1 ELSE 0 END AS cur,
         SUM(type = 'pageview') AS pageviews,
         SUM(type = 'pageview' AND ${GAME_PATH}) AS game_views,
         SUM(type = 'search') AS searches,
         SUM(${FOLLOW}) AS follows,
         SUM(type = 'own') AS owns,
         SUM(type = 'signup') AS signups
       FROM analytics_events
       WHERE (ts >= ?1 AND ts <= ?2) OR (ts >= ?3 AND ts <= ?4)
       GROUP BY cur`,
      since, now, prevSince, prevUntil,
    ),
    // 1 — time series
    q(
      `SELECT CAST((ts - ?1) / ?2 AS INTEGER) AS b,
         SUM(type = 'pageview') AS pageviews,
         SUM(type = 'pageview' AND ${GAME_PATH}) AS game_views,
         SUM(type = 'search') AS searches,
         SUM(${FOLLOW}) AS follows,
         SUM(type = 'own') AS owns,
         SUM(type = 'signup') AS signups
       FROM analytics_events
       WHERE ts >= ?1 AND ts < ?3
       GROUP BY b`,
      since, bucket, until,
    ),
    // 2 — top pages
    q(
      `SELECT path, COUNT(*) AS c FROM analytics_events
       WHERE type = 'pageview' AND ts >= ?1 AND path IS NOT NULL
       GROUP BY path ORDER BY c DESC, path LIMIT 10`,
      since,
    ),
    // 3 — game page views by slug
    q(
      `SELECT ${SLUG_FROM_PATH} AS slug, COUNT(*) AS c FROM analytics_events
       WHERE type = 'pageview' AND ts >= ?1 AND ${GAME_PATH}
       GROUP BY slug ORDER BY c DESC LIMIT 25`,
      since,
    ),
    // 4 — follows/owns by slug
    q(
      `SELECT game_slug AS slug, SUM(${FOLLOW}) AS follows, SUM(type = 'own') AS owns
       FROM analytics_events
       WHERE type IN ('follow', 'own') AND ts >= ?1 AND game_slug IS NOT NULL
       GROUP BY game_slug ORDER BY SUM(${FOLLOW}) + SUM(type = 'own') DESC LIMIT 25`,
      since,
    ),
    // 5 — top searches
    q(
      `SELECT query, COUNT(*) AS c, AVG(results) AS r FROM analytics_events
       WHERE type = 'search' AND ts >= ?1 AND query IS NOT NULL
       GROUP BY query ORDER BY c DESC, query LIMIT 10`,
      since,
    ),
    // 6 — searches that found nothing
    q(
      `SELECT query, COUNT(*) AS c, MAX(ts) AS last FROM analytics_events
       WHERE type = 'search' AND ts >= ?1 AND results = 0 AND query IS NOT NULL
       GROUP BY query ORDER BY c DESC, last DESC LIMIT 15`,
      since,
    ),
    // 7 — referrers
    q(
      `SELECT ref_host, COUNT(*) AS c FROM analytics_events
       WHERE type = 'pageview' AND ts >= ?1 AND ref_host IS NOT NULL
       GROUP BY ref_host ORDER BY c DESC LIMIT 10`,
      since,
    ),
    // 8 — countries ('' = unknown)
    q(
      `SELECT COALESCE(country, '') AS code, COUNT(*) AS c FROM analytics_events
       WHERE type = 'pageview' AND ts >= ?1
       GROUP BY code ORDER BY c DESC LIMIT 13`,
      since,
    ),
    // 9 — devices
    q(
      `SELECT COALESCE(device, 'unknown') AS d, COUNT(*) AS c FROM analytics_events
       WHERE type = 'pageview' AND ts >= ?1
       GROUP BY d`,
      since,
    ),
    // 10 — vitals: sample counts and good/poor split
    q(
      `SELECT name, COUNT(*) AS c, SUM(${GOOD_CASE}) AS good, SUM(${POOR_CASE}) AS poor
       FROM analytics_events
       WHERE type = 'vital' AND ts >= ?1 AND name IS NOT NULL AND value IS NOT NULL
       GROUP BY name`,
      since,
    ),
    // 11 — vitals p75 (nearest-rank via window functions)
    q(
      `SELECT name, value FROM (
         SELECT name, value,
           ROW_NUMBER() OVER (PARTITION BY name ORDER BY value) AS rn,
           COUNT(*) OVER (PARTITION BY name) AS total
         FROM analytics_events
         WHERE type = 'vital' AND ts >= ?1 AND name IS NOT NULL AND value IS NOT NULL
       ) WHERE rn = CAST((total * 3 + 3) / 4 AS INTEGER)`,
      since,
    ),
    // 12 — funnel stages by device
    q(
      `SELECT COALESCE(device, 'unknown') AS d,
         SUM(type = 'pageview' AND value = 1) AS visits,
         SUM(type = 'pageview' AND ${GAME_PATH}) AS game_views,
         SUM(${FOLLOW}) AS follows,
         SUM(type = 'signup') AS signups
       FROM analytics_events
       WHERE ts >= ?1 AND type IN ('pageview', 'follow', 'signup')
       GROUP BY d`,
      since,
    ),
    // 13 — lifetime
    q(`SELECT COUNT(*) AS c, MIN(ts) AS first FROM analytics_events`),
  ];

  const results = await db.batch(statements);
  const rows = (i: number): Row[] => (results[i]?.results ?? []) as Row[];

  // --- KPIs
  const period = (cur: 0 | 1) => rows(0).find((row) => n(row.cur) === cur) ?? {};
  const current = period(1);
  const previous = period(0);
  const kpi = (key: string): Kpi => ({ current: n(current[key]), previous: n(previous[key]) });

  // --- Series (zero-filled so gaps read as zero, not as missing points)
  const bucketCount = Math.round(span / bucket);
  const byBucket = new Map(rows(1).map((row) => [n(row.b), row]));
  const series: SeriesPoint[] = Array.from({ length: bucketCount }, (_, i) => {
    const row = byBucket.get(i) ?? {};
    return {
      t: since + i * bucket,
      pageviews: n(row.pageviews),
      gameViews: n(row.game_views),
      searches: n(row.searches),
      follows: n(row.follows),
      owns: n(row.owns),
      signups: n(row.signups),
    };
  });

  // --- Top games: views ranked, follows/owns attached; followed-but-unviewed
  // games (possible: follows happen from cards on other pages) still appear.
  const games = new Map<string, { slug: string; views: number; follows: number; owns: number }>();
  for (const row of rows(3)) {
    const slug = s(row.slug);
    if (slug) games.set(slug, { slug, views: n(row.c), follows: 0, owns: 0 });
  }
  for (const row of rows(4)) {
    const slug = s(row.slug);
    if (!slug) continue;
    const entry = games.get(slug) ?? { slug, views: 0, follows: 0, owns: 0 };
    entry.follows = n(row.follows);
    entry.owns = n(row.owns);
    games.set(slug, entry);
  }
  const topGames = [...games.values()]
    .sort((a, b) => b.views - a.views || b.follows - a.follows || b.owns - a.owns)
    .slice(0, 10);

  // --- Countries
  const countryRows = rows(8);
  const unknownCountry = n(countryRows.find((row) => s(row.code) === "")?.c);
  const countries = countryRows
    .filter((row) => s(row.code) !== "")
    .slice(0, 12)
    .map((row) => ({ code: s(row.code), count: n(row.c) }));

  // --- Devices
  const devices = rows(9)
    .map((row) => ({ device: asDevice(row.d), count: n(row.c) }))
    .sort((a, b) => deviceOrder(a.device) - deviceOrder(b.device));

  // --- Vitals
  const p75 = new Map(rows(11).map((row) => [s(row.name), n(row.value)]));
  const vitalCounts = new Map(rows(10).map((row) => [s(row.name), row]));
  const vitals: VitalSummary[] = VITAL_NAMES.map((name: VitalName) => {
    const row = vitalCounts.get(name);
    const samples = n(row?.c);
    const good = n(row?.good);
    const poor = n(row?.poor);
    return {
      name,
      p75: samples > 0 ? (p75.get(name) ?? null) : null,
      samples,
      good,
      poor,
      needsImprovement: Math.max(0, samples - good - poor),
    };
  });

  // --- Funnel
  const funnel: FunnelRow[] = rows(12)
    .map((row) => ({
      device: asDevice(row.d),
      visits: n(row.visits),
      gameViews: n(row.game_views),
      follows: n(row.follows),
      signups: n(row.signups),
    }))
    .sort((a, b) => deviceOrder(a.device) - deviceOrder(b.device));

  const lifetime = rows(13)[0] ?? {};

  return {
    range,
    bucket: bucket === HOUR ? "hour" : "day",
    since,
    until,
    generatedAt: now,
    lifetime: { events: n(lifetime.c), firstEventAt: lifetime.first == null ? null : n(lifetime.first) },
    kpis: {
      pageviews: kpi("pageviews"),
      searches: kpi("searches"),
      follows: kpi("follows"),
      owns: kpi("owns"),
      signups: kpi("signups"),
      gameViews: kpi("game_views"),
    },
    series,
    topPages: rows(2).map((row) => ({ path: s(row.path), count: n(row.c) })),
    topGames,
    topSearches: rows(5).map((row) => ({ query: s(row.query), count: n(row.c), avgResults: n(row.r) })),
    zeroResultSearches: rows(6).map((row) => ({ query: s(row.query), count: n(row.c), lastSeen: n(row.last) })),
    referrers: rows(7).map((row) => ({ host: s(row.ref_host), count: n(row.c) })),
    countries,
    unknownCountry,
    devices,
    vitals,
    funnel,
  };
}

function asDevice(value: unknown): Device | "unknown" {
  return (DEVICES as readonly unknown[]).includes(value) ? (value as Device) : "unknown";
}
function deviceOrder(device: Device | "unknown"): number {
  const index = (DEVICES as readonly string[]).indexOf(device);
  return index === -1 ? DEVICES.length : index;
}
