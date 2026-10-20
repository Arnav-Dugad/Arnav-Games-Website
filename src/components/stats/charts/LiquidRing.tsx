"use client";

/**
 * A progress ring filled with liquid: the level is the value, two offset
 * waves drift across its surface, and when the value changes the level
 * rises or falls on a spring — so finishing a game visibly tops it up.
 *
 * The waves only move while the ring is on screen, and not at all with
 * reduced motion (the level then simply sits at its value). The figure in
 * the middle is the real percentage; the art is decoration (`aria-hidden`).
 */

import { motion, useInView, useSpring, useTransform } from "motion/react";
import { useEffect, useId, useRef } from "react";
import { CountUp, useChartMotion } from "../primitives";

const SIZE = 132;
const STROKE = 6;
const INNER = SIZE / 2 - STROKE - 4;
/** One wavelength; the path spans two so a one-wavelength shift loops seamlessly. */
const WAVE = INNER * 2;

function wavePath(amplitude: number): string {
  const top = SIZE / 2 - INNER;
  const left = SIZE / 2 - INNER;
  let d = `M ${left} ${top}`;
  for (let i = 0; i < 4; i++) d += ` q ${WAVE / 4} ${i % 2 === 0 ? -amplitude : amplitude} ${WAVE / 2} 0`;
  return `${d} V ${SIZE + 4} H ${left} Z`;
}

const FRONT = wavePath(5);
const BACK = wavePath(7);

export function LiquidRing({
  value,
  label,
  tone = "var(--color-mint)",
  className = "h-28 w-28 sm:h-[132px] sm:w-[132px]",
}: {
  /** 0–1. */
  value: number;
  label: string;
  tone?: string;
  className?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const motionOn = useChartMotion();
  const inView = useInView(ref, { amount: 0.3 });
  const clamped = Math.max(0, Math.min(1, value));
  // Level: 0 → the wave's crest sits at the bottom of the bowl; 1 → over the top.
  const level = useSpring(0, { stiffness: 60, damping: 18 });
  useEffect(() => {
    if (!inView && level.get() === 0) return;
    if (motionOn) level.set(clamped);
    else level.jump(clamped);
  }, [clamped, inView, motionOn, level]);
  const y = useTransform(level, (v) => (1 - v) * INNER * 2 + (v >= 1 ? -8 : 0));
  const drift = motionOn && inView;

  return (
    <div ref={ref} className={`relative shrink-0 ${className}`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block h-full w-full" aria-hidden>
        <defs>
          <clipPath id={`${id}-bowl`}>
            <circle cx={SIZE / 2} cy={SIZE / 2} r={INNER} />
          </clipPath>
        </defs>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - STROKE / 2} fill="none" stroke={tone} strokeOpacity={0.35} strokeWidth={STROKE} />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={INNER} fill={tone} fillOpacity={0.08} />
        <g clipPath={`url(#${id}-bowl)`}>
          <motion.g style={{ y }}>
            <motion.path
              d={BACK}
              fill={tone}
              fillOpacity={0.35}
              animate={drift ? { x: [-WAVE, 0] } : { x: -WAVE / 3 }}
              transition={drift ? { repeat: Infinity, ease: "linear", duration: 5.5 } : { duration: 0 }}
            />
            <motion.path
              d={FRONT}
              fill={tone}
              fillOpacity={0.75}
              animate={drift ? { x: [0, -WAVE] } : { x: 0 }}
              transition={drift ? { repeat: Infinity, ease: "linear", duration: 3.6 } : { duration: 0 }}
            />
          </motion.g>
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <CountUp value={clamped * 100} format={(n) => `${Math.round(n)}%`} className="font-display text-2xl font-bold leading-none text-text [text-shadow:0_1px_8px_var(--color-bg)] sm:text-[1.75rem]" />
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-text/80 [text-shadow:0_1px_6px_var(--color-bg)]">{label}</span>
      </div>
    </div>
  );
}
