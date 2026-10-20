/**
 * Steam's four seasonal sales, by date — pure, so the buying tip can say
 * "the Winter Sale starts in about 58 days" without a request, and so the
 * rules can be pinned down in `scripts/check-providers.ts`.
 *
 * Two kinds of date, never confused:
 *
 *  - `ANNOUNCED`: dates Valve published in its partner calendar. These are
 *    stated as fact ("starts 25 June").
 *  - Everything else is *estimated* from the pattern Valve has kept for
 *    years, and the UI says "expected around" and "~" for those. The
 *    patterns: Spring opens on the second-to-third Thursday of March, Summer
 *    on the last Thursday of June, Winter on the third Thursday of December.
 *    Autumn moved in 2025 from Thanksgiving week to the end of September
 *    (29 Sep 2025); it's estimated on the newer pattern, the last Monday of
 *    September — the least certain of the four, so its estimate is used only
 *    to say a sale is *coming*, never to promise a date.
 *
 * Add each year's dates to `ANNOUNCED` when Valve publishes them; the
 * estimate is only ever the fallback.
 */

export type SteamSaleName = "Spring Sale" | "Summer Sale" | "Autumn Sale" | "Winter Sale";

export interface SteamSaleWindow {
  name: SteamSaleName;
  /** YYYY-MM-DD, inclusive, in Pacific time as Valve announces them (10am PT start). */
  start: string;
  end: string;
  /** False for dates Valve announced; true for the pattern-based guess. */
  estimated: boolean;
}

export interface UpcomingSteamSale extends SteamSaleWindow {
  /** Whole days from `today` to `start`; 0 while the sale is running. */
  daysUntil: number;
  /** True while `today` falls inside the sale. */
  live: boolean;
}

/** Dates Valve has published (store.steampowered.com/news "Steam sale dates"). */
const ANNOUNCED: SteamSaleWindow[] = [
  { name: "Spring Sale", start: "2025-03-13", end: "2025-03-20", estimated: false },
  { name: "Summer Sale", start: "2025-06-26", end: "2025-07-10", estimated: false },
  { name: "Autumn Sale", start: "2025-09-29", end: "2025-10-06", estimated: false },
  { name: "Winter Sale", start: "2025-12-18", end: "2026-01-05", estimated: false },
  { name: "Spring Sale", start: "2026-03-19", end: "2026-03-26", estimated: false },
  { name: "Summer Sale", start: "2026-06-25", end: "2026-07-09", estimated: false },
];

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** The `n`th (1-based) `weekday` (0 = Sunday) of a month, as epoch ms. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return Date.UTC(year, month - 1, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

/** The last `weekday` of a month, as epoch ms. */
function lastWeekday(year: number, month: number, weekday: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0));
  return lastDay.getTime() - ((lastDay.getUTCDay() - weekday + 7) % 7) * DAY_MS;
}

const THURSDAY = 4;
const MONDAY = 1;

/** One year's four sales on Valve's long-running pattern (see the header). */
export function estimatedSteamSales(year: number): SteamSaleWindow[] {
  const window = (name: SteamSaleName, start: number, days: number): SteamSaleWindow => ({
    name,
    start: iso(start),
    end: iso(start + days * DAY_MS),
    estimated: true,
  });
  return [
    // 2024 and 2025 opened on the 2nd Thursday, 2026 on the 3rd; the 3rd is
    // the later of the two, so "starts in ~N days" never promises it early.
    window("Spring Sale", nthWeekday(year, 3, THURSDAY, 3), 7),
    window("Summer Sale", lastWeekday(year, 6, THURSDAY), 14),
    window("Autumn Sale", lastWeekday(year, 9, MONDAY), 7),
    window("Winter Sale", nthWeekday(year, 12, THURSDAY, 3), 18),
  ];
}

/** Announced dates where Valve has given them, the pattern for the rest. */
export function steamSalesFor(year: number): SteamSaleWindow[] {
  return estimatedSteamSales(year).map(
    (guess) => ANNOUNCED.find((known) => known.name === guess.name && known.start.slice(0, 4) === String(year)) ?? guess,
  );
}

/**
 * The sale running on `today` (YYYY-MM-DD, UTC), else the next one to start.
 * Looks at this year and the next, so late December finds January's end of
 * the Winter Sale and the following Spring Sale.
 */
export function nextSteamSale(today: string): UpcomingSteamSale {
  const year = Number(today.slice(0, 4));
  const now = utc(today);
  const sales = [...steamSalesFor(year - 1), ...steamSalesFor(year), ...steamSalesFor(year + 1)];
  const live = sales.find((sale) => sale.start <= today && today <= sale.end);
  if (live) return { ...live, daysUntil: 0, live: true };
  const next = sales.filter((sale) => sale.start > today).sort((a, b) => a.start.localeCompare(b.start))[0];
  return { ...next, daysUntil: Math.round((utc(next.start) - now) / DAY_MS), live: false };
}
