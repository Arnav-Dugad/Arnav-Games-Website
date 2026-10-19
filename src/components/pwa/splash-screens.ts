/**
 * iOS launch images (`apple-touch-startup-image`).
 *
 * iOS ignores the manifest for its launch screen and instead picks the
 * startup image whose media query exactly matches the device's CSS size and
 * pixel ratio; with no match it shows a blank screen. So each entry here is
 * one real display class, not a generic breakpoint.
 *
 * The list is deliberately trimmed to devices that run a current iOS (16.4+,
 * the first version with real home-screen web apps) and are still common.
 * iPhones only get portrait — the app isn't launched sideways often enough to
 * justify doubling the files — while iPads get both orientations.
 *
 * Consumed by the root layout (link tags) and by
 * `scripts/generate-pwa-assets.ts` (the PNGs), so the two can't drift.
 */

export interface SplashDevice {
  /** For humans reading the generated files; not emitted. */
  label: string;
  /** Portrait CSS viewport. */
  width: number;
  height: number;
  ratio: 2 | 3;
  /** iPads rotate freely, so they also get a landscape image. */
  landscape: boolean;
}

export const SPLASH_DEVICES: readonly SplashDevice[] = [
  // iPhones
  { label: "iPhone 16/17 Pro Max", width: 440, height: 956, ratio: 3, landscape: false },
  { label: "iPhone 14/15 Pro Max, 15/16 Plus", width: 430, height: 932, ratio: 3, landscape: false },
  { label: "iPhone Air", width: 420, height: 912, ratio: 3, landscape: false },
  { label: "iPhone 16 Pro, 17, 17 Pro", width: 402, height: 874, ratio: 3, landscape: false },
  { label: "iPhone 14 Pro, 15, 15 Pro, 16", width: 393, height: 852, ratio: 3, landscape: false },
  { label: "iPhone 12/13/14, 16e", width: 390, height: 844, ratio: 3, landscape: false },
  { label: "iPhone 12/13 Pro Max, 14 Plus", width: 428, height: 926, ratio: 3, landscape: false },
  { label: "iPhone X/XS/11 Pro, 12/13 mini", width: 375, height: 812, ratio: 3, landscape: false },
  { label: "iPhone XS Max, 11 Pro Max", width: 414, height: 896, ratio: 3, landscape: false },
  { label: "iPhone XR, 11", width: 414, height: 896, ratio: 2, landscape: false },
  { label: "iPhone SE (2nd/3rd gen), 8", width: 375, height: 667, ratio: 2, landscape: false },
  // iPads
  { label: "iPad Pro 13 (M4), iPad Air 13", width: 1032, height: 1376, ratio: 2, landscape: true },
  { label: "iPad Pro 12.9", width: 1024, height: 1366, ratio: 2, landscape: true },
  { label: "iPad Pro 11 (M4)", width: 834, height: 1210, ratio: 2, landscape: true },
  { label: "iPad Pro 11, iPad Air 11", width: 834, height: 1194, ratio: 2, landscape: true },
  { label: "iPad Air 10.9, iPad (10th gen)", width: 820, height: 1180, ratio: 2, landscape: true },
  { label: "iPad mini (6th/7th gen)", width: 744, height: 1133, ratio: 2, landscape: true },
  { label: "iPad (9th gen)", width: 810, height: 1080, ratio: 2, landscape: true },
];

export interface SplashImage {
  /** Public URL of the PNG. */
  url: string;
  media: string;
  /** Pixel size of the PNG. */
  pixelWidth: number;
  pixelHeight: number;
  ratio: 2 | 3;
}

/** Every startup image, both orientations where applicable. */
export function splashImages(): SplashImage[] {
  const out: SplashImage[] = [];
  for (const d of SPLASH_DEVICES) {
    const orientations = d.landscape ? (["portrait", "landscape"] as const) : (["portrait"] as const);
    for (const orientation of orientations) {
      const pixelWidth = (orientation === "portrait" ? d.width : d.height) * d.ratio;
      const pixelHeight = (orientation === "portrait" ? d.height : d.width) * d.ratio;
      out.push({
        url: `/splash/apple-splash-${pixelWidth}x${pixelHeight}.png`,
        // device-width/height are always the portrait values on iOS; the
        // orientation clause picks between the two images.
        media:
          `screen and (device-width: ${d.width}px) and (device-height: ${d.height}px) and ` +
          `(-webkit-device-pixel-ratio: ${d.ratio}) and (orientation: ${orientation})`,
        pixelWidth,
        pixelHeight,
        ratio: d.ratio,
      });
    }
  }
  return out;
}
