"use client";

/**
 * Scroll-triggered entrance. The workhorse of the site's motion language.
 *
 * The signature detail is the blur-to-sharp transition paired with the
 * translate — it reads as the content resolving into focus rather than merely
 * sliding, which is what separates it from a stock fade-in.
 */

import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";
// Hydration-safe: `false` on the server and the hydrating pass, so the
// server-rendered variants match, then the real setting on the next render.
// Motion's own `useReducedMotion` reads the media query during the first
// client render, which made every reveal a hydration mismatch for readers
// with reduced motion on.
import { usePrefersReducedMotion as useReducedMotion } from "@/hooks";

export type RevealDirection = "up" | "down" | "left" | "right" | "none";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Anchor target, e.g. for `#settings` deep links. */
  id?: string;
  delay?: number;
  duration?: number;
  direction?: RevealDirection;
  distance?: number;
  /** Adds the focus-pull. Disable for large images, where blur is expensive. */
  blur?: boolean;
  once?: boolean;
  /** Fraction of the element that must be visible before it fires. */
  amount?: number;
  as?: "div" | "section" | "li" | "article" | "header" | "span";
  /**
   * Animate on mount instead of on scroll.
   *
   * Scroll-triggered reveals assume the reader arrives from above. That breaks
   * for anything rendered *after* a navigation — a paginated list especially,
   * where the reader is already deep in the page when the new items mount. If
   * the observer never fires they stay at `opacity: 0` and the page looks
   * broken rather than merely un-animated. Mount-based reveal removes that
   * failure mode, so it is correct wherever content arrives from a click.
   */
  onMount?: boolean;
}

/*
 * When does "in view" fire?
 *
 * `amount` used to go straight to IntersectionObserver as a *fraction of the
 * element*. That can be unreachable: a 3000px genre grid at `amount: 0.15`
 * needs 450px of itself on screen at once, which a landscape phone (390px
 * tall), an iPhone SE, or anyone at 200% text size never has. The observer
 * never fired, and the whole section stayed at `opacity: 0` — a blank page
 * on exactly the small screens that need it most.
 *
 * Instead the element reveals once any of it crosses a line a little above
 * the bottom of the screen; `amount` sets how far above (0.25 → 10% of the
 * viewport). Small elements feel the same as before; tall ones can no
 * longer get stuck.
 */
function inView(once: boolean, amount: number) {
  const inset = Math.round(Math.min(Math.max(amount, 0), 1) * 40);
  return { once, amount: "some" as const, margin: `0px 0px -${inset}% 0px` as const };
}

function offset(direction: RevealDirection, distance: number) {
  switch (direction) {
    case "up":
      return { y: distance };
    case "down":
      return { y: -distance };
    case "left":
      return { x: distance };
    case "right":
      return { x: -distance };
    default:
      return {};
  }
}

export function Reveal({
  children,
  className,
  id,
  delay = 0,
  duration = 0.7,
  direction = "up",
  distance = 26,
  blur = true,
  once = true,
  amount = 0.25,
  as = "div",
  onMount = false,
}: RevealProps) {
  const reduced = useReducedMotion();
  const Component = motion[as];

  // Reduced motion still gets a fade so content doesn't pop in abruptly, but
  // nothing moves and nothing blurs.
  //
  // `visible` resets transform and filter explicitly. The server can't know
  // the reader's motion setting, so it renders the full-motion `hidden` style
  // (offset + blur) inline; if this variant only animated opacity, that
  // server-rendered blur would never be cleared and the content would stay
  // smeared for exactly the readers who asked for less motion.
  const variants: Variants = reduced
    ? {
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          x: 0,
          y: 0,
          filter: "blur(0px)",
          transition: { duration: 0.25, delay, x: { duration: 0 }, y: { duration: 0 }, filter: { duration: 0 } },
        },
      }
    : {
        hidden: {
          opacity: 0,
          ...offset(direction, distance),
          filter: blur ? "blur(10px)" : "blur(0px)",
        },
        visible: {
          opacity: 1,
          x: 0,
          y: 0,
          filter: "blur(0px)",
          transition: {
            duration,
            delay,
            ease: [0.16, 1, 0.3, 1],
          },
        },
      };

  if (onMount) {
    return (
      <Component id={id} className={className} variants={variants} initial="hidden" animate="visible">
        {children}
      </Component>
    );
  }

  return (
    <Component
      id={id}
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={inView(once, amount)}
    >
      {children}
    </Component>
  );
}

/* -------------------------------------------------------------------------- */

interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** Gap between children, in seconds. */
  gap?: number;
  delay?: number;
  once?: boolean;
  amount?: number;
  as?: "div" | "ul" | "section";
  /**
   * Animate on mount instead of on scroll.
   *
   * Scroll-triggered reveals assume the user arrives above the content. That
   * assumption breaks for anything rendered *after* a navigation — paginated
   * grids especially, where the reader is already deep in the page. If the
   * observer never fires, children stay at `opacity: 0` and the section looks
   * empty rather than merely un-animated. Mount-based reveal removes that
   * failure mode entirely, so it's the right choice wherever content arrives
   * in response to a click.
   */
  onMount?: boolean;
}

/**
 * Parent for `StaggerItem`. Orchestration lives on the container so items stay
 * plain and can be composed anywhere inside it.
 */
export function Stagger({
  children,
  className,
  gap = 0.07,
  delay = 0,
  once = true,
  amount = 0.15,
  as = "div",
  onMount = false,
}: StaggerProps) {
  const reduced = useReducedMotion();
  const Component = motion[as];

  const orchestration = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: reduced ? 0 : gap,
        delayChildren: delay,
      },
    },
  };

  if (onMount) {
    return (
      <Component className={className} initial="hidden" animate="visible" variants={orchestration}>
        {children}
      </Component>
    );
  }

  return (
    <Component
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={inView(once, amount)}
      variants={orchestration}
    >
      {children}
    </Component>
  );
}

export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 24, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

// Resets offset and blur explicitly for the same SSR reason as `Reveal`.
const staggerItemReduced: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.25, y: { duration: 0 }, filter: { duration: 0 } },
  },
};

export function StaggerItem({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "article";
}) {
  const reduced = useReducedMotion();
  const Component = motion[as];
  return (
    <Component className={className} variants={reduced ? staggerItemReduced : staggerItemVariants}>
      {children}
    </Component>
  );
}
