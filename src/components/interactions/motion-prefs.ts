"use client";

import { usePrefersReducedMotion } from "@/hooks";
import { usePreferences } from "@/lib/preferences/PreferencesProvider";

/**
 * True when motion should be calm: either the OS asks for reduced motion or
 * the reader flipped the in-app switch in Settings.
 *
 * The CSS layer already squashes durations for both, but gesture-driven
 * components animate from JavaScript (springs, momentum), which CSS can't
 * reach — so they read this and swap to instant, non-physical behaviour.
 *
 * The OS half is media-query based and false on the server, so the first
 * client render matches the server HTML (motion's own hook does not).
 */
export function useCalmMotion(): boolean {
  const osReduced = usePrefersReducedMotion();
  const { reduceMotion } = usePreferences();
  return osReduced || reduceMotion;
}
