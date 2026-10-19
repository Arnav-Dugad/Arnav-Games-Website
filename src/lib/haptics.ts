/**
 * Tactile feedback for moments that deserve it.
 *
 * The web has one haptics primitive, `navigator.vibrate`, and only Android
 * Chrome (and a few Chromium derivatives) implements it. iOS Safari exposes no
 * haptics API at all, and desktop browsers either lack the method or have no
 * motor to drive. Everything here is therefore strictly progressive: callers
 * fire-and-forget, and on any platform without support the call is a no-op.
 *
 * The patterns are deliberately short. A phone's vibration motor is far
 * coarser than Apple's Taptic Engine — anything longer than ~20ms reads as a
 * buzz rather than a tick, which is the opposite of what a selection change or
 * a snap should feel like.
 *
 * Usage guidance (keep the vocabulary small so it stays meaningful):
 *  - `selection`: a value changed under the finger — picker ticks, cover-flow
 *    snaps, tab changes.
 *  - `light`:     a surface responded — a sheet dismissed, a menu closed.
 *  - `medium`:    a gesture crossed a threshold — long-press opened a menu,
 *    pull-to-refresh armed.
 *  - `success`:   an action completed — followed, status saved.
 *  - `warning`:   an action failed or was refused.
 */

export type HapticKind = "selection" | "light" | "medium" | "success" | "warning";

const PATTERNS: Record<HapticKind, number | number[]> = {
  selection: 6,
  light: 10,
  medium: 16,
  // Two quick taps read as "done" without becoming a buzz.
  success: [10, 50, 14],
  // A longer double-pulse, distinct enough to register as "not that".
  warning: [18, 70, 18],
};

/**
 * Some Android builds rate-limit or drop vibrations fired in quick
 * succession, and a cover-flow fling can cross a dozen snap points in a
 * second. Throttling keeps the motor from queueing a long rattle.
 */
const MIN_INTERVAL_MS = 34;
let lastFired = 0;

function reducedMotion(): boolean {
  // Haptics are motion of a kind; people who asked the site to sit still
  // (in-app setting or OS) get silence too.
  if (document.documentElement.dataset.reduceMotion === "true") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function haptic(kind: HapticKind = "selection"): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  // Vibration is only allowed after a user gesture; Chrome logs an
  // intervention warning (and ignores the call) otherwise.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
  if (reducedMotion()) return;

  const now = performance.now();
  if (kind === "selection" && now - lastFired < MIN_INTERVAL_MS) return;
  lastFired = now;

  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Some embedded webviews throw instead of returning false. Never let
    // feedback break the action it decorates.
  }
}
