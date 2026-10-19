/**
 * The brand mark as data: the "A" glyph and the tile gradient.
 *
 * One source for every rendering of the mark that isn't the header `Logo` —
 * the launch splash, and the PNG icons, iOS startup images and shortcut icons
 * produced by `scripts/generate-pwa-assets.ts`. Kept free of React and of `@/`
 * imports so that script can load it directly with `tsx`.
 *
 * The values match `src/app/icon.svg` (the original favicon), which is the
 * mark people already recognise in their tab bar.
 */

/** The "A", drawn in a 64×64 box. Its bounds are x 15–49, y 15–49 (centred). */
export const MARK_GLYPH_PATH = "M27.6 15h8.8L49 49h-8.3l-2.6-7.4H25.9L23.3 49H15zm-.1 19.9h9L32 21.6z";

/** Tile corner radius in the same 64-unit box (≈23%, an iOS-like squircle-ish round). */
export const MARK_TILE_RADIUS = 15;

/** Diagonal gradient, top-left → bottom-right. */
export const MARK_GRADIENT_FROM = "#7C5CFF";
export const MARK_GRADIENT_TO = "#22D3EE";

/** App chrome background — the dark theme canvas, used by manifest and splash. */
export const APP_BACKGROUND = "#000000";

/**
 * CSS size of the mark on launch screens. The iOS startup images and the
 * in-app splash both draw the tile at this size, dead centre, so the native
 * still hands over to the animated splash without the mark jumping.
 */
export const SPLASH_MARK_SIZE = 112;
