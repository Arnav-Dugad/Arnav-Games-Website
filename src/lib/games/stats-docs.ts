/**
 * The Firestore data model for our own sampled statistics (formerly D1),
 * shared by the server writers (crons, page bookkeeping) and the browser
 * readers. Pure — no SDK, no network — so it is safe on both sides and the
 * self-checks can pin the parsing down.
 *
 * Designed for the Spark (free) quotas: 50k reads, 20k writes, 20k deletes a
 * day. Instead of one document per sample (a row per hour per game, as D1
 * had), each series is ONE document holding a compact map of samples:
 *
 *   playerHistory/{steamAppId}   s: { "<unix hour>": players }
 *   twitchHistory/{twitchId}     s: { "<unix hour>": [viewers, streams] }
 *   reviewHistory/{steamAppId}   s: { "<unix hour>": [total, positive] }
 *   scoreHistory/{igdbId}        s: { "<YYYY-MM-DD>": [score, count] }
 *   priceHistory/{key}           <CC>: { "<YYYY-MM-DD>": { <store>: [currency, price, initial, discount] } }
 *   releaseHistory/s0…s3         "<igdbId>": { "<release value>": firstSeenUnixSeconds }
 *   trackedGames/index           the crons' work queue (server-only; see tracked.ts)
 *
 * So a chart is one document read (the browser reads it directly, no Worker
 * request), a cron sample is one field write into one document, and pruning
 * is a field delete in that same write — never a read-then-delete pass.
 *
 * A history document holds at most ~120 days of hourly samples (≈ 2,900
 * fields, well under Firestore's 1 MiB / 40k-index-entry limits). Release
 * history is sharded four ways by id so the upcoming calendar and studio
 * pages read ≤ 4 documents (with a field mask) however many games they show.
 */

export const STATS_COLLECTIONS = {
  players: "playerHistory",
  twitch: "twitchHistory",
  reviews: "reviewHistory",
  scores: "scoreHistory",
  prices: "priceHistory",
  release: "releaseHistory",
} as const;

export const TRACKED_DOC = "trackedGames/index";
export const RELEASE_SHARDS = 4;

/** The shard document holding an IGDB game's release observations. */
export function releaseShardPath(gameId: number): string {
  return `${STATS_COLLECTIONS.release}/s${Math.abs(Math.trunc(gameId)) % RELEASE_SHARDS}`;
}

/** Doc id for a price key: IGDB id, or the negated appid of a Steam-only title. */
export function priceDocPath(key: number): string {
  return `${STATS_COLLECTIONS.prices}/${key}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** `s` map entries with a unix-seconds key, oldest first. */
function hourlyEntries(data: unknown): Array<[number, unknown]> {
  const samples = isRecord(data) && isRecord(data.s) ? data.s : {};
  return Object.entries(samples)
    .map(([key, value]): [number, unknown] => [Number(key), value])
    .filter(([hour]) => Number.isInteger(hour) && hour > 0)
    .sort((a, b) => a[0] - b[0]);
}

export function playerRows(data: unknown): Array<{ hour: number; players: number }> {
  return hourlyEntries(data)
    .filter((entry): entry is [number, number] => finite(entry[1]) && entry[1] >= 0)
    .map(([hour, players]) => ({ hour, players }));
}

export function twitchRows(data: unknown): Array<{ hour: number; viewers: number; streams: number }> {
  return hourlyEntries(data)
    .filter(([, value]) => Array.isArray(value) && finite(value[0]) && finite(value[1]))
    .map(([hour, value]) => ({ hour, viewers: (value as number[])[0], streams: (value as number[])[1] }));
}

export function reviewRows(data: unknown): Array<{ hour: number; total: number; positive: number }> {
  return hourlyEntries(data)
    .filter(([, value]) => Array.isArray(value) && finite(value[0]) && finite(value[1]))
    .map(([hour, value]) => ({ hour, total: (value as number[])[0], positive: (value as number[])[1] }));
}

export function scoreRows(data: unknown): Array<{ observed_on: string; score: number; count: number }> {
  const samples = isRecord(data) && isRecord(data.s) ? data.s : {};
  return Object.entries(samples)
    .filter(([day, value]) => DAY_KEY.test(day) && Array.isArray(value) && finite(value[0]) && finite(value[1]))
    .map(([day, value]) => ({ observed_on: day, score: (value as number[])[0], count: (value as number[])[1] }))
    .sort((a, b) => a.observed_on.localeCompare(b.observed_on));
}

export interface PriceRow {
  store: "steam" | "microsoft" | "gog";
  currency: string;
  price: number;
  initial: number | null;
  discount: number | null;
  observed_on: string;
}

/** One country's daily observations from a price document, oldest first. */
export function priceRows(data: unknown, country: string): PriceRow[] {
  const days = isRecord(data) && isRecord(data[country]) ? data[country] : {};
  const rows: PriceRow[] = [];
  for (const [day, stores] of Object.entries(days)) {
    if (!DAY_KEY.test(day) || !isRecord(stores)) continue;
    for (const [store, value] of Object.entries(stores)) {
      if (store !== "steam" && store !== "microsoft" && store !== "gog") continue;
      if (!Array.isArray(value) || typeof value[0] !== "string" || !finite(value[1])) continue;
      rows.push({
        store,
        currency: value[0],
        price: value[1],
        initial: finite(value[2]) ? value[2] : null,
        discount: finite(value[3]) ? value[3] : null,
        observed_on: day,
      });
    }
  }
  return rows.sort((a, b) => a.observed_on.localeCompare(b.observed_on) || a.store.localeCompare(b.store));
}

/** One game's release observations from its shard field. */
export function observationRows(field: unknown): Array<{ value: string; observedAt: number }> {
  if (!isRecord(field)) return [];
  return Object.entries(field)
    .filter((entry): entry is [string, number] => finite(entry[1]) && entry[1] > 0 && entry[0].length > 0)
    .map(([value, observedAt]) => ({ value, observedAt }))
    .sort((a, b) => a.observedAt - b.observedAt);
}

/**
 * The hourly keys a write should delete so the document never holds more
 * than `retentionDays`: the day of hours that just aged out. A series sampled
 * at least daily is pruned exactly; one with longer gaps may keep a stray old
 * sample, which every reader filters out by time anyway.
 */
export function expiredHours(hour: number, retentionDays: number): number[] {
  const cutoff = hour - retentionDays * 86_400;
  return Array.from({ length: 24 }, (_, index) => cutoff - index * 3600);
}

/** Same idea for daily series: the week of days before the cutoff. */
export function expiredDays(today: string, retentionDays: number): string[] {
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(base - (retentionDays + index) * 86_400_000).toISOString().slice(0, 10),
  );
}
