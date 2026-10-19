import type { CoverPalette } from "./types";

/**
 * Palette extraction from decoded pixels. Pure and synchronous, so it can be
 * self-checked against synthetic buffers; fetching and caching live in
 * `palette.ts`.
 *
 * Pixels are quantised to 4 bits per channel (4,096 buckets). Each bucket keeps
 * the *sum* of its members, so the colour reported is the true average of the
 * pixels that landed there rather than the bucket's corner — which matters for
 * dark covers, where a corner colour reads noticeably wrong.
 */

interface Bucket {
  r: number;
  g: number;
  b: number;
  count: number;
}

interface Swatch {
  rgb: [number, number, number];
  count: number;
  s: number;
  l: number;
}

function hsl([r, g, b]: [number, number, number]): { s: number; l: number } {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * The luminance at which white and black text have equal contrast. Below it,
 * white text wins — which is exactly what `isDark` promises.
 */
const WHITE_TEXT_THRESHOLD = 0.179;

const hex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;

/**
 * Dominant, vibrant and muted colours of an RGBA buffer, or null when it has
 * no opaque pixels to speak of.
 *
 *  - dominant: the most populous bucket.
 *  - vibrant: saturated (s ≥ 0.35) and mid-lightness (0.25–0.75), ranked by
 *    population × saturation² × closeness to l = 0.5. Falls back to the most
 *    saturated colour present, then to dominant for greyscale art.
 *  - muted: low-to-moderate saturation (0.05–0.45) at 0.2–0.65 lightness,
 *    ranked by population. Falls back to dominant.
 */
export function paletteFromPixels(data: Uint8Array, width: number, height: number): CoverPalette | null {
  const buckets = new Map<number, Bucket>();
  let opaque = 0;
  const total = Math.min(width * height, Math.floor(data.length / 4));

  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count++;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
    opaque++;
  }
  if (opaque < 4) return null;

  const swatches: Swatch[] = [...buckets.values()].map((bucket) => {
    const rgb: [number, number, number] = [
      bucket.r / bucket.count,
      bucket.g / bucket.count,
      bucket.b / bucket.count,
    ];
    return { rgb, count: bucket.count, ...hsl(rgb) };
  });

  const best = (items: Swatch[], score: (swatch: Swatch) => number) =>
    items.reduce<Swatch | null>((top, item) => (!top || score(item) > score(top) ? item : top), null);

  const dominant = best(swatches, (swatch) => swatch.count)!;
  const vibrant =
    best(
      swatches.filter((swatch) => swatch.s >= 0.35 && swatch.l >= 0.25 && swatch.l <= 0.75),
      (swatch) => swatch.count * swatch.s ** 2 * (1 - Math.abs(swatch.l - 0.5)),
    ) ??
    best(
      swatches.filter((swatch) => swatch.s >= 0.15 && swatch.l > 0.1 && swatch.l < 0.9),
      (swatch) => swatch.s * Math.sqrt(swatch.count),
    ) ??
    dominant;
  const muted =
    best(
      swatches.filter((swatch) => swatch.s >= 0.05 && swatch.s <= 0.45 && swatch.l >= 0.2 && swatch.l <= 0.65),
      (swatch) => swatch.count,
    ) ?? dominant;

  return {
    dominant: hex(dominant.rgb),
    vibrant: hex(vibrant.rgb),
    muted: hex(muted.rgb),
    isDark: relativeLuminance(dominant.rgb) < WHITE_TEXT_THRESHOLD,
  };
}

/**
 * The logo's own tone, for marks whose source does not say (Wikidata).
 * Averages opaque pixels: near-black → "dark", near-white → "light", anything
 * with real chroma or mid-grey → "color".
 */
export function logoToneFromPixels(data: Uint8Array): "light" | "dark" | "color" | null {
  let sumL = 0;
  let sumS = 0;
  let count = 0;
  for (let o = 0; o + 3 < data.length; o += 4) {
    if (data[o + 3] < 128) continue;
    const { s, l } = hsl([data[o], data[o + 1], data[o + 2]]);
    sumL += l;
    sumS += s;
    count++;
  }
  if (count === 0) return null;
  const l = sumL / count;
  const s = sumS / count;
  if (s > 0.25) return "color";
  if (l < 0.25) return "dark";
  if (l > 0.8) return "light";
  return "color";
}
