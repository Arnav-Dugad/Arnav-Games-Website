/**
 * Exchange rates, for comparing regional prices — never for pricing.
 *
 * Every price we *show as a price* is the store's own figure in the store's
 * own currency. FX is only used for the regional comparison column, where a
 * converted figure is labelled as such.
 *
 * Source: Frankfurter (ECB reference rates, free, no key). ECB publishes ~30
 * currencies once per working day; anything it doesn't cover is simply
 * absent, and the caller reports `converted: null` rather than guessing.
 */

import { unstable_cache } from "next/cache";

const TWELVE_HOURS = 60 * 60 * 12;
const CURRENCY = /^[A-Z]{3}$/;

async function fetchRates(url: string): Promise<Record<string, number> | null> {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(3500) });
  // A 404/422 means the base currency isn't covered — a real, cacheable answer.
  if (res.status === 404 || res.status === 422) return null;
  if (!res.ok) throw new Error(`fx ${res.status}`);
  const json = (await res.json()) as { rates?: Record<string, unknown> };
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(json.rates ?? {})) {
    if (CURRENCY.test(code) && typeof value === "number" && value > 0) rates[code] = value;
  }
  return rates;
}

/**
 * Throws on a network failure so the failure isn't cached for 12 hours; the
 * public wrapper turns that into null.
 */
const cachedRates = unstable_cache(
  async (base: string): Promise<Record<string, number> | null> => {
    try {
      return await fetchRates(`https://api.frankfurter.dev/v1/latest?base=${base}`);
    } catch {
      // The legacy host serves the same data; only tried when the primary fails.
      return await fetchRates(`https://api.frankfurter.app/latest?from=${base}`);
    }
  },
  ["fx-rates-v1"],
  { revalidate: TWELVE_HOURS, tags: ["fx"] },
);

/**
 * Units of each currency per one `base` unit (`base=INR` → `{ USD: 0.0105 }`),
 * with `base` itself at 1. Null when the base isn't an ECB currency or the
 * feed is unreachable.
 */
export async function fxRates(base: string): Promise<Record<string, number> | null> {
  const code = base.toUpperCase();
  if (!CURRENCY.test(code)) return null;
  try {
    const rates = await cachedRates(code);
    return rates ? { ...rates, [code]: 1 } : null;
  } catch {
    return null;
  }
}
