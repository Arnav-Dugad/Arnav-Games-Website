/**
 * Theme-aware art direction: which image a hero shows in the light theme.
 *
 * Heroes stay dark stages in both themes (white type, white logos), but a
 * night-time screenshot under a light page reads as a hole in it. When a
 * game has a noticeably brighter piece of art, the light theme uses that
 * one instead, judged by the luminance of palettes sampled from the real
 * pixels (`paletteFor`). The dark theme keeps the art it always had.
 *
 * Pure: the server picks, the client only swaps layers with CSS.
 */

import type { CoverPalette } from "./types";

/** Relative luminance (WCAG) of a #rrggbb colour, 0–1. */
function hexLuminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/**
 * How bright an image reads overall: mostly its dominant colour, with the
 * muted and vibrant ones for the rest of the frame.
 */
export function paletteLuminance(palette: CoverPalette | null | undefined): number | null {
  if (!palette) return null;
  const dominant = hexLuminance(palette.dominant);
  if (dominant === null) return null;
  const muted = hexLuminance(palette.muted) ?? dominant;
  const vibrant = hexLuminance(palette.vibrant) ?? dominant;
  return dominant * 0.6 + muted * 0.25 + vibrant * 0.15;
}

/** Brighter by at least this much, or the swap isn't worth a second image. */
export const LIGHT_ART_MARGIN = 0.06;

/**
 * The candidate to show in the light theme instead of `current`, or null
 * when none is clearly brighter (or nothing could be measured).
 */
export function brighterArt<T extends { image: string; palette: CoverPalette | null }>(
  current: { palette: CoverPalette | null },
  candidates: T[],
): T | null {
  const base = paletteLuminance(current.palette);
  if (base === null) return null;
  let best: { item: T; luminance: number } | null = null;
  for (const item of candidates) {
    const luminance = paletteLuminance(item.palette);
    if (luminance !== null && luminance >= base + LIGHT_ART_MARGIN && (!best || luminance > best.luminance)) best = { item, luminance };
  }
  return best?.item ?? null;
}
