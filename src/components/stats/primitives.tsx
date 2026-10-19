"use client";

/**
 * Shared building blocks for the stats bento.
 *
 * Kept in one file because each piece is small and they only make sense
 * together: the card shell every chart sits in, the count-up figure, the
 * "not enough data yet" state, and the interaction/motion hooks the charts use
 * so hover, focus and tap all behave identically everywhere.
 */

import Link from "next/link";
import { animate, useInView, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Lock } from "lucide-react";
import { usePreferences } from "@/lib/preferences/PreferencesProvider";
import { cn } from "@/lib/utils/cn";

/* ---------------------------------------------------------------------------
 * Palette
 * ------------------------------------------------------------------------ */

/**
 * Categorical series colours, validated for the dark (#1c1c1e) and light
 * (#ffffff) panels: every slot sits in the lightness band, clears 3:1 on dark,
 * and adjacent slots stay apart under protan/deutan/tritan simulation. The
 * site's own accent tokens are tuned for text and glow, and four of them are
 * too bright to separate as fills, so charts get their own stepped set (slot
 * 1 is still the brand violet). On light, three slots dip below 3:1 — every
 * chart therefore also carries direct labels and a table alternative.
 *
 * Order is fixed and colour follows the entity, never its rank.
 */
const VIZ_STYLES = `
.stats-viz {
  --viz-1: #8a72ff; --viz-2: #d95926; --viz-3: #199e70;
  --viz-4: #c98500; --viz-5: #d55181; --viz-6: #3987e5;
  --viz-other: #636366;
  --viz-surface: #1c1c1e;
}
:root[data-theme="light"] .stats-viz {
  --viz-1: #6a4dff; --viz-2: #eb6834; --viz-3: #1baf7a;
  --viz-4: #eda100; --viz-5: #e87ba4; --viz-6: #2a78d6;
  --viz-other: #aeaeb2;
  --viz-surface: #ffffff;
}`;

export function VizStyles() {
  return <style>{VIZ_STYLES}</style>;
}

export const SERIES_COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)"];
export const OTHER_COLOR = "var(--viz-other)";

export function seriesColor(index: number, key?: string): string {
  if (key === "other") return OTHER_COLOR;
  return SERIES_COLORS[index] ?? OTHER_COLOR;
}

/* ---------------------------------------------------------------------------
 * Motion
 * ------------------------------------------------------------------------ */

/**
 * The OS setting *or* the in-app opt-out from Settings. `useReducedMotion`
 * alone only sees the former, and a chart that keeps drawing itself in after
 * someone switched motion off in our own settings reads as a bug.
 */
export function useChartMotion(): boolean {
  const reduced = useReducedMotion();
  const { reduceMotion } = usePreferences();
  return !reduced && !reduceMotion;
}

/** Shared easing for every draw-in, matching `--ease-out-expo`. */
export const DRAW_EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Charts always start from their "undrawn" state, on the server and the
 * client alike, so hydration matches whatever the reader's motion setting
 * (which the server can't know). Reduced motion then simply jumps to the
 * drawn state instead of animating to it.
 */
export function drawTransition(motionOn: boolean, transition: { duration: number; delay?: number; ease?: typeof DRAW_EASE }) {
  return motionOn ? transition : { duration: 0 };
}

/* ---------------------------------------------------------------------------
 * Count-up
 * ------------------------------------------------------------------------ */

/**
 * A number that counts up the first time it scrolls into view.
 *
 * The final value is what renders first (and what assistive tech reads, via
 * the visually-hidden copy), so a reduced-motion reader, a screenshot and a
 * screen reader all get the real figure immediately. The animation writes to
 * the DOM node directly rather than through state: sixty re-renders a second
 * per figure across a dozen figures is pointless work.
 */
export function CountUp({
  value,
  format = (n: number) => Math.round(n).toLocaleString("en"),
  duration = 1.1,
  className,
}: {
  value: number;
  format?: (value: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const motionOn = useChartMotion();
  const formatRef = useRef(format);
  useLayoutEffect(() => {
    formatRef.current = format;
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!inView || !motionOn) {
      node.textContent = formatRef.current(value);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: DRAW_EASE,
      onUpdate: (latest) => {
        node.textContent = formatRef.current(latest);
      },
    });
    return () => controls.stop();
  }, [inView, motionOn, value, duration]);

  return (
    <span className={className}>
      <span ref={ref} aria-hidden>{format(value)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

export const formatHours = (hours: number) => `${Math.round(hours).toLocaleString("en")}h`;
export const formatPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/* ---------------------------------------------------------------------------
 * Interaction
 * ------------------------------------------------------------------------ */

/**
 * One selection model for every chart: a mouse hovers, a finger taps (and taps
 * again to dismiss), a keyboard focuses. Hover clears on leave; a tap sticks,
 * because on a phone there is no "leave" — the readout must stay put while
 * the reader looks at it.
 */
export function useActiveMark<T extends string | number>() {
  const [active, setActive] = useState<T | null>(null);
  const pinned = useRef(false);

  const markProps = useCallback(
    (id: T, label: string) => ({
      tabIndex: 0,
      role: "button" as const,
      "aria-label": label,
      "aria-pressed": active === id,
      onPointerEnter: (event: PointerEvent) => {
        if (event.pointerType === "mouse" && !pinned.current) setActive(id);
      },
      onPointerLeave: (event: PointerEvent) => {
        if (event.pointerType === "mouse" && !pinned.current) setActive(null);
      },
      onClick: () => {
        // Decided outside a state updater on purpose: updaters run twice in
        // Strict Mode, and toggling the ref inside one undid every tap.
        const next = active === id && pinned.current ? null : id;
        pinned.current = next !== null;
        setActive(next);
      },
      onFocus: () => {
        if (!pinned.current) setActive(id);
      },
      onBlur: () => {
        if (!pinned.current) setActive(null);
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          pinned.current = false;
          setActive(null);
        }
      },
    }),
    [active],
  );

  const clear = useCallback(() => {
    pinned.current = false;
    setActive(null);
  }, []);

  return { active, setActive, markProps, clear };
}

/** Tracks an element's content width, so SVG can be drawn at true pixel size. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/* ---------------------------------------------------------------------------
 * Card shell
 * ------------------------------------------------------------------------ */

export function StatCard({
  title,
  icon,
  summary,
  footnote,
  className,
  children,
  action,
}: {
  title: string;
  icon?: ReactNode;
  /** Plain-language description of what the chart shows, for screen readers. */
  summary?: string;
  footnote?: ReactNode;
  className?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={cn("glass relative flex min-w-0 flex-col rounded-[1.75rem] p-5 sm:p-6", className)}>
      <header className="flex items-start justify-between gap-3">
        {/* One plain title per card — no eyebrow restating it. */}
        <h3 className="flex min-w-0 items-center gap-2 font-display text-[17px] font-bold leading-tight sm:text-xl">
          {icon && <span className="shrink-0 text-brand-soft" aria-hidden>{icon}</span>}
          {title}
        </h3>
        {action}
      </header>
      {summary && <p className="sr-only">{summary}</p>}
      <div className="mt-4 flex min-w-0 flex-1 flex-col">{children}</div>
      {footnote && <p className="mt-4 border-t border-line pt-3 text-[12px] leading-relaxed text-faint">{footnote}</p>}
    </section>
  );
}

/**
 * The low-data state. Says exactly what unlocks the chart and how far along
 * the reader already is, instead of drawing a confident shape from two points.
 */
export function LockedState({
  message,
  detail,
  progress,
  href = "/browse",
  cta = "Find games to track",
}: {
  message: string;
  detail?: string;
  /** 0–1 progress towards unlocking. */
  progress?: number;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line px-5 py-8 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-fg/[0.06] text-muted" aria-hidden>
        <Lock size={16} />
      </span>
      <p className="max-w-xs text-sm font-semibold leading-snug">{message}</p>
      {detail && <p className="max-w-xs text-xs leading-relaxed text-muted">{detail}</p>}
      {progress !== undefined && (
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-fg/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Progress towards unlocking">
          <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(4, Math.min(100, progress * 100))}%` }} />
        </div>
      )}
      <Link href={href} className="press text-xs font-semibold text-brand-soft hover:underline">{cta}</Link>
    </div>
  );
}

/** Colour key for legends and readouts. Rect for areas/bars, as the marks are. */
export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]", className)} style={{ background: color }} />;
}

/** The value-first readout row used in every chart's selection header. */
export function Readout({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-h-[3.25rem] rounded-2xl bg-fg/[0.04] px-3.5 py-2.5", className)} aria-live="polite">
      {children}
    </div>
  );
}
