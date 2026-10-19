import type { HypeIndex } from "./types";

/**
 * The hype index: one 0–100 number for "how much attention is on this game".
 *
 * Inputs are IGDB's `hypes` (a raw count of pre-release follows) and four
 * popularity primitives. The primitives are IGDB's *normalised shares* — a
 * game's fraction of all activity of that kind, e.g. 0.0012 — not counts, so
 * they are only comparable within one signal. Each signal is therefore mapped
 * to 0–1 on its own log scale and the results are blended with fixed weights.
 *
 * Log scaling, because every one of these signals is heavy-tailed: the top
 * title has ~100× the share of the 1,000th. A linear scale would give the
 * whole catalogue a score of ~0 next to GTA VI.
 *
 * Per signal:   s = clamp( log10(value / floor) / log10(cap / floor), 0, 1 )
 * (hypes uses   s = log10(1 + hypes) / log10(1 + cap), since it is a count.)
 * Score:        round(100 × Σ weight × s)
 *
 * Caps and floors come from sampling IGDB on 2026-10-19:
 *
 *   signal               top value     ~1,000th      ~10,000th     cap        floor
 *   hypes                1,102 (GTA VI) —             —             1,000      —
 *   want to play (2)     0.00194       0.000145      0.0000193     0.0015     0.000005
 *   visits (1)           0.00525       0.0000579     0.0000124     0.002      0.000003
 *   playing (3)          0.00726       0.000167      0.0000167     0.005      0.000005
 *   24h peak players (5) 0.186         0.0000546     0.00000037    0.03       0.0000005
 *
 * Caps sit just under the top handful of titles so the real heavyweights all
 * read ~100 rather than one outlier owning the scale; floors sit around the
 * long-tail noise so a single visit doesn't register as attention.
 *
 * A missing signal counts as zero, never as "unknown, re-weight the rest".
 * Re-weighting would let a game *gain* score by losing a weak signal, which
 * breaks the one property a ranking must have: more attention never lowers it.
 * The formula is monotonic in every input.
 */

export const HYPE_WEIGHTS = {
  wantToPlay: 0.35,
  hypes: 0.25,
  playing: 0.15,
  visits: 0.15,
  peakPlayers24h: 0.1,
} as const;

export const HYPE_SCALE = {
  hypes: { cap: 1000 },
  wantToPlay: { cap: 0.0015, floor: 0.000005 },
  visits: { cap: 0.002, floor: 0.000003 },
  playing: { cap: 0.005, floor: 0.000005 },
  peakPlayers24h: { cap: 0.03, floor: 0.0000005 },
} as const;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

function shareScore(value: number | null, { cap, floor }: { cap: number; floor: number }): number {
  if (value === null || !Number.isFinite(value) || value <= floor) return 0;
  return clamp01(Math.log10(value / floor) / Math.log10(cap / floor));
}

/** The 0–100 score for a set of signals. Exported for self-checks. */
export function hypeScore(signals: HypeIndex["signals"]): number {
  const hypes = Math.max(0, signals.hypes || 0);
  const parts =
    HYPE_WEIGHTS.hypes * clamp01(Math.log10(1 + hypes) / Math.log10(1 + HYPE_SCALE.hypes.cap)) +
    HYPE_WEIGHTS.wantToPlay * shareScore(signals.wantToPlay, HYPE_SCALE.wantToPlay) +
    HYPE_WEIGHTS.visits * shareScore(signals.visits, HYPE_SCALE.visits) +
    HYPE_WEIGHTS.playing * shareScore(signals.playing, HYPE_SCALE.playing) +
    HYPE_WEIGHTS.peakPlayers24h * shareScore(signals.peakPlayers24h, HYPE_SCALE.peakPlayers24h);
  return Math.round(100 * parts);
}

/**
 * A full index, or null when IGDB has no signal at all for the game — "no
 * data" is not the same claim as "zero hype", and the UI should not show a 0.
 */
export function buildHypeIndex(signals: HypeIndex["signals"]): HypeIndex | null {
  const hasSignal =
    signals.hypes > 0 ||
    [signals.wantToPlay, signals.visits, signals.playing, signals.peakPlayers24h].some(
      (value) => value !== null,
    );
  return hasSignal ? { score: hypeScore(signals), signals } : null;
}
