/**
 * Ambient colour for a hero slide, derived from its sampled palette.
 *
 * The stage is always dark — it sits under white type and a playing trailer
 * in both themes — so every colour here is pushed toward black or kept as a
 * low-alpha glow. The palette only ever *tints* the scrims; it never decides
 * whether text is legible.
 */

import type { CoverPalette } from "@/lib/games/types";

type Rgb = [number, number, number];

/** The neutral stage when a slide has no palette: near-black with a hint of the brand violet. */
const FALLBACK_BASE: Rgb = [9, 8, 16];
const FALLBACK_GLOW: Rgb = [138, 114, 255];

function parseHex(hex: string | null | undefined): Rgb | null {
  const match = hex?.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const mix = (a: Rgb, b: Rgb, amount: number): Rgb =>
  [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * amount)) as Rgb;

/** Relative luminance (sRGB, 0–1), for deciding how far to lift an accent. */
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const rgba = ([r, g, b]: Rgb, alpha = 1) => `rgb(${r} ${g} ${b} / ${alpha})`;

export interface HeroTint {
  /** The stage's own colour: the palette's dominant tone, pushed almost to black. */
  base: (alpha?: number) => string;
  /** A soft light source behind the copy. */
  glow: (alpha?: number) => string;
  /** Progress fill and focus accents — lifted until it reads on dark glass. */
  accent: string;
}

export function heroTint(palette: CoverPalette | null | undefined, depth = 0.82): HeroTint {
  const dominant = parseHex(palette?.dominant);
  const vibrant = parseHex(palette?.vibrant) ?? dominant;

  // 82% toward black keeps the hue recognisable while staying darker than
  // any type that sits on it needs. The light theme passes a shallower
  // depth: richer colour, still well under white type.
  const base = dominant ? mix(dominant, [0, 0, 0], depth) : FALLBACK_BASE;
  const glow = vibrant ?? FALLBACK_GLOW;
  // Dark vibrants (deep reds, navy) get lifted harder than already-bright ones.
  const accent = mix(glow, [255, 255, 255], luminance(glow) < 0.18 ? 0.55 : 0.28);

  return {
    base: (alpha = 1) => rgba(base, alpha),
    glow: (alpha = 1) => rgba(glow, alpha),
    accent: rgba(accent),
  };
}
