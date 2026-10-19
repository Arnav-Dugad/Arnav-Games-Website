"use client";

/**
 * Price region: which country's store prices to show.
 *
 * Prices are always the store's own local prices for this country — never a
 * currency conversion of a US price. The default comes from the visitor's
 * location: the `ag-cc` cookie the Worker sets on page loads, falling back to
 * `/api/region` (Cloudflare's `cf-ipcountry`) when it's absent, e.g. in
 * `next dev`. Settings lets the reader pick another; an explicit choice is
 * mirrored to the signed-in account (see `PreferencesProvider`).
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";

export const REGION_KEY = `${STORAGE_PREFIX}price-region`;
const DETECTED_KEY = `${STORAGE_PREFIX}price-region-detected`;
export const REGION_CHANGE_EVENT = "arnav-games:region-change";
const CHANGE_EVENT = REGION_CHANGE_EVENT;
export const FALLBACK_REGION = "US";

/** Countries offered in Settings: Steam storefronts with their own pricing. */
export const PRICE_REGIONS: Array<{ code: string; name: string }> = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "IN", name: "India" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "DE", name: "Germany (Euro)" },
  { code: "FR", name: "France (Euro)" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "TR", name: "Türkiye" },
  { code: "PL", name: "Poland" },
  { code: "NO", name: "Norway" },
  { code: "CH", name: "Switzerland" },
  { code: "SG", name: "Singapore" },
  { code: "ID", name: "Indonesia" },
  { code: "PH", name: "Philippines" },
  { code: "MY", name: "Malaysia" },
  { code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },
  { code: "ZA", name: "South Africa" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "IL", name: "Israel" },
  { code: "CN", name: "China" },
  { code: "HK", name: "Hong Kong" },
  { code: "TW", name: "Taiwan" },
  { code: "CL", name: "Chile" },
  { code: "CO", name: "Colombia" },
  { code: "PE", name: "Peru" },
  { code: "UA", name: "Ukraine" },
  { code: "KZ", name: "Kazakhstan" },
];

const valid = (code: string | null): code is string => Boolean(code && /^[A-Z]{2}$/.test(code));

function readKey(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The country the Worker stamps on page loads (the `ag-cc` cookie, see worker.mjs) —
 * the default region without asking `/api/region`, and kept current if the
 * reader travels.
 */
function readCookieCountry(): string | null {
  try {
    const match = document.cookie.match(/(?:^|;\s*)ag-cc=([A-Z]{2})(?:;|$)/);
    return match && valid(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

/** The automatic (detected) country, whatever the reader has chosen. */
export const readDetectedRegion = () => readCookieCountry() ?? readKey(DETECTED_KEY);
const readRegion = () => readKey(REGION_KEY) ?? readDetectedRegion();
const readExplicit = () => readKey(REGION_KEY) !== null;

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the default region applies */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

let detecting: Promise<void> | null = null;

/** Asks the server where we are, once per page load, only when the cookie is missing; settles on US otherwise. */
function detectOnce() {
  detecting ??= fetch("/api/region")
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { country?: string | null } | null) => body?.country?.toUpperCase() ?? null)
    .catch(() => null)
    .then((country) => remember(DETECTED_KEY, valid(country) ? country : FALLBACK_REGION));
  return detecting;
}

/**
 * `[region, setRegion, isExplicit]`. `region` is null until known (server
 * render, or detection in flight) — callers should wait rather than flash US
 * prices to someone in India. `setRegion(null)` returns to automatic.
 */
export function usePriceRegion(): [string | null, (code: string | null) => void, boolean] {
  const region = useSyncExternalStore(subscribe, readRegion, () => null);
  const explicit = useSyncExternalStore(subscribe, readExplicit, () => false);

  useEffect(() => {
    if (!region) void detectOnce();
  }, [region]);

  const setRegion = useCallback((code: string | null) => {
    if (code && valid(code)) {
      remember(REGION_KEY, code);
      return;
    }
    try {
      window.localStorage.removeItem(REGION_KEY);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [region, setRegion, explicit];
}
