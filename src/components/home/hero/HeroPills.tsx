"use client";

import { motion, type MotionValue } from "motion/react";
import { cn } from "@/lib/utils/cn";

/**
 * Apple-style page indicator: dots, with the current one stretched into a
 * capsule that fills over the slide's lifetime.
 *
 * The fill is a `scaleX` bound straight to the clock's motion value, so it
 * advances on the compositor without re-rendering anything, and it freezes
 * mid-fill when the clock does — the reader can see the carousel is waiting
 * for them. With no clock (calm motion) the current capsule is simply full.
 */
export function HeroPills({
  names,
  index,
  progress,
  accent,
  onSelect,
}: {
  names: string[];
  index: number;
  progress: MotionValue<number> | null;
  accent: string;
  onSelect: (index: number) => void;
}) {
  if (names.length <= 1) return null;

  return (
    <div className="flex items-center" role="group" aria-label="Choose a featured game">
      {names.map((name, i) => {
        const active = i === index;
        return (
          <button
            key={`${name}-${i}`}
            type="button"
            onClick={() => onSelect(i)}
            aria-label={`Show ${name}, ${i + 1} of ${names.length}`}
            aria-current={active ? "true" : undefined}
            // The visible mark is tiny; the button around it is a full touch target.
            className="group grid h-8 place-items-center px-[5px] coarse:h-11 coarse:px-[6px]"
          >
            <span
              className={cn(
                "relative block h-[7px] overflow-hidden rounded-full transition-[width,background-color] duration-500 ease-[var(--ease-apple)]",
                active ? "w-9 bg-white/25" : "w-[7px] bg-white/40 group-hover:bg-white/70",
              )}
            >
              {active && (
                <motion.span
                  className="absolute inset-0 origin-left rounded-full"
                  style={{ scaleX: progress ?? 1, backgroundColor: accent }}
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
