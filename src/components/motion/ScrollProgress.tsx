"use client";

/**
 * Reading-progress bar pinned to the top of the viewport.
 *
 * `useScroll` reports 0→1 for the document; the spring keeps the bar from
 * snapping during momentum scrolling on trackpads and touch.
 */

import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const reduced = useReducedMotion();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 26,
    restDelta: 0.001,
  });

  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[160] h-[2px] origin-left opacity-80"
      style={{
        scaleX: reduced ? scrollYProgress : scaleX,
        background:
          "linear-gradient(90deg, var(--color-brand), var(--color-neon) 55%, var(--color-flare))",
      }}
    />
  );
}
