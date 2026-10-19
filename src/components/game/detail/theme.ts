import type { CSSProperties } from "react";
import type { CoverPalette } from "@/lib/games/types";

/**
 * Page theming from a game's cover palette.
 *
 * The cover sampler hands back three colours, but they are raw pixels: the
 * "dominant" of a dark cover is often near-black, and a muddy brown "vibrant"
 * makes an unreadable accent. So nothing here uses a sampled colour as-is.
 * We keep only its *hue* (and a hint of its saturation), then rebuild a
 * colour at a lightness we choose for each surface:
 *
 *  - `--game-accent-dark`  sits on the dark UI (and the always-dark hero), so
 *    it is lifted to a light, readable tone.
 *  - `--game-accent-light` sits on the light theme's white surfaces, so it is
 *    pushed down until it keeps text contrast.
 *  - `--game-tint` is a deep, low-chroma version for the backdrop wash.
 *
 * When the cover has no trustworthy hue — greyscale art, or a near-black pixel
 * whose "hue" is just compression noise — the page falls back to the brand
 * accent rather than inventing a colour the art doesn't have.
 */

interface Hsl {
  h: number;
  s: number;
  l: number;
}

const BRAND = {
  dark: "#a493ff",
  light: "#5638e8",
  tint: "#141026",
};

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: [number, number, number]): Hsl & { chroma: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const chroma = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (chroma > 0) {
    if (max === rn) h = ((gn - bn) / chroma) % 6;
    else if (max === gn) h = (bn - rn) / chroma + 2;
    else h = (rn - gn) / chroma + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * l - 1));
  return { h, s, l, chroma };
}

function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** WCAG relative luminance, for choosing text that sits on a solid accent. */
function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The most usable hue in the palette, or null.
 *
 * `chroma` (max − min channel) is what makes a hue trustworthy: #010502 has a
 * nominally green hue but only 4/255 of chroma, i.e. it is black. Vibrant is
 * preferred because it is what the eye remembers of a cover.
 */
function pickHue(palette: CoverPalette): Hsl | null {
  const candidates = [palette.vibrant, palette.muted, palette.dominant]
    .map((hex) => parseHex(hex))
    .filter((rgb): rgb is [number, number, number] => rgb !== null)
    .map(rgbToHsl);
  const usable = candidates.find((c) => c.chroma >= 0.07 && c.s >= 0.16);
  return usable ? { h: usable.h, s: usable.s, l: usable.l } : null;
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const PANEL_DARK = luminance("#1c1c1e");
const WHITE = 1;

/**
 * Walks lightness until the colour reaches a WCAG contrast target against
 * its surface. HSL lightness alone is a poor guide — cyan at 36% is twice as
 * luminous as blue at 36% — so contrast, not a fixed L, decides.
 */
function solveLightness(h: number, s: number, start: number, step: number, against: number, target: number): string {
  let l = start;
  let hex = hslToHex({ h, s, l });
  while (contrast(luminance(hex), against) < target && l > 0.12 && l < 0.92) {
    l += step;
    hex = hslToHex({ h, s, l });
  }
  return hex;
}

/** Near-black or white, whichever reads better on a solid fill of the colour. */
function onAccent(hex: string): string {
  const l = luminance(hex);
  return contrast(l, 0) >= contrast(l, WHITE) ? "#0b0b12" : "#ffffff";
}

export interface GameTheme {
  accentDark: string;
  accentLight: string;
  onAccentDark: string;
  onAccentLight: string;
  tint: string;
  fromCover: boolean;
}

export function gameTheme(palette: CoverPalette | null | undefined): GameTheme {
  const hue = palette ? pickHue(palette) : null;
  if (!hue) {
    return {
      accentDark: BRAND.dark,
      accentLight: BRAND.light,
      onAccentDark: "#0b0b12",
      onAccentLight: "#ffffff",
      tint: BRAND.tint,
      fromCover: false,
    };
  }

  const s = clamp(hue.s, 0.5, 0.9);
  // Dark UI: at least 6:1 on the #1c1c1e panels. Light UI: at least 4.6:1 on
  // white, so accent text passes AA on both.
  const accentDark = solveLightness(hue.h, s, 0.6, 0.01, PANEL_DARK, 6);
  const accentLight = solveLightness(hue.h, clamp(s, 0.55, 0.85), 0.45, -0.01, WHITE, 4.6);
  const tint = hslToHex({ h: hue.h, s: clamp(hue.s, 0.25, 0.6), l: 0.12 });

  return {
    accentDark,
    accentLight,
    onAccentDark: onAccent(accentDark),
    onAccentLight: onAccent(accentLight),
    tint,
    fromCover: true,
  };
}

/**
 * Custom properties for the page root. Components read `--game-accent`,
 * `--game-on-accent` and `--game-tint`; the light theme swaps the accent pair
 * via `GAME_THEME_CLASS`, so no component needs to know which theme is on.
 */
export function gameThemeStyle(theme: GameTheme): CSSProperties {
  return {
    "--game-accent-dark": theme.accentDark,
    "--game-accent-light": theme.accentLight,
    "--game-on-accent-dark": theme.onAccentDark,
    "--game-on-accent-light": theme.onAccentLight,
    "--game-tint": theme.tint,
    "--game-glow": "color-mix(in oklab, var(--game-accent) 34%, transparent)",
  } as CSSProperties;
}

/**
 * Resolves the active accent pair. Kept in classes rather than the inline
 * style above, because an inline declaration would beat the light-theme rule
 * and the swap would never happen.
 */
export const GAME_THEME_CLASS =
  "[--game-accent:var(--game-accent-dark)] [--game-on-accent:var(--game-on-accent-dark)] [:root[data-theme=light]_&]:[--game-accent:var(--game-accent-light)] [:root[data-theme=light]_&]:[--game-on-accent:var(--game-on-accent-light)]";

/**
 * The hero is always a dark, image-led surface — in the light theme too, the
 * way Apple's product pages open on a dark stage before the page turns light.
 * Re-declaring the tokens here re-themes every Tailwind utility inside it
 * (they all read `var(--color-*)`), so the official logo — usually a white
 * mark — and the white-on-art copy keep their contrast in either theme.
 */
export const DARK_STAGE_STYLE = {
  colorScheme: "dark",
  "--color-bg": "#000000",
  "--color-bg-elev": "#0c0c0e",
  "--color-panel": "#1c1c1e",
  "--color-panel-2": "#2c2c2e",
  "--color-fg": "#ffffff",
  "--color-line": "#ffffff17",
  "--color-line-strong": "#ffffff2b",
  "--color-text": "#f5f5f7",
  "--color-muted": "#a1a1a6",
  "--color-faint": "#8e8e93",
  "--color-brand": "#8a72ff",
  "--color-brand-soft": "#b9adff",
  "--color-neon": "#64d2ff",
  "--color-flare": "#ff375f",
  "--color-gold": "#ffd60a",
  "--color-mint": "#30d158",
  "--game-accent": "var(--game-accent-dark)",
  "--game-on-accent": "var(--game-on-accent-dark)",
  // Re-derived here: inherited custom properties arrive already computed
  // against the page root's (possibly light-theme) accent.
  "--game-glow": "color-mix(in oklab, var(--game-accent-dark) 34%, transparent)",
} as CSSProperties;
