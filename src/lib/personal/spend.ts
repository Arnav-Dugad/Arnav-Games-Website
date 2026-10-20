/**
 * What the reader paid, and what their library is worth — the pure half.
 *
 *   users/{uid}/purchases/{gameId}  { gameId, amount, currency, store, at, updatedAt }
 *
 * `amount` is in minor units of `currency` (pence, cents, paise — yen have
 * none), exactly like every store price in the app, so a purchase and a price
 * can be compared without floating-point money. `at` is the purchase *date*
 * at UTC midnight: a calendar day, not a moment, so a purchase made late on
 * the 31st never drifts into the next month for someone in another zone.
 *
 * Money in different currencies is only ever added up after converting it to
 * the reader's currency with ECB reference rates, and every total says how
 * many purchases it covers — a currency the feed doesn't publish is left out
 * and counted, never guessed.
 */

import { convertMinor, currencyDigits } from "@/lib/games/market-rules";

export interface Purchase {
  gameId: number;
  /** Minor units of `currency`; 0 for a free claim. */
  amount: number;
  /** ISO 4217. */
  currency: string;
  /** Ownership slug (`OWNERSHIP_PLATFORMS`) or "other". */
  store: string;
  /** Purchase date, epoch ms at UTC midnight. */
  at: number;
  updatedAt: number;
}

/** Large enough for a ₩/Rp collector's edition, small enough to catch a typo of extra zeros. */
export const PURCHASE_MAX_MINOR = 10_000_000_000;
/** The earliest purchase date accepted: Spacewar! is older, but no store receipt is. */
export const PURCHASE_MIN_AT = Date.UTC(1970, 0, 1);
const CURRENCY = /^[A-Z]{3}$/;
const STORE = /^[a-z0-9-]{1,40}$/;

export function validPurchase(value: unknown, now = Date.now()): value is Purchase {
  const p = value as Purchase;
  return (
    typeof p?.gameId === "number" && Number.isInteger(p.gameId) && p.gameId !== 0 &&
    typeof p.amount === "number" && Number.isInteger(p.amount) && p.amount >= 0 && p.amount <= PURCHASE_MAX_MINOR &&
    typeof p.currency === "string" && CURRENCY.test(p.currency) &&
    typeof p.store === "string" && STORE.test(p.store) &&
    typeof p.at === "number" && Number.isInteger(p.at) && p.at >= PURCHASE_MIN_AT && p.at <= now + 2 * 86_400_000 &&
    typeof p.updatedAt === "number"
  );
}

/**
 * A typed price → minor units, or null. Accepts what people type: "59.99",
 * "59,99" (decimal comma), "1,299", "1.299,00", "₹1,299", "0" (a free claim).
 */
export function parseMoney(text: string, currency: string): number | null {
  const cleaned = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const digits = currencyDigits(currency);
  const dots = cleaned.split(".").length - 1;
  const commas = cleaned.split(",").length - 1;
  let normalised: string;
  if (dots && commas) {
    // Both present: whichever comes last is the decimal point.
    const decimal = cleaned.lastIndexOf(".") > cleaned.lastIndexOf(",") ? "." : ",";
    const [whole, fraction] = [cleaned.slice(0, cleaned.lastIndexOf(decimal)), cleaned.slice(cleaned.lastIndexOf(decimal) + 1)];
    normalised = `${whole.replace(/[.,]/g, "")}.${fraction}`;
  } else if (dots + commas === 0) {
    normalised = cleaned;
  } else {
    const mark = dots ? "." : ",";
    const parts = cleaned.split(mark);
    const tail = parts[parts.length - 1];
    // Repeated, or followed by exactly three digits where three decimals make
    // no sense ("1,299", "12.999"): a thousands separator.
    const grouping = parts.length > 2 || (tail.length === 3 && digits !== 3);
    normalised = grouping ? parts.join("") : `${parts.slice(0, -1).join("") || "0"}.${tail}`;
  }
  const major = Number(normalised);
  if (!Number.isFinite(major) || major < 0) return null;
  const minor = Math.round(major * 10 ** digits);
  return minor <= PURCHASE_MAX_MINOR ? minor : null;
}

/** Minor units → the editable text for an input ("59.99", "1299"). */
export function moneyInputValue(amount: number, currency: string): string {
  const digits = currencyDigits(currency);
  return digits === 0 ? String(amount) : (amount / 10 ** digits).toFixed(digits);
}

/** Whole units for totals ("₹12,480"); `whole: false` keeps the minor units ("₹499.00"). */
export function formatMoney(amount: number, currency: string, { whole = true }: { whole?: boolean } = {}): string {
  const digits = currencyDigits(currency);
  const major = amount / 10 ** digits;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: whole ? 0 : digits,
    }).format(major);
  } catch {
    return `${major.toFixed(whole ? 0 : digits)} ${currency}`;
  }
}

/** UTC midnight of a `YYYY-MM-DD` input value; null when invalid. */
export function dateInputToAt(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) ? at : null;
}

export const atToDateInput = (at: number) => new Date(at).toISOString().slice(0, 10);

/* ---------------------------------------------------------------------------
 * The reader's currency
 * ------------------------------------------------------------------------ */

/**
 * The currency each price region's stores charge in. Steam prices Türkiye and
 * Argentina in US dollars, but a reader there thinks in lira and pesos, and
 * this is the currency their spending is *reported* in — so the local one.
 */
const REGION_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", IN: "INR", CA: "CAD", AU: "AUD", NZ: "NZD", JP: "JPY", KR: "KRW",
  BR: "BRL", MX: "MXN", TR: "TRY", PL: "PLN", NO: "NOK", CH: "CHF", SG: "SGD", ID: "IDR",
  PH: "PHP", MY: "MYR", TH: "THB", VN: "VND", ZA: "ZAR", AE: "AED", SA: "SAR", IL: "ILS",
  CN: "CNY", HK: "HKD", TW: "TWD", CL: "CLP", CO: "COP", PE: "PEN", UA: "UAH", KZ: "KZT",
  SE: "SEK", DK: "DKK", CZ: "CZK", HU: "HUF", RO: "RON", AR: "ARS", RU: "RUB",
};
const EURO = new Set("AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" "));

export function currencyForRegion(country: string | null | undefined): string {
  const code = (country ?? "").toUpperCase();
  if (EURO.has(code)) return "EUR";
  return REGION_CURRENCY[code] ?? "USD";
}

/** Currencies offered in the purchase form: the reader's own first, then the common ones. */
export function currencyChoices(own: string): string[] {
  const common = ["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD", "BRL", "TRY", "PLN", "KRW", "MXN", "CNY", "CHF", "SEK", "NOK", "ZAR", "SGD", "IDR", "PHP"];
  return [...new Set([own, ...common])];
}

/** FX rates as published for base = the reader's currency (`rates[X]` = X per one base unit). */
export type Rates = Record<string, number>;

/**
 * `amount` (minor units of `from`) in minor units of `to`, through rates
 * published for `base`; null without the rates it needs. `to` need not be the
 * base (Steam prices Türkiye in dollars, the reader thinks in lira).
 */
export function toCurrency(amount: number, from: string, to: string, rates: Rates | null, base = to): number | null {
  if (from === to) return amount;
  const inBase = from === base ? amount : typeof rates?.[from] === "number" ? convertMinor(amount, from, base, rates[from]) : null;
  if (inBase === null || to === base) return inBase;
  const rate = rates?.[to];
  // base → to: one base unit buys `rate` units of `to`.
  return typeof rate === "number" ? convertMinor(inBase, base, to, 1 / rate) : null;
}

/* ---------------------------------------------------------------------------
 * Spending summary
 * ------------------------------------------------------------------------ */

export interface SpendBucket {
  key: string;
  label: string;
  /** Minor units of the summary currency. */
  value: number;
  purchases: number;
}

export interface GameValue {
  gameId: number;
  paid: number;
  hours: number;
  /** Minor units per hour. */
  perHour: number;
}

/** Our own lowest observed price for a game, in its region's currency. */
export interface ObservedLow {
  currency: string;
  /** Lowest price we've seen, minor units. */
  lowest: number;
  /** Highest undiscounted price we've seen (the "full price"), when known. */
  full: number | null;
}

export interface SpendSummary {
  currency: string;
  /** Total of the purchases that could be converted. */
  total: number;
  /** Purchases in the total. */
  counted: number;
  /** Purchases left out for want of an exchange rate. */
  unconverted: number;
  /** Converted purchases that were free claims. */
  free: number;
  average: number | null;
  years: SpendBucket[];
  /** The last 12 calendar months, oldest first, zero-filled. */
  months: SpendBucket[];
  /** Total paid ÷ total hours, over paid games with hours on record. */
  perHour: { value: number; hours: number; games: number } | null;
  bestValue: GameValue[];
  worstValue: GameValue[];
  /** Paid against the lowest price we've observed in the reader's region. */
  vsLowest: { games: number; paid: number; lowest: number; overpaid: number; atLowest: number } | null;
  /** Paid against the full price we've observed: what buying on sale saved. */
  vsFull: { games: number; paid: number; full: number; saved: number } | null;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

/** A small purchase can't produce a meaningful "per hour" (a 20-minute free game). */
const VALUE_MIN_HOURS = 1;

export function spendSummary(
  purchases: Purchase[],
  {
    currency,
    rates,
    playtime = {},
    lows = {},
    now = Date.now(),
  }: {
    currency: string;
    rates: Rates | null;
    playtime?: Record<number, number>;
    lows?: Record<number, ObservedLow>;
    now?: number;
  },
): SpendSummary {
  const converted: Array<Purchase & { value: number }> = [];
  let unconverted = 0;
  for (const purchase of purchases) {
    const value = toCurrency(purchase.amount, purchase.currency, currency, rates);
    if (value === null) unconverted++;
    else converted.push({ ...purchase, value });
  }
  const total = converted.reduce((sum, item) => sum + item.value, 0);
  const paid = converted.filter((item) => item.value > 0);

  const years = new Map<string, SpendBucket>();
  for (const item of converted) {
    const key = String(new Date(item.at).getUTCFullYear());
    const bucket = years.get(key) ?? { key, label: key, value: 0, purchases: 0 };
    bucket.value += item.value;
    bucket.purchases++;
    years.set(key, bucket);
  }

  const today = new Date(now);
  const months: SpendBucket[] = [];
  for (let back = 11; back >= 0; back--) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    const key = date.toISOString().slice(0, 7);
    const label = MONTH_LABEL.format(date);
    const inMonth = converted.filter((item) => new Date(item.at).toISOString().slice(0, 7) === key);
    months.push({ key, label, value: inMonth.reduce((sum, item) => sum + item.value, 0), purchases: inMonth.length });
  }

  const values: GameValue[] = paid
    .map((item) => ({ gameId: item.gameId, paid: item.value, hours: playtime[item.gameId] ?? 0 }))
    .filter((item) => item.hours >= VALUE_MIN_HOURS)
    .map((item) => ({ ...item, perHour: Math.round(item.paid / item.hours) }));
  const valueHours = values.reduce((sum, item) => sum + item.hours, 0);
  const valuePaid = values.reduce((sum, item) => sum + item.paid, 0);
  const byValue = [...values].sort((a, b) => a.perHour - b.perHour || b.hours - a.hours);

  // Comparisons only where the purchase converts into the region's own currency.
  let lowGames = 0, lowPaid = 0, lowSum = 0, atLowest = 0;
  let fullGames = 0, fullPaid = 0, fullSum = 0;
  for (const item of converted) {
    const low = lows[item.gameId];
    if (!low) continue;
    const paidThere = toCurrency(item.amount, item.currency, low.currency, rates, currency);
    if (paidThere === null) continue;
    lowGames++;
    lowPaid += paidThere;
    lowSum += low.lowest;
    if (paidThere <= low.lowest * 1.02) atLowest++;
    if (low.full && low.full > 0) {
      fullGames++;
      fullPaid += paidThere;
      fullSum += low.full;
    }
  }

  return {
    currency,
    total,
    counted: converted.length,
    unconverted,
    free: converted.length - paid.length,
    average: paid.length ? Math.round(paid.reduce((sum, item) => sum + item.value, 0) / paid.length) : null,
    years: [...years.values()].sort((a, b) => a.key.localeCompare(b.key)),
    months,
    perHour: values.length ? { value: Math.round(valuePaid / valueHours), hours: valueHours, games: values.length } : null,
    bestValue: byValue.slice(0, 3),
    worstValue: byValue.length > 3 ? byValue.slice(-3).reverse() : [],
    vsLowest: lowGames ? { games: lowGames, paid: lowPaid, lowest: lowSum, overpaid: lowPaid - lowSum, atLowest } : null,
    vsFull: fullGames ? { games: fullGames, paid: fullPaid, full: fullSum, saved: fullSum - fullPaid } : null,
  };
}

/* ---------------------------------------------------------------------------
 * Library value
 * ------------------------------------------------------------------------ */

/** One observed price, in the region's currency (minor units). */
export interface PriceSample {
  /** YYYY-MM-DD. */
  date: string;
  price: number;
  initial: number | null;
}

export interface ValuedGame {
  gameId: number;
  /** When it joined the library (epoch ms). */
  addedAt: number;
  /** Today's best store price, minor units; null when no store prices it. */
  current: number | null;
  /** Our observations, oldest first (may be empty). */
  history: PriceSample[];
}

export interface ValuePoint {
  /** YYYY-MM. */
  key: string;
  label: string;
  value: number;
  games: number;
  /** Share of `value` that came from a price we actually observed in that month or before. */
  observed: number;
}

export interface LibraryValue {
  current: number;
  priced: number;
  unpriced: number;
  free: number;
  points: ValuePoint[];
  /** "history": some months use observed prices; "added": every month is at today's prices. */
  basis: "history" | "added";
}

/** The price on a day: the last observation on or before it, else null. */
export function priceOn(history: PriceSample[], day: string): number | null {
  let price: number | null = null;
  for (const sample of history) {
    if (sample.date > day) break;
    price = sample.price;
  }
  return price;
}

/** Lowest observed and highest undiscounted price, for the "you paid vs" comparison. */
export function observedLow(history: PriceSample[], currency: string): ObservedLow | null {
  const paid = history.filter((sample) => sample.price > 0);
  if (paid.length === 0) return null;
  const full = Math.max(0, ...history.map((sample) => sample.initial ?? 0));
  return { currency, lowest: Math.min(...paid.map((sample) => sample.price)), full: full > 0 ? full : null };
}

const VALUE_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
/** "Oct ’26": a short month that can't be misread as a day ("Oct 26"). */
const valueLabel = (date: Date) => `${VALUE_MONTH.format(date)} ’${String(date.getUTCFullYear()).slice(2)}`;

/**
 * The library's value at the end of each month since its first game: every
 * game owned by then, at the price we observed for it then. Where we have no
 * observation that early (or none at all), today's price stands in, and
 * `observed` reports how much of each month is real history.
 */
export function libraryValue(games: ValuedGame[], { now = Date.now(), maxMonths = 24 }: { now?: number; maxMonths?: number } = {}): LibraryValue {
  const priced = games.filter((game) => game.current !== null);
  const current = priced.reduce((sum, game) => sum + (game.current ?? 0), 0);
  const empty: LibraryValue = { current, priced: priced.length, unpriced: games.length - priced.length, free: priced.filter((game) => game.current === 0).length, points: [], basis: "added" };
  if (priced.length === 0) return empty;

  const today = new Date(now);
  const earliest = Math.min(...priced.map((game) => game.addedAt || now));
  const start = new Date(Math.max(earliest, Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (maxMonths - 1), 1)));
  const points: ValuePoint[] = [];
  let anyObserved = false;
  for (let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1); cursor <= now; ) {
    const month = new Date(cursor);
    const next = Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1);
    const end = Math.min(next - 1, now);
    const day = new Date(end).toISOString().slice(0, 10);
    let value = 0;
    let observed = 0;
    let count = 0;
    for (const game of priced) {
      if ((game.addedAt || now) > end) continue;
      count++;
      // This month ends today: today's price *is* the observation.
      const seen = end === now ? game.current ?? 0 : priceOn(game.history, day);
      if (seen !== null) {
        value += seen;
        observed += seen;
      } else {
        value += game.current ?? 0;
      }
    }
    if (observed > 0) anyObserved = true;
    points.push({ key: day.slice(0, 7), label: valueLabel(month), value, games: count, observed: value > 0 ? observed / value : 0 });
    cursor = next;
  }
  return { ...empty, points, basis: anyObserved ? "history" : "added" };
}
