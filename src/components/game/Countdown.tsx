"use client";

/**
 * Live release countdown.
 *
 * Renders nothing on the server and during the first client paint — the value
 * is time-dependent, so any server-rendered figure would be wrong by the time
 * it reached the browser and would trip a hydration mismatch. A fixed-height
 * placeholder holds the layout so nothing shifts when it appears.
 *
 * Three presentations:
 *  - more than a day out: day / hour / minute / second tiles;
 *  - the final 24 hours (large size only): a split-flap clock, each digit
 *    flipping on its own as it changes — the moment deserves the ceremony;
 *  - at zero: "Out now", and with `celebrate`, one confetti burst (also when
 *    the reader opens the page within an hour of launch).
 *
 * Colours come from theme tokens, so it reads on light and dark surfaces;
 * `tone="onImage"` is for the rare caller that floats it over artwork.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useCountdown } from "@/hooks";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { fireConfetti } from "@/components/game/detail/confetti";
import { cn } from "@/lib/utils/cn";
import { parseISO } from "@/lib/utils/format";

interface CountdownProps {
  date: string | null;
  className?: string;
  size?: "sm" | "lg";
  /** `onImage` forces white-on-glass for use over artwork. */
  tone?: "default" | "onImage";
  /** Fire confetti once when it reaches zero (or was just reached). */
  celebrate?: boolean;
}

const pad = (value: number) => String(value).padStart(2, "0");
const CELEBRATION_WINDOW_MS = 3_600_000;

export function Countdown({ date, className, size = "lg", tone = "default", celebrate = false }: CountdownProps) {
  const parts = useCountdown(date);
  const calm = useCalmMotion();
  const root = useRef<HTMLDivElement>(null);
  const sawRunning = useRef(false);
  const done = parts?.done ?? null;

  useEffect(() => {
    if (done === null) return;
    if (!done) {
      sawRunning.current = true;
      return;
    }
    if (!celebrate || calm || !date) return;
    const target = parseISO(date)?.getTime() ?? 0;
    const fresh = sawRunning.current || Date.now() - target < CELEBRATION_WINDOW_MS;
    if (!fresh) return;

    // Once per launch per tab: a reload or a revisit shouldn't re-throw it.
    const key = `ag:confetti:${date}:${window.location.pathname}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Storage blocked: still celebrate, just without the once-only guard.
    }

    const rect = root.current?.getBoundingClientRect();
    const accent = root.current ? getComputedStyle(root.current).getPropertyValue("--game-accent").trim() : "";
    fireConfetti({
      origin: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined,
      colours: [accent || "#8a72ff", "#ffd60a", "#30d158", "#64d2ff", "#ff375f", "#ffffff"],
    });
  }, [done, celebrate, calm, date]);

  if (!date) return null;

  if (!parts) {
    return <div className={cn(size === "lg" ? "h-[76px]" : "h-11", className)} aria-hidden />;
  }

  if (parts.done) {
    return (
      <div ref={root} className={cn("flex w-fit", className)}>
        <p
          className={cn(
            "inline-flex items-center gap-2 rounded-full border border-mint/30 bg-mint/12 font-semibold text-mint",
            size === "lg" ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs",
          )}
        >
          <span aria-hidden className="relative flex h-2 w-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-mint/60" />
            <span className="relative h-2 w-2 rounded-full bg-mint" />
          </span>
          Out now
        </p>
      </div>
    );
  }

  if (size === "lg" && parts.days === 0) {
    return (
      <div ref={root} className={className}>
        <FlipClock hours={parts.hours} minutes={parts.minutes} seconds={parts.seconds} calm={calm} tone={tone} />
      </div>
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
      ref={root}
      className={cn("flex items-stretch gap-2 sm:gap-2.5", className)}
      role="timer"
      aria-label={`${parts.days} days until release`}
    >
      {units.map((unit) => (
        <div
          key={unit.label}
          className={cn(
            "flex flex-col items-center justify-center rounded-xl border",
            tone === "onImage"
              ? "border-white/15 bg-white/10 backdrop-blur-md"
              : "border-fg/10 bg-fg/[0.06] shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--color-fg)_8%,transparent)]",
            size === "lg" ? "min-w-[62px] px-3 py-2.5 sm:min-w-[70px]" : "min-w-[46px] px-2 py-1.5",
          )}
        >
          <span
            className={cn(
              "font-display font-bold tabular-nums leading-none",
              tone === "onImage" ? "text-white" : "text-text",
              size === "lg" ? "text-2xl sm:text-[28px]" : "text-base",
            )}
          >
            {/* Only the changing digit group re-animates. */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={unit.value}
                initial={calm ? false : { y: "-60%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                exit={calm ? { opacity: 0, transition: { duration: 0 } } : { y: "60%", opacity: 0 }}
                transition={{ duration: calm ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="inline-block"
              >
                {pad(unit.value)}
              </motion.span>
            </AnimatePresence>
          </span>
          <span
            className={cn(
              "mt-1 font-medium uppercase tracking-[0.07em]",
              tone === "onImage" ? "text-white/60" : "text-faint",
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

/* -------------------------------------------------------------------------- */

/**
 * Split-flap clock for the last 24 hours.
 *
 * Each digit is a card cut along its middle. On a change, the old top half
 * folds down over the hinge (0° → −90°) and then the new bottom half falls
 * into place (90° → 0°) — the two-stage motion of a real Solari board. The
 * static halves underneath show new-top / old-bottom, so at every instant of
 * the fold the card reads correctly.
 */
function FlipClock({
  hours,
  minutes,
  seconds,
  calm,
  tone,
}: {
  hours: number;
  minutes: number;
  seconds: number;
  calm: boolean;
  tone: "default" | "onImage";
}) {
  const groups = [
    { value: pad(hours), label: "Hours" },
    { value: pad(minutes), label: "Minutes" },
    { value: pad(seconds), label: "Seconds" },
  ];

  return (
    <div
      role="timer"
      aria-label={`${hours} hours, ${minutes} minutes until release`}
      className="inline-flex flex-col gap-2"
    >
      <p className={cn("flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]", tone === "onImage" ? "text-white/70" : "text-muted")}>
        <span aria-hidden className="relative flex h-1.5 w-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--game-accent,var(--color-brand-soft))] opacity-70" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--game-accent,var(--color-brand-soft))]" />
        </span>
        Launching in
      </p>
      <div className="flex items-start gap-1.5 sm:gap-2" aria-hidden>
        {groups.map((group, index) => (
          <div key={group.label} className="flex items-start gap-1.5 sm:gap-2">
            {index > 0 && (
              <span className={cn("flex h-[60px] flex-col justify-center gap-2.5 sm:h-[76px]", tone === "onImage" ? "text-white/50" : "text-faint")}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              </span>
            )}
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex gap-1 sm:gap-1.5">
                <FlipDigit digit={group.value[0]} calm={calm} tone={tone} />
                <FlipDigit digit={group.value[1]} calm={calm} tone={tone} />
              </div>
              <span className={cn("text-[9px] font-semibold uppercase tracking-[0.1em]", tone === "onImage" ? "text-white/55" : "text-faint")}>
                {group.label}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const CARD =
  "relative h-[60px] w-[42px] sm:h-[76px] sm:w-[54px] [perspective:400px]";

function FlipDigit({ digit, calm, tone }: { digit: string; calm: boolean; tone: "default" | "onImage" }) {
  // Derived state, updated during render: React's documented pattern for
  // "remember the previous prop". The pair drives which halves are folding.
  const [pair, setPair] = useState({ current: digit, previous: digit });
  if (pair.current !== digit) setPair({ current: digit, previous: pair.current });

  const flipping = !calm && pair.previous !== pair.current;
  const face = cn(
    "absolute inset-x-0 overflow-hidden [backface-visibility:hidden]",
    tone === "onImage"
      ? "bg-[linear-gradient(180deg,#2a2a30,#1a1a1f)] text-white"
      : "bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-panel-2)_92%,var(--color-fg)),var(--color-panel))] text-text",
  );

  return (
    <div className={cn(CARD, "rounded-[10px] shadow-[0_12px_28px_-14px_rgba(0,0,0,0.75),inset_0_0_0_1px_color-mix(in_oklab,var(--color-fg)_10%,transparent)]")}>
      <Half face={face} half="top" digit={pair.current} />
      <Half face={face} half="bottom" digit={flipping ? pair.previous : pair.current} />
      {flipping && (
        <>
          <motion.div
            key={`top-${pair.current}`}
            className="absolute inset-0 [transform-style:preserve-3d]"
            initial={{ rotateX: 0 }}
            animate={{ rotateX: -90 }}
            transition={{ duration: 0.26, ease: [0.55, 0, 0.9, 0.4] }}
            style={{ transformOrigin: "50% 50%" }}
          >
            <Half face={face} half="top" digit={pair.previous} shade />
          </motion.div>
          <motion.div
            key={`bottom-${pair.current}`}
            className="absolute inset-0 [transform-style:preserve-3d]"
            initial={{ rotateX: 90 }}
            animate={{ rotateX: 0 }}
            transition={{ duration: 0.3, delay: 0.24, ease: [0.2, 0.7, 0.3, 1] }}
            style={{ transformOrigin: "50% 50%" }}
          >
            <Half face={face} half="bottom" digit={pair.current} />
          </motion.div>
        </>
      )}
      {/* The hinge: a hairline seam plus the two pivot notches. */}
      <span aria-hidden className="absolute inset-x-0 top-1/2 z-10 h-px -translate-y-1/2 bg-black/45" />
      <span aria-hidden className="absolute -left-px top-1/2 z-10 h-2 w-[3px] -translate-y-1/2 rounded-r-sm bg-black/40" />
      <span aria-hidden className="absolute -right-px top-1/2 z-10 h-2 w-[3px] -translate-y-1/2 rounded-l-sm bg-black/40" />
    </div>
  );
}

function Half({ face, half, digit, shade = false }: { face: string; half: "top" | "bottom"; digit: string; shade?: boolean }) {
  return (
    <div
      className={cn(
        face,
        half === "top" ? "top-0 h-1/2 rounded-t-[10px]" : "bottom-0 h-1/2 rounded-b-[10px]",
      )}
    >
      <span
        className={cn(
          "absolute inset-x-0 flex h-[200%] items-center justify-center font-display text-[34px] font-bold leading-none tabular-nums sm:text-[44px]",
          half === "top" ? "top-0" : "bottom-0",
        )}
      >
        {digit}
      </span>
      {shade && <span aria-hidden className="absolute inset-0 bg-gradient-to-b from-transparent to-black/25" />}
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
      {pad(parts.hours)}:{pad(parts.minutes)}:{pad(parts.seconds)}
    </span>
  );
}
