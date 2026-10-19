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
 *
 * Two ways to drive it, by input:
 *  - Pointer: each dot is its own button (jump straight to any slide).
 *  - Touch: six 44px targets don't fit beside the mute and pause controls on
 *    a phone, and 19px-wide ones are too small to hit. So, like iOS's page
 *    control, the whole indicator is one adjustable control at least 44px
 *    tall: tap right of the current dot for the next slide, left for the
 *    previous; assistive tech gets a slider it can increment and decrement.
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
  const count = names.length;

  const dots = (interactive: boolean) =>
    names.map((name, i) => {
      const active = i === index;
      const mark = (
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
      );
      return interactive ? (
        <button
          key={`${name}-${i}`}
          type="button"
          onClick={() => onSelect(i)}
          aria-label={`Show ${name}, ${i + 1} of ${count}`}
          aria-current={active ? "true" : undefined}
          className="group grid h-8 place-items-center px-[5px]"
        >
          {mark}
        </button>
      ) : (
        <span key={`${name}-${i}`} data-dot={i} className="grid h-11 place-items-center px-[6px]">
          {mark}
        </span>
      );
    });

  const step = (direction: 1 | -1) => onSelect((index + direction + count) % count);

  return (
    <>
      <div className="flex items-center coarse:hidden" role="group" aria-label="Choose a featured game">
        {dots(true)}
      </div>

      <div
        role="slider"
        tabIndex={0}
        aria-label="Featured game"
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={index + 1}
        aria-valuetext={`${names[index]}, ${index + 1} of ${count}`}
        className="hidden min-h-11 min-w-11 cursor-pointer items-center rounded-full coarse:flex"
        onClick={(event) => {
          // Which side of the current dot was tapped decides the direction.
          const current = event.currentTarget.querySelector<HTMLElement>(`[data-dot="${index}"]`);
          const rect = current?.getBoundingClientRect();
          if (!rect) return step(1);
          step(event.clientX >= rect.left + rect.width / 2 ? 1 : -1);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            step(1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            step(-1);
          }
        }}
      >
        {dots(false)}
      </div>
    </>
  );
}
