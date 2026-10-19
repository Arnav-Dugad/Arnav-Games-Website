/**
 * Server-side analytics: request screening, strict validation and inserts.
 *
 * What is stored, and what deliberately isn't:
 *  - stored: event type, pathname, referrer *host*, country (from Cloudflare's
 *    edge header), coarse device class, and per-type fields (slug, metric).
 *  - never stored: IP address, user agent, user id, cookies, full URLs or
 *    query strings. The user agent is read once to drop bots and discarded.
 *
 * Every write goes through `runAfterResponse`, and everything no-ops when
 * the D1 binding is missing (build, tests, plain `next start`).
 */

import { getDb, runAfterResponse, type D1PreparedStatement } from "@/lib/cloudflare/db";
import {
  CLIENT_EVENT_TYPES,
  DEVICES,
  MAX_EVENTS_PER_REQUEST,
  VITAL_NAMES,
  type ClientEventType,
  type Device,
  type VitalName,
} from "./types";

/** A row ready for `analytics_events`. */
export interface EventRow {
  type: ClientEventType | "search";
  path: string | null;
  ref_host: string | null;
  device: Device | null;
  game_slug: string | null;
  query: string | null;
  results: number | null;
  value: number | null;
  name: VitalName | null;
}

/*
 * Crawlers, link unfurlers, uptime checks and automation. Matching is
 * intentionally broad: a missed human pageview costs nothing, a counted bot
 * skews every chart. Chat unfurlers (Slackbot, Discordbot, TelegramBot) are
 * caught by the "bot" rule; "cu" spares Cubot phones. Headless browsers are
 * included, so local testing with Playwright needs a normal user agent.
 */
const BOT_UA =
  /(?<!cu)bot\b|bot\/|crawl|spider|slurp|scrape|fetch|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|whatsapp\/|curl|wget|httpie|python|java\/|okhttp|go-http|node-fetch|undici|axios|phantom|puppeteer|playwright|selenium|cypress/i;

export type Screening = { ok: true; country: string | null } | { ok: false; status: number };

/**
 * Decides whether a request may be recorded at all, before its body is read.
 * `checkOrigin` is for browser-originated beacons; the server-side search
 * logger skips it because a GET from the palette is same-origin by design.
 */
export function screenRequest(request: Request, { checkOrigin }: { checkOrigin: boolean }): Screening {
  const headers = request.headers;

  // Privacy signals are honoured server-side too, so a client that ignores
  // them (or an old cached bundle) still can't record anything.
  if (headers.get("dnt") === "1" || headers.get("sec-gpc") === "1") return { ok: false, status: 204 };

  const ua = headers.get("user-agent") ?? "";
  if (!ua || BOT_UA.test(ua)) return { ok: false, status: 204 };

  if (checkOrigin) {
    // Beacons from our own pages only. Browsers attach Origin to every POST,
    // so a foreign Origin is a cross-site script trying to write numbers.
    const origin = headers.get("origin");
    const host = headers.get("host");
    if (origin && host) {
      try {
        if (new URL(origin).host !== host) return { ok: false, status: 403 };
      } catch {
        return { ok: false, status: 403 };
      }
    }
    if (headers.get("sec-fetch-site") === "cross-site") return { ok: false, status: 403 };
  }

  return { ok: true, country: countryFrom(headers) };
}

/** ISO-3166 alpha-2 from Cloudflare, or null (unknown "XX", Tor "T1", local dev). */
function countryFrom(headers: Headers): string | null {
  const raw = headers.get("cf-ipcountry")?.toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(raw) || raw === "XX" || raw === "T1") return null;
  return raw;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const UNSAFE_PATH_CHARS = /[\s\u0000-\u001f\u007f<>"'`\\]/;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A same-site pathname, query and hash removed. Null if it isn't one. */
export function cleanPath(value: unknown): string | null {
  const raw = str(value);
  if (!raw || raw.length > 300 || !raw.startsWith("/") || raw.startsWith("//")) return null;
  const path = raw.split(/[?#]/, 1)[0];
  if (!path || path.length > 200 || UNSAFE_PATH_CHARS.test(path)) return null;
  // Trailing slashes would split one page across two rows.
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

function cleanHost(value: unknown, ownHost: string | null): string | null {
  const raw = str(value)?.toLowerCase().replace(/^www\./, "");
  if (!raw || !HOST_RE.test(raw)) return null;
  if (ownHost && raw === ownHost.toLowerCase().replace(/^www\./, "").split(":")[0]) return null;
  return raw;
}

function cleanDevice(value: unknown): Device | null {
  return (DEVICES as readonly unknown[]).includes(value) ? (value as Device) : null;
}

/**
 * Validates one event strictly. Anything malformed rejects the event (never
 * "repairs" it into something we'd then count), and numbers are clamped to
 * plausible ranges so one hand-crafted request can't wreck a p75.
 */
function validateEvent(input: unknown, ownHost: string | null): EventRow | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const event = input as Record<string, unknown>;
  const type = event.type;
  if (!(CLIENT_EVENT_TYPES as readonly unknown[]).includes(type)) return null;

  const path = cleanPath(event.path);
  if (!path) return null;
  const base: EventRow = {
    type: type as ClientEventType,
    path,
    ref_host: null,
    device: cleanDevice(event.device),
    game_slug: null,
    query: null,
    results: null,
    value: null,
    name: null,
  };

  switch (type as ClientEventType) {
    case "pageview": {
      base.ref_host = event.ref == null ? null : cleanHost(event.ref, ownHost);
      base.value = num(event.value) === 1 ? 1 : 0;
      return base;
    }
    case "vital": {
      const name = event.name;
      const value = num(event.value);
      if (!(VITAL_NAMES as readonly unknown[]).includes(name) || value === null) return null;
      base.name = name as VitalName;
      base.value = name === "CLS" ? clamp(value, 0, 10) : Math.round(clamp(value, 0, 60_000));
      return base;
    }
    case "follow": {
      const slug = str(event.slug);
      if (!slug || !SLUG_RE.test(slug)) return null;
      base.game_slug = slug;
      base.value = num(event.value) === 0 ? 0 : 1;
      return base;
    }
    case "own": {
      const slug = str(event.slug);
      if (!slug || !SLUG_RE.test(slug)) return null;
      base.game_slug = slug;
      return base;
    }
    case "signup":
      return base;
  }
  return null;
}

/**
 * Parses a request body (one event or an array of up to five). Returns null
 * when anything in it is invalid — partial acceptance would make abuse
 * cheaper to probe.
 */
export function parseEvents(body: string, ownHost: string | null): EventRow[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length === 0 || list.length > MAX_EVENTS_PER_REQUEST) return null;
  const rows: EventRow[] = [];
  for (const item of list) {
    const row = validateEvent(item, ownHost);
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const INSERT_SQL =
  "INSERT INTO analytics_events (ts, type, path, ref_host, country, device, game_slug, query, results, value, name) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

/**
 * Queues rows for insertion after the response is sent. Resolves once the
 * write is *scheduled*, not finished, so callers can await it for free.
 */
export async function recordEvents(rows: EventRow[], country: string | null): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  if (!db) return;
  // Server clock, never the client's: a skewed or forged timestamp would
  // drop events into the wrong bucket.
  const ts = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = rows.map((row) =>
    db
      .prepare(INSERT_SQL)
      .bind(
        ts,
        row.type,
        row.path,
        row.ref_host,
        country,
        row.device,
        row.game_slug,
        row.query,
        row.results,
        row.value,
        row.name,
      ),
  );
  const write = statements.length === 1 ? statements[0].run() : db.batch(statements);
  await runAfterResponse(
    write.catch((err: unknown) => {
      console.warn("[analytics] insert failed", err);
    }),
  );
}

/** Lowercased, whitespace-collapsed, ≤ 80 chars — so "Zelda " and "zelda" group. */
export function normaliseQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * Logs a search from the search route. Called only for *answered* searches —
 * a provider outage is not a zero-result query and mustn't be listed as one.
 *
 * Caveats, surfaced on the dashboard too: the palette searches as you type,
 * so prefixes ("zel", "zeld") are counted alongside the final query; and if a
 * CDN cache ever sits in front of `/api/search`, cached hits never reach the
 * worker, so these are counts of searches the worker actually answered.
 */
export async function recordSearch(request: Request, query: string, results: number): Promise<void> {
  try {
    const screening = screenRequest(request, { checkOrigin: false });
    if (!screening.ok) return;
    const normalised = normaliseQuery(query);
    if (normalised.length < 2) return;
    await recordEvents(
      [
        {
          type: "search",
          path: null,
          ref_host: null,
          device: null,
          game_slug: null,
          query: normalised,
          results: Math.max(0, Math.min(10_000, Math.round(results))),
          value: null,
          name: null,
        },
      ],
      screening.country,
    );
  } catch {
    // Never let analytics affect a search response.
  }
}
