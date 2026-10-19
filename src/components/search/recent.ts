"use client";

/**
 * The reader's recent searches, kept in localStorage — and, when signed in,
 * mirrored to the account (see `PreferencesProvider`) so they follow the
 * reader to a new device.
 */

import { useCallback, useSyncExternalStore } from "react";

export const RECENT_KEY = "arnav-games:recent-searches";
export const RECENT_EVENT = "arnav-games:recent-searches";
export const MAX_RECENT = 8;
const EMPTY: string[] = [];

let cache: { raw: string | null; value: string[] } = { raw: null, value: EMPTY };

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (raw === cache.raw) return cache.value;
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const value = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT)
      : EMPTY;
    cache = { raw, value };
    return value;
  } catch {
    // Private mode, blocked storage or corrupt JSON: recents are a nicety.
    return EMPTY;
  }
}

function writeRecent(next: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, MAX_RECENT)));
  } catch {
    /* storage unavailable — nothing to remember */
  }
  window.dispatchEvent(new Event(RECENT_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(RECENT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(RECENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Recent searches, newest first (device copy; mirrored to the account when signed in). */
export function useRecentSearches() {
  const recent = useSyncExternalStore(subscribe, readRecent, () => EMPTY);

  const remember = useCallback((term: string) => {
    const clean = term.trim().replace(/\s+/g, " ");
    if (clean.length < 2) return;
    const key = clean.toLowerCase();
    writeRecent([clean, ...readRecent().filter((item) => item.toLowerCase() !== key)]);
  }, []);

  const forget = useCallback((term: string) => {
    writeRecent(readRecent().filter((item) => item !== term));
  }, []);

  const clear = useCallback(() => writeRecent([]), []);

  return { recent, remember, forget, clear };
}
