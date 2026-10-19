/**
 * Money formatting for market data, which always arrives as integer minor
 * units (cents, paise…) in an ISO 4217 currency (see `GameMarket`).
 *
 * The scale comes from the currency itself (Intl knows JPY has no minor unit
 * and INR has two), never from an assumed "÷100". The locale is the store's
 * country, so Indian prices group as ₹3,599 / ₹1,23,456 the way Indian
 * readers expect, and whole amounts drop the ".00" noise.
 */

const digitsCache = new Map<string, number>();

export function fractionDigits(currency: string): number {
  let digits = digitsCache.get(currency);
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    digitsCache.set(currency, digits);
  }
  return digits;
}

export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** fractionDigits(currency);
}

function localeFor(country: string | null | undefined): string {
  return country && /^[A-Z]{2}$/.test(country) ? `en-${country}` : "en";
}

export function formatMoney(
  minor: number,
  currency: string,
  country?: string | null,
  options: { compact?: boolean } = {},
): string {
  const major = toMajor(minor, currency);
  if (major === 0) return "Free";
  const whole = Number.isInteger(major);
  try {
    return new Intl.NumberFormat(localeFor(country), {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      notation: options.compact && major >= 10_000 ? "compact" : "standard",
      minimumFractionDigits: whole ? 0 : undefined,
      maximumFractionDigits: options.compact ? (whole ? 0 : Math.min(2, fractionDigits(currency))) : undefined,
    }).format(major);
  } catch {
    return `${major.toFixed(whole ? 0 : 2)} ${currency}`;
  }
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

export function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * A per-hour rate. From 10 major units up the cents are noise ("₹65", not
 * "₹65.43"); below that they're the whole story ("$1.30").
 */
export function formatRate(minor: number, currency: string, country?: string | null): string {
  const major = toMajor(minor, currency);
  const rounded = major >= 10 ? Math.round(major) * 10 ** fractionDigits(currency) : Math.round(minor);
  return formatMoney(rounded, currency, country);
}
