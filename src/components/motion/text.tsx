"use client";

/**
 * Typography animations.
 *
 * `TextReveal` splits on words rather than characters. Character splitting
 * looks impressive on a headline and destroys screen-reader output and text
 * selection everywhere else — so the visible text is split, and the original
 * string is kept in an `sr-only` sibling for assistive tech.
 */

import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { compactNumber } from "@/lib/utils/format";

interface TextRevealProps {
  text: string;
  className?: string;
  delay?: number;
  /** Seconds between words. */
  gap?: number;
  once?: boolean;
  as?: "h1" | "h2" | "h3" | "p" | "span";
}

export function TextReveal({
  text,
  className,
  delay = 0,
  gap = 0.045,
  once = true,
  as: Tag = "span",
}: TextRevealProps) {
  const reduced = useReducedMotion();
  const words = text.split(" ");

  if (reduced) {
    return <Tag className={className}>{text}</Tag>;
  }

  return (
    <Tag className={className}>
      <span className="sr-only">{text}</span>
      <motion.span
        aria-hidden
        className="inline"
        initial="hidden"
        whileInView="visible"
        viewport={{ once, amount: 0.4 }}
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: gap, delayChildren: delay } },
        }}
      >
        {words.map((word, i) => (
          // Each word gets a clipping mask so it slides up from behind a line.
          <span key={`${word}-${i}`} className="inline-block overflow-hidden align-bottom">
            <motion.span
              className="inline-block"
              variants={{
                hidden: { y: "110%", opacity: 0 },
                visible: {
                  y: "0%",
                  opacity: 1,
                  transition: { duration: 0.75, ease: [0.16, 1, 0.3, 1] },
                },
              }}
            >
              {word}
              {i < words.length - 1 ? " " : ""}
            </motion.span>
          </span>
        ))}
      </motion.span>
    </Tag>
  );
}

/* -------------------------------------------------------------------------- */

interface CountUpProps {
  value: number;
  className?: string;
  duration?: number;
  /** Renders 12400 as "12.4K". */
  compact?: boolean;
  decimals?: number;
  suffix?: string;
  prefix?: string;
}

/** Animates a number up from zero the first time it scrolls into view. */
export function CountUp({
  value,
  className,
  duration = 1.6,
  compact = false,
  decimals = 0,
  suffix = "",
  prefix = "",
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduced = useReducedMotion();
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      // Jump straight to the value, but after hydration: the server can't know
      // the motion setting and renders 0, so rendering `value` on the client's
      // first pass would be a hydration mismatch.
      const frame = requestAnimationFrame(() => setAnimated(value));
      return () => cancelAnimationFrame(frame);
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setAnimated(v),
    });
    return () => controls.stop();
  }, [inView, value, duration, reduced]);

  // Reduced motion skips the tween entirely rather than running it instantly.
  const display = animated;

  const formatted = compact
    ? compactNumber(display)
    : display.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
