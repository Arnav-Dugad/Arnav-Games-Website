"use client";

/**
 * Circular critic-score meter.
 *
 * The arc is drawn with `stroke-dasharray` on an SVG circle and animated by
 * transitioning `stroke-dashoffset` from empty to its final value when the ring
 * scrolls into view. Colour follows Metacritic's own banding via `scoreColor`.
 */

import { motion, useInView, useReducedMotion } from "motion/react";
import { useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";
import { scoreColor } from "@/lib/utils/format";

interface ScoreRingProps {
  score: number | null;
  size?: number;
  strokeWidth?: number;
  className?: string;
  label?: string;
}

export function ScoreRing({
  score,
  size = 76,
  strokeWidth = 5,
  className,
  label = "Metascore",
}: ScoreRingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score === null ? 0 : Math.min(100, Math.max(0, score)) / 100;
  const colour = scoreColor(score);

  return (
    <div
      ref={ref}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={score === null ? `${label}: not rated` : `${label}: ${score} out of 100`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="color-mix(in oklab, var(--color-fg) 9%, transparent)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{
            strokeDashoffset: inView ? circumference * (1 - pct) : circumference,
          }}
          transition={
            reduced ? { duration: 0 } : { duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.15 }
          }
          style={{ filter: `drop-shadow(0 0 6px ${colour}55)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-display font-bold leading-none tabular-nums"
          style={{ color: colour, fontSize: size * 0.3 }}
        >
          {score === null ? "—" : score}
        </span>
      </div>
    </div>
  );
}

/** Compact score chip for dense card corners, where a ring would be illegible. */
/** The dark-theme score hues, for pills that sit on cover art in either theme. */
const ON_IMAGE_TOKENS = {
  "--color-mint": "#30d158",
  "--color-gold": "#ffd60a",
  "--color-flare": "#ff375f",
  "--color-faint": "#8e8e93",
} as CSSProperties;

export function ScorePill({
  score,
  className,
  onImage = false,
}: {
  score: number | null;
  className?: string;
  /**
   * Over cover art. The light theme's darkened score hues are tuned for white
   * paper and turn muddy on artwork, so the pill keeps the bright dark-theme
   * hues and, in the light theme, gains a dark backing to sit on.
   */
  onImage?: boolean;
}) {
  if (score === null) return null;
  const colour = scoreColor(score);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums leading-none",
        onImage && "light:backdrop-blur-md light:[--pill-backing:rgb(0_0_0/0.55)]",
        className,
      )}
      style={{
        ...(onImage ? ON_IMAGE_TOKENS : null),
        color: colour,
        backgroundColor: `color-mix(in oklab, ${colour} 16%, var(--pill-backing, transparent))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${colour} 32%, transparent)`,
      }}
      aria-label={`Metascore ${score}`}
    >
      {score}
    </span>
  );
}
