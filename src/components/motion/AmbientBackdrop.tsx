/**
 * The site-wide moving backdrop: three soft colour fields drifting behind
 * every page, mounted once in the root layout.
 *
 * Deliberately a server component with no state and no script: the drift is
 * pure CSS keyframes on `transform` (see `.ambient-field` in globals.css), so
 * it ships zero JavaScript, never re-renders, and the browser stops painting
 * it on its own when the tab is hidden. Reduced motion (OS or the in-app
 * switch) freezes it through the global rules in the base layer.
 *
 * It replaces the per-page `Aurora` blobs that mastheads, the auth pages and
 * the 404 each used to animate — those moved a large `filter: blur()` every
 * frame, which is exactly what mid-range phones can't afford, and stacked a
 * second aurora over this one.
 *
 * Game pages tint it toward their cover (`GameAmbientStyle` publishes the
 * accent; `.ambient-game` fades in while the brand fields step back).
 */
export function AmbientBackdrop() {
  return (
    <div aria-hidden className="ambient-backdrop">
      <span className="ambient-field ambient-field-1" />
      <span className="ambient-field ambient-field-2" />
      <span className="ambient-field ambient-field-3" />
      <span className="ambient-game" />
    </div>
  );
}
