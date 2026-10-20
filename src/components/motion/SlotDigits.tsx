"use client";

/**
 * A number whose digits are slot-machine reels: each digit is a strip of
 * 0–9 in a one-digit window. On first appearance every reel spins a full
 * turn and lands where it started (staggered left to right, so it reads as
 * a pull of the lever); when the number changes, each reel rolls to its new
 * digit.
 *
 * The server and the first client render show the reels already resting on
 * the right digits, so nothing flashes and hydration matches (the markup is
 * the same whatever the motion setting); the spin only starts after mount.
 * Reduced motion: the reels never spin and changes land instantly — plain
 * digits to the eye. The number is exposed to assistive tech once, as text.
 */

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { cn } from "@/lib/utils/cn";

const STRIP = Array.from({ length: 30 }, (_, index) => index % 10);

export function SlotDigits({ value, className }: { value: number; className?: string }) {
  const calm = useCalmMotion();
  const text = String(Math.max(0, Math.round(value)));
  // 0 before mount (rest on the middle copy of the strip), then 1 (third copy) to spin.
  const [lap, setLap] = useState(0);
  useEffect(() => {
    if (calm) return;
    const frame = requestAnimationFrame(() => setLap(1));
    return () => cancelAnimationFrame(frame);
  }, [calm]);

  return (
    <span className={cn("inline-flex tabular-nums", className)}>
      <span className="sr-only">{text}</span>
      {text.split("").map((char, index, all) => {
        const digit = Number(char);
        // Keyed from the right, so "10" → "9" keeps the units reel rolling.
        const key = all.length - index;
        return (
          <span key={key} aria-hidden className="relative inline-block h-[1em] overflow-hidden leading-none">
            <span className="invisible">{char}</span>
            <motion.span
              className="absolute inset-x-0 top-0 flex flex-col items-center"
              initial={false}
              animate={{ y: `${-(digit + 10 + lap * 10)}em` }}
              transition={calm ? { duration: 0 } : { type: "spring", stiffness: 70, damping: 16, mass: 1, delay: lap ? index * 0.09 : 0 }}
            >
              {STRIP.map((n, i) => (
                <span key={i} className="block h-[1em] leading-none">
                  {n}
                </span>
              ))}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}
