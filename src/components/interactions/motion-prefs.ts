"use client";

import { useReducedMotion } from "motion/react";
import { usePreferences } from "@/lib/preferences/PreferencesProvider";

/**
 * True when motion should be calm: either the OS asks for reduced motion or
 * the reader flipped the in-app switch in Settings.
 *
 * The CSS layer already squashes durations for both, but gesture-driven
 * components animate from JavaScript (springs, momentum), which CSS can't
 * reach — so they read this and swap to instant, non-physical behaviour.
 */
export function useCalmMotion(): boolean {
  const osReduced = useReducedMotion();
  const { reduceMotion } = usePreferences();
  return Boolean(osReduced) || reduceMotion;
}
