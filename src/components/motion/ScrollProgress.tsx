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
          // Game pages swap in their cover's accent (globals.css, `--progress-*`).
          "linear-gradient(90deg, var(--progress-from, var(--color-brand)), var(--progress-via, var(--color-neon)) 55%, var(--progress-to, var(--color-flare)))",
      }}
    />
  );
}
