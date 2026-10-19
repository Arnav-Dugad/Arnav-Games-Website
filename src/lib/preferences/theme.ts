"use client";

/**
 * Appearance: System / Light / Dark.
 *
 * The resolved theme lives on `<html data-theme>`, which every colour token in
 * globals.css keys off. It is applied before first paint by the boot script in
 * `theme-script.ts` (inlined in the root layout, so a light-mode reader never
 * sees a flash of the dark page), and again whenever the preference changes:
 * the setter below fires an event the boot script listens for, so there is one
 * resolver, not two.
 *
 * The preference is device-local: appearance is usually a property of the
 * screen you are holding, not of the account.
 */

import { useCallback, useSyncExternalStore } from "react";
import { THEME_CHANGE_EVENT, THEME_KEY, type ResolvedTheme, type ThemePreference } from "./theme-script";

export type { ThemePreference } from "./theme-script";

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Current preference plus a setter. Server render reports "system". */
export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as const);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked — the change still applies for this page view */
      const resolved: ResolvedTheme =
        next === "system"
          ? window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark"
          : next;
      document.documentElement.dataset.theme = resolved;
    }
    // The boot script listens for this and re-resolves the theme.
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  return [preference, setPreference];
}
