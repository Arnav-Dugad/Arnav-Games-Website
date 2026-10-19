"use client";

/**
 * Pointer- and scroll-driven effects.
 *
 * Everything here degrades to a static wrapper on touch devices or under
 * `prefers-reduced-motion`, so the same JSX is correct on every target.
 */

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useRef, type ReactNode } from "react";
// Hydration-safe (false while hydrating) — Marquee and Parallax render
// different markup when motion is reduced.
import { usePrefersReducedMotion as useReducedMotion, useRichMotion } from "@/hooks";
import { cn } from "@/lib/utils/cn";

/* ---------------------------------------------------------------------------
 * Magnetic — element drifts toward the cursor as it approaches
 * ------------------------------------------------------------------------ */

interface MagneticProps {
  children: ReactNode;
  className?: string;
  /** How far the element travels, as a fraction of pointer offset. */
  strength?: number;
  as?: "div" | "span";
}

export function Magnetic({ children, className, strength = 0.35, as = "div" }: MagneticProps) {
  const enabled = useRichMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.5 });
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.5 });

  const Component = as === "span" ? motion.span : motion.div;

  if (!enabled) {
    const Plain = as === "span" ? "span" : "div";
    return <Plain className={className}>{children}</Plain>;
  }

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    x.set((event.clientX - (rect.left + rect.width / 2)) * strength);
    y.set((event.clientY - (rect.top + rect.height / 2)) * strength);
  };

  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <Component
      ref={ref as React.Ref<HTMLDivElement & HTMLSpanElement>}
      onPointerMove={handleMove}
      onPointerLeave={reset}
      style={{ x, y }}
      className={cn("inline-flex will-change-transform", className)}
    >
      {children}
    </Component>
  );
}

/* ---------------------------------------------------------------------------
 * Spotlight — soft light that follows the cursor across a panel
 * ------------------------------------------------------------------------ */

interface SpotlightProps {
  children: ReactNode;
  className?: string;
  radius?: number;
  color?: string;
}

export function Spotlight({
  children,
  className,
  radius = 380,
  color = "rgba(124,92,255,0.16)",
}: SpotlightProps) {
  const enabled = useRichMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(-9999);
  const y = useMotionValue(-9999);
  const opacity = useSpring(useMotionValue(0), { stiffness: 200, damping: 30 });
  const background = useMotionTemplate`radial-gradient(${radius}px circle at ${x}px ${y}px, ${color}, transparent 70%)`;

  if (!enabled) {
    return <div className={cn("relative", className)}>{children}</div>;
  }

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
  };

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerEnter={() => opacity.set(1)}
      onPointerLeave={() => opacity.set(0)}
      className={cn("relative", className)}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 rounded-[inherit]"
        style={{ background, opacity }}
      />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Marquee — seamless infinite ticker
 * ------------------------------------------------------------------------ */

interface MarqueeProps {
  children: ReactNode;
  className?: string;
  /** Seconds for one full pass. */
  speed?: number;
  reverse?: boolean;
  pauseOnHover?: boolean;
}

/**
 * Children are rendered twice and the track is translated by exactly -50%, so
 * the loop point is invisible. Driven by a CSS animation rather than JS: this
 * runs for the whole session and must not occupy the main thread.
 */
export function Marquee({
  children,
  className,
  speed = 38,
  reverse = false,
  pauseOnHover = true,
}: MarqueeProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      // Items keep their natural width: a scrolling row must never squeeze
      // its pills into wrapped, multi-line lozenges.
      <div className={cn("rail-gutter flex gap-4 overflow-x-auto no-scrollbar *:shrink-0 *:whitespace-nowrap", className)}>
        {children}
      </div>
    );
  }

  return (
    <div className={cn("group relative overflow-hidden", className)}>
      <div
        className={cn(
          "flex w-max animate-[marquee-x_var(--marquee-duration)_linear_infinite] gap-4",
          pauseOnHover && "fine:group-hover:[animation-play-state:paused]",
        )}
        style={
          {
            "--marquee-duration": `${speed}s`,
            animationDirection: reverse ? "reverse" : "normal",
          } as React.CSSProperties
        }
      >
        <div className="flex shrink-0 gap-4">{children}</div>
        <div className="flex shrink-0 gap-4" aria-hidden inert>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Parallax — depth on scroll
 * ------------------------------------------------------------------------ */

interface ParallaxProps {
  children: ReactNode;
  className?: string;
  /** Pixels of travel across the full scroll pass. Negative moves against scroll. */
  distance?: number;
  scale?: boolean;
}

export function Parallax({ children, className, distance = 80, scale = false }: ParallaxProps) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  const s = useTransform(scrollYProgress, [0, 0.5, 1], [1.08, 1.16, 1.08]);
  const smoothY = useSpring(y, { stiffness: 90, damping: 24, mass: 0.4 });

  if (reduced) {
    return (
      // Positioned like the animated branch, so `fill` images inside still
      // have a containing block.
      <div ref={ref} className={cn("relative", className)}>
        {children}
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <motion.div style={{ y: smoothY, scale: scale ? s : 1 }} className="h-full w-full will-change-transform">
        {children}
      </motion.div>
    </div>
  );
}
