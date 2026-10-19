"use client";

/**
 * Live release countdown.
 *
 * Renders nothing on the server and during the first client paint — the value
 * is time-dependent, so any server-rendered figure would be wrong by the time
 * it reached the browser and would trip a hydration mismatch. A fixed-height
 * placeholder holds the layout so nothing shifts when it appears.
 */

import { AnimatePresence, motion } from "motion/react";
import { useCountdown } from "@/hooks";
import { cn } from "@/lib/utils/cn";

interface CountdownProps {
  date: string | null;
  className?: string;
  size?: "sm" | "lg";
}

export function Countdown({ date, className, size = "lg" }: CountdownProps) {
  const parts = useCountdown(date);

  if (!date) return null;

  if (!parts) {
    return <div className={cn(size === "lg" ? "h-[76px]" : "h-11", className)} aria-hidden />;
  }

  if (parts.done) {
    return (
      <p className={cn("text-sm font-semibold text-mint", className)}>Available now</p>
    );
  }

  const units = [
    { value: parts.days, label: "Days" },
    { value: parts.hours, label: "Hrs" },
    { value: parts.minutes, label: "Min" },
    { value: parts.seconds, label: "Sec" },
  ];

  return (
    <div
      className={cn("flex items-stretch gap-2 sm:gap-2.5", className)}
      role="timer"
      aria-label={`${parts.days} days until release`}
    >
      {units.map((unit) => (
        <div
          key={unit.label}
          className={cn(
            "glass flex flex-col items-center justify-center rounded-xl",
            size === "lg" ? "min-w-[62px] px-3 py-2.5 sm:min-w-[70px]" : "min-w-[46px] px-2 py-1.5",
          )}
        >
          <span
            className={cn(
              "font-display font-bold tabular-nums leading-none text-white",
              size === "lg" ? "text-2xl sm:text-[28px]" : "text-base",
            )}
          >
            {/* Only the changing digit group re-animates. */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={unit.value}
                initial={{ y: "-60%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                exit={{ y: "60%", opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="inline-block"
              >
                {String(unit.value).padStart(2, "0")}
              </motion.span>
            </AnimatePresence>
          </span>
          <span
            className={cn(
              "mt-1 font-medium uppercase tracking-[0.07em] text-faint",
              size === "lg" ? "text-[10px]" : "text-[8px]",
            )}
          >
            {unit.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One-line variant for dense list rows. */
export function CountdownInline({ date }: { date: string | null }) {
  const parts = useCountdown(date);
  if (!date || !parts) return null;
  if (parts.done) return <span className="text-mint">Out now</span>;
  if (parts.days > 0) return <span>{parts.days}d to go</span>;
  return (
    <span className="tabular-nums">
      {String(parts.hours).padStart(2, "0")}:{String(parts.minutes).padStart(2, "0")}:
      {String(parts.seconds).padStart(2, "0")}
    </span>
  );
}
