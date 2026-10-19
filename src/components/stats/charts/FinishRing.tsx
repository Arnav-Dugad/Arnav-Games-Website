"use client";

import { motion } from "motion/react";
import { CountUp, DRAW_EASE, drawTransition, useChartMotion } from "../primitives";

const SIZE = 132;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;

/** A single-value ring, Activity-style: the fill is the rate, the track is the rest. */
export function FinishRing({ rate, className = "h-28 w-28 sm:h-[132px] sm:w-[132px]" }: { rate: number; className?: string }) {
  const motionOn = useChartMotion();
  const clamped = Math.max(0, Math.min(1, rate));
  return (
    <div className={`relative shrink-0 ${className}`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block h-full w-full -rotate-90" aria-hidden>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--color-mint)" strokeOpacity={0.16} strokeWidth={STROKE} />
        {clamped > 0 && (
          <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-mint)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: clamped }}
            viewport={{ once: true, amount: 0.6 }}
            transition={drawTransition(motionOn, { duration: 1.2, ease: DRAW_EASE })}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <CountUp value={clamped * 100} format={(n) => `${Math.round(n)}%`} className="font-display text-2xl font-bold leading-none sm:text-[1.75rem]" />
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">finished</span>
      </div>
    </div>
  );
}
