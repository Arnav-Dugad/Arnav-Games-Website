"use client";

/**
 * Long-form text that starts collapsed behind a "Read more" control.
 *
 * Provider descriptions range from two sentences to a full marketing page, so a
 * fixed clamp is the only way the detail page keeps a predictable shape. Three
 * details make it feel considered rather than truncated:
 *
 *  - The toggle only appears when the text genuinely overflows. Measuring the
 *    real scroll height avoids a "Read more" button that expands to nothing.
 *  - Collapsing animates to a measured pixel height rather than a guessed
 *    `max-height`, so the easing is linear in perceived distance instead of
 *    racing through empty space.
 *  - A gradient fade over the clipped edge signals there is more, which a hard
 *    cut does not.
 */

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface ExpandableTextProps {
  text: string;
  /** Collapsed height in rem. Roughly 1.75rem per line at this leading. */
  collapsedRem?: number;
  className?: string;
  paragraphClassName?: string;
}

export function ExpandableText({
  text,
  collapsedRem = 8.75,
  className,
  paragraphClassName,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [fullHeight, setFullHeight] = useState<number | null>(null);
  const [overflows, setOverflows] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);

  const measure = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const collapsedPx = collapsedRem * 16;
    setFullHeight(el.scrollHeight);
    // 8px of slack: a paragraph that overshoots the clamp by a couple of pixels
    // isn't worth a toggle.
    setOverflows(el.scrollHeight > collapsedPx + 8);
  }, [collapsedRem]);

  useEffect(() => {
    measure();
    const el = contentRef.current;
    if (!el) return;
    // Re-measure on reflow: font loading and viewport width both change how
    // many lines the same text occupies.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, text]);

  const collapsedHeight = `${collapsedRem}rem`;
  const showToggle = overflows;

  return (
    <div className={className}>
      <motion.div
        // Collapsed text fades out through a mask rather than a bg-coloured
        // overlay, so it dissolves into whatever is behind it (the moving
        // backdrop, a game's art light) instead of ending in a solid band.
        className={cn(
          "relative overflow-hidden",
          showToggle && !expanded && "[mask-image:linear-gradient(180deg,#000_calc(100%-5rem),transparent)]",
        )}
        initial={false}
        animate={{
          height: !showToggle || expanded ? (fullHeight ?? "auto") : collapsedHeight,
        }}
        transition={
          reduced ? { duration: 0 } : { duration: 0.45, ease: [0.16, 1, 0.3, 1] }
        }
        // Once open, drop the fixed height so later reflow isn't clipped.
        onAnimationComplete={() => {
          if (expanded && contentRef.current) contentRef.current.style.removeProperty("height");
        }}
      >
        <div ref={contentRef} className="space-y-4">
          {paragraphs.map((paragraph, i) => (
            <p key={i} className={paragraphClassName}>
              {paragraph}
            </p>
          ))}
        </div>

      </motion.div>

      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className={cn(
            "group mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line",
            "bg-fg/[0.04] px-4 text-[13px] font-semibold text-muted",
            "transition-colors duration-300 fine:hover:border-line-strong fine:hover:text-text",
          )}
        >
          {expanded ? "Show less" : "Read more"}
          <ChevronDown
            size={14}
            className={cn(
              "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
              expanded && "rotate-180",
            )}
          />
        </button>
      )}
    </div>
  );
}
