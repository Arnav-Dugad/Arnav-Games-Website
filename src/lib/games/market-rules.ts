/**
 * Pure rules behind the market, player-count, PC and reliability features.
 *
 * Nothing here touches the network, D1 or Next — every function is
 * deterministic so `scripts/check-providers.ts` can pin the rules down, and
 * so client components can import the money helpers without dragging server
 * code into the bundle.
 *
 * Money convention (shared with `types.ts`): integer *minor units* of the
 * currency, where "minor" means the digits in `currencyDigits` — cents for
 * USD, whole yen for JPY, fils (1/1000) for KWD. Steam reports every currency
 * ×100 regardless (¥9,020 arrives as 902000), so Steam values pass through
 * `steamToMinor` before they are stored or compared.
 */

import type {
  AchievementStats,
  DeckStatus,
  LocalPrice,
  PlayerHistory,
  PricePoint,
  PriceVerdictKind,
  StudioReliability,
} from "./types";
import { changesFromObservations, isDelay, releaseUpperBound } from "./release-value";

/* ---------------------------------------------------------------------------
 * Currency
 * ------------------------------------------------------------------------ */

/*
 * A fixed table rather than `Intl`'s resolved digits: stored history must mean
 * the same thing on every runtime, and ICU builds disagree about a few
 * currencies. The zero-digit list follows how stores actually price (nobody
 * sells a game for Rp 599 000,50), which is also how Steam formats them.
 */
const ZERO_DIGIT = new Set(
  "BIF CLP COP DJF GNF HUF IDR ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF".split(" "),
);
const THREE_DIGIT = new Set("BHD IQD JOD KWD LYD OMR TND".split(" "));

export function currencyDigits(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DIGIT.has(code)) return 0;
  if (THREE_DIGIT.has(code)) return 3;
  return 2;
}

/** Steam's ×100 integer → minor units of `currency`. */
export function steamToMinor(value: number, currency: string): number {
  return Math.round((value * 10 ** currencyDigits(currency)) / 100);
}

/** A decimal store price (Microsoft's `59.99`) → minor units. */
export function decimalToMinor(value: number, currency: string): number {
  return Math.round(value * 10 ** currencyDigits(currency));
}

/**
 * Converts minor units of `from` into minor units of `to`.
 *
 * `rate` is how many `from` units one `to` unit buys — exactly what an FX feed
 * based on the viewer's currency publishes (`base=INR` → `rates.USD = 0.0105`).
 * Rounded to the nearest minor unit of the target currency.
 */
export function convertMinor(amount: number, from: string, to: string, rate: number): number | null {
  if (from.toUpperCase() === to.toUpperCase()) return amount;
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(amount)) return null;
  const major = amount / 10 ** currencyDigits(from);
  return Math.round((major / rate) * 10 ** currencyDigits(to));
}

/**
 * Minor units → a display string for the locale. Digits are pinned to the
 * table above so a price never shows more precision than it is stored with.
 * `narrowSymbol` ("₺", "$") suits a price shown in its own country; the
 * default keeps dollars distinguishable ("CA$") when currencies are mixed.
 */
export function formatMinor(
  amount: number,
  currency: string,
  locale = "en-US",
  display: "symbol" | "narrowSymbol" = "symbol",
): string {
  const digits = currencyDigits(currency);
  const major = amount / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: display,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${major.toFixed(digits)} ${currency}`;
  }
}

/** ISO 3166-1 alpha-2, excluding Cloudflare's "XX" (unknown) and "T1" (Tor). */
export function normaliseCountry(raw: string | null | undefined): string | null {
  const code = raw?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null;
}

/* ---------------------------------------------------------------------------
 * Price verdict
 * ------------------------------------------------------------------------ */

/** Thresholds, named so the rules read as documented. */
export const VERDICT = {
  /** "At the lowest" tolerates a 2% wobble (currency rounding, VAT tweaks). */
  nearLowest: 1.02,
  /** A discount this deep is worth taking whatever the history says. */
  deepDiscount: 60,
  /** A past discount at least this big makes full price a "wait". */
  meaningfulSale: 25,
  /** How far back a past sale still predicts the next one. */
  saleLookbackDays: 120,
  /** Below this many distinct observed days, history can't judge a full price. */
  minHistoryDays: 14,
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOf = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const discountOf = (point: { price: number; initial: number | null }) =>
  point.initial && point.initial > 0 ? Math.round((1 - point.price / point.initial) * 100) : 0;

export interface VerdictInput {
  /** The cheapest current offer in the market's currency, or null when none. */
  current: Pick<LocalPrice, "price" | "initial" | "discount" | "currency"> | null;
  /** Our observations in the same currency, any order (today's included). */
  history: PricePoint[];
  /** YYYY-MM-DD, UTC. */
  today: string;
}

/**
 * Should you buy now? Rules, in order:
 *
 *  1. No current price → unknown. Free → fair (there is nothing to wait for).
 *  2. ≥ 60% off right now → buy, whatever the history.
 *  3. Discounted and within 2% of the lowest we've observed → buy — but only
 *     once we have ≥ 14 observed days; "lowest we've seen" after two days of
 *     looking is technically true and practically meaningless, so a shorter
 *     history with a discount is called fair and says why.
 *  4. Full price, and our history shows a ≥ 25% sale in the last 120 days →
 *     wait: it has been meaningfully cheaper recently.
 *  5. Full price with < 14 observed days → unknown.
 *  6. Otherwise → fair.
 */
export function priceVerdict({ current, history, today }: VerdictInput): {
  kind: PriceVerdictKind;
  reason: string;
} {
  if (!current) return { kind: "unknown", reason: "No current price in this region." };
  if (current.price === 0 && (current.initial ?? 0) === 0) {
    return { kind: "fair", reason: "Free to play — nothing to wait for." };
  }

  const days = new Set(history.map((point) => point.date));
  const since = [...days].sort()[0] ?? today;
  const enoughHistory = days.size >= VERDICT.minHistoryDays;
  const lowest = history.reduce<PricePoint | null>(
    (low, point) => (!low || point.price < low.price ? point : low),
    null,
  );
  const lowestPrice = Math.min(current.price, lowest?.price ?? current.price);
  const fmt = (amount: number) => formatMinor(amount, current.currency);
  const discounted = current.discount > 0;

  if (current.discount >= VERDICT.deepDiscount) {
    const atLow = enoughHistory && current.price <= lowestPrice * VERDICT.nearLowest;
    return {
      kind: "buy",
      reason: atLow
        ? `${current.discount}% off — the lowest price we've seen since ${monthOf(since)}.`
        : `${current.discount}% off right now.`,
    };
  }

  if (discounted) {
    if (!enoughHistory) {
      return {
        kind: "fair",
        reason: `${current.discount}% off, but we've only tracked it for ${days.size} day${days.size === 1 ? "" : "s"}.`,
      };
    }
    if (current.price <= lowestPrice * VERDICT.nearLowest) {
      return { kind: "buy", reason: `Lowest price we've seen since ${monthOf(since)}.` };
    }
    return {
      kind: "fair",
      reason: `${current.discount}% off, but it was ${fmt(lowestPrice)} in ${monthOf(lowest?.date ?? today)}.`,
    };
  }

  const recentSale = history
    .filter((point) => daysBetween(point.date, today) <= VERDICT.saleLookbackDays)
    .filter((point) => discountOf(point) >= VERDICT.meaningfulSale)
    .sort((a, b) => discountOf(b) - discountOf(a) || b.date.localeCompare(a.date))[0];
  if (recentSale) {
    return {
      kind: "wait",
      reason: `It was ${discountOf(recentSale)}% off in ${monthOf(recentSale.date)} — sales come round.`,
    };
  }

  if (!enoughHistory) {
    return { kind: "unknown", reason: `Tracking since ${monthOf(since)} ${Number(since.slice(8, 10))} — not enough history yet.` };
  }
  return { kind: "fair", reason: `No big sales in the last ${VERDICT.saleLookbackDays} days.` };
}

/* ---------------------------------------------------------------------------
 * Player history
 * ------------------------------------------------------------------------ */

const HOUR = 3600;
const BUCKET = 6 * HOUR;

/**
 * Hourly samples (any order) → a chart series: hourly for the 7 days before
 * `now`, 6-hour buckets beyond (mean, rounded; `t` is the bucket start). The
 * peaks are computed from the raw samples, so downsampling never hides one.
 */
export function downsamplePlayers(
  samples: Array<{ hour: number; players: number }>,
  now: number,
): Omit<PlayerHistory, "appId"> {
  const ordered = [...samples].filter((s) => Number.isFinite(s.players)).sort((a, b) => a.hour - b.hour);
  if (ordered.length === 0) return { points: [], peak24h: null, peakTracked: null, since: null };

  const recentFrom = now - 7 * 24 * HOUR;
  const buckets = new Map<number, { sum: number; n: number }>();
  const points: PlayerHistory["points"] = [];
  for (const sample of ordered) {
    if (sample.hour >= recentFrom) continue;
    const start = sample.hour - (sample.hour % BUCKET);
    const bucket = buckets.get(start) ?? { sum: 0, n: 0 };
    bucket.sum += sample.players;
    bucket.n += 1;
    buckets.set(start, bucket);
  }
  for (const [t, { sum, n }] of [...buckets].sort((a, b) => a[0] - b[0])) {
    points.push({ t, players: Math.round(sum / n) });
  }
  for (const sample of ordered) {
    if (sample.hour >= recentFrom) points.push({ t: sample.hour, players: sample.players });
  }

  const last24 = ordered.filter((s) => s.hour >= now - 24 * HOUR);
  return {
    points,
    peak24h: last24.length ? Math.max(...last24.map((s) => s.players)) : null,
    peakTracked: Math.max(...ordered.map((s) => s.players)),
    since: new Date(ordered[0].hour * 1000).toISOString().slice(0, 10),
  };
}

/* ---------------------------------------------------------------------------
 * PC
 * ------------------------------------------------------------------------ */

/** Steam's `resolved_category`: 0 unknown, 1 unsupported, 2 playable, 3 verified. */
export function deckStatusFromCategory(category: unknown): DeckStatus | null {
  switch (category) {
    case 0:
      return "unknown";
    case 1:
      return "unsupported";
    case 2:
      return "playable";
    case 3:
      return "verified";
    default:
      return null;
  }
}

/**
 * Global unlock rates (percent of players) → band counts and extremes.
 * Bands: ultra rare < 1%, rare < 10%, uncommon < 50%, common ≥ 50%.
 */
export function rarityBands(
  percents: number[],
): Pick<AchievementStats, "rarity" | "rarest" | "mostCommon"> {
  const rarity = { ultraRare: 0, rare: 0, uncommon: 0, common: 0 };
  const valid = percents.filter((p) => Number.isFinite(p) && p >= 0 && p <= 100);
  for (const p of valid) {
    if (p < 1) rarity.ultraRare++;
    else if (p < 10) rarity.rare++;
    else if (p < 50) rarity.uncommon++;
    else rarity.common++;
  }
  const round = (p: number) => Math.round(p * 10) / 10;
  return {
    rarity,
    rarest: valid.length ? round(Math.min(...valid)) : null,
    mostCommon: valid.length ? round(Math.max(...valid)) : null,
  };
}

/* ---------------------------------------------------------------------------
 * Studio reliability
 * ------------------------------------------------------------------------ */

/**
 * Release-date observations for a set of games → how reliably they shipped.
 *
 *  - tracked: games with at least one observation.
 *  - delayed: games with at least one change that moved the date later
 *    (`isDelay`, so a window narrowing inside itself is not a slip).
 *  - avgDaysLate: per delayed game, the sum of each slip's days, measured
 *    between day-precise dates or window upper bounds; averaged over the
 *    delayed games where a slip could be measured (→ TBA can't be), rounded.
 *  - since: the earliest observation, ISO date.
 */
export function reliabilityFromObservations(
  rows: Array<{ gameId: number; value: string; observedAt: number }>,
): StudioReliability {
  const byGame = new Map<number, Array<{ value: string; observedAt: number }>>();
  let first: number | null = null;
  for (const row of rows) {
    const list = byGame.get(row.gameId) ?? [];
    list.push({ value: row.value, observedAt: row.observedAt });
    byGame.set(row.gameId, list);
    if (first === null || row.observedAt < first) first = row.observedAt;
  }

  let delayed = 0;
  const lateness: number[] = [];
  for (const observations of byGame.values()) {
    const delays = changesFromObservations(observations).filter((change) => isDelay(change.from, change.to));
    if (delays.length === 0) continue;
    delayed++;
    let days = 0;
    let measured = false;
    for (const change of delays) {
      const from = releaseUpperBound(change.from);
      const to = releaseUpperBound(change.to);
      if (!from || !to) continue;
      days += daysBetween(from, to);
      measured = true;
    }
    if (measured) lateness.push(days);
  }

  return {
    tracked: byGame.size,
    delayed,
    avgDaysLate: lateness.length ? Math.round(lateness.reduce((a, b) => a + b, 0) / lateness.length) : null,
    since: first === null ? null : new Date(first * 1000).toISOString().slice(0, 10),
  };
}

/* ---------------------------------------------------------------------------
 * Request planning (crons)
 * ------------------------------------------------------------------------ */

/**
 * `size` items starting at a position that advances by `size` each `turn`,
 * wrapping — so a list bigger than one run's capacity is covered over
 * successive runs instead of the head being re-done forever.
 */
export function rotatingSlice<T>(items: T[], size: number, turn: number): T[] {
  if (size <= 0) return [];
  if (size >= items.length) return [...items];
  const start = (((turn * size) % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)].slice(0, size);
}

/**
 * How many Steam and Microsoft batch requests each country gets so that
 * `countries × (steam + microsoft)` never exceeds `budget`. Steam batches
 * price 5× more games per request, so they are favoured when both can't fit.
 */
export function planPriceRequests(input: {
  steamItems: number;
  microsoftItems: number;
  countries: number;
  budget: number;
  steamBatch: number;
  microsoftBatch: number;
}): { steam: number; microsoft: number } {
  const perCountry = Math.floor(input.budget / Math.max(1, input.countries));
  const steamNeed = Math.ceil(input.steamItems / input.steamBatch);
  const msNeed = Math.ceil(input.microsoftItems / input.microsoftBatch);
  let steam = Math.min(steamNeed, Math.ceil(perCountry / 2));
  const microsoft = Math.max(0, Math.min(msNeed, perCountry - steam));
  steam = Math.max(0, Math.min(steamNeed, perCountry - microsoft));
  return { steam, microsoft };
}

/**
 * Which Steam apps one player-count run samples, at most `limit`.
 *
 *  - `due`: apps that reported a count in the last week but have no sample
 *    for the current hour, most recently viewed first. They fill the run.
 *  - `quiet`: apps with no sample in the last week — newly tracked,
 *    unreleased (Steam answers nothing) or dead. They can never be marked
 *    "done for the hour", so instead each run takes every `runsPerHour`-th one
 *    (by `run`, the run's index within the hour): each is tried about once an
 *    hour without being retried every run. Up to `reserve` slots are kept for
 *    them so a busy hour can't starve newly tracked games.
 */
export function choosePlayerSamples(input: {
  due: number[];
  quiet: number[];
  run: number;
  runsPerHour: number;
  limit: number;
  reserve: number;
}): number[] {
  const quietTurn = input.quiet.filter((_, index) => index % input.runsPerHour === input.run % input.runsPerHour);
  const dueSlots = Math.max(0, input.limit - Math.min(input.reserve, quietTurn.length));
  const due = input.due.slice(0, dueSlots);
  return [...due, ...quietTurn.slice(0, Math.max(0, input.limit - due.length))];
}
