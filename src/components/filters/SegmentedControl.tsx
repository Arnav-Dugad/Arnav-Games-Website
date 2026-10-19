"use client";

/**
 * iOS-style segmented control with a sliding selection.
 *
 * One component, two behaviours by width:
 *  - from `sm` up the segments share the track equally, like UISegmentedControl
 *  - on a phone they become a sideways-scrolling row of pills running off the
 *    screen edge, so five labelled segments never get squeezed into
 *    unreadable 60px slivers — the thumb still slides between them
 *
 * The thumb is a shared-layout element, so it glides between segments rather
 * than blinking. Segments can be links (for server-rendered pages where the
 * choice lives in the URL) or buttons (for local state). For links the thumb
 * moves optimistically on tap — the server render that follows can take a
 * moment, and a control that waits for it feels broken.
 */

import Link from "next/link";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Short form for phones, when the full label is long. */
  shortLabel?: string;
  icon?: ReactNode;
  /** Real counts only. */
  count?: number;
  /** Link segments navigate instead of calling `onChange`. */
  href?: string;
  /** Tooltip / accessible description. */
  title?: string;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  className,
  fill = true,
}: {
  segments: Segment<T>[];
  value: T;
  onChange?: (value: T) => void;
  label: string;
  className?: string;
  /** Stretch segments to equal widths from `sm` up. */
  fill?: boolean;
}) {
  const reduced = useReducedMotion();
  const groupId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const isNav = segments.some((segment) => segment.href);

  // Optimistic selection for link segments; resets once the URL catches up.
  const [optimistic, setOptimistic] = useState<T | null>(null);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setOptimistic(null);
  }
  const shown = optimistic ?? value;

  // Keep the selection visible in the scrolling (phone) layout. Scrolls the
  // track only — `scrollIntoView` would also drag the page vertically.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || track.scrollWidth <= track.clientWidth) return;
    const item = track.querySelector<HTMLElement>("[data-selected='true']");
    if (!item) return;
    const target = item.offsetLeft - (track.clientWidth - item.offsetWidth) / 2;
    track.scrollTo({ left: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }, [shown, reduced]);

  const spring = reduced
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 520, damping: 42, mass: 0.8 };

  const Wrapper = isNav ? "nav" : "div";

  return (
    <LayoutGroup id={groupId}>
      <Wrapper
        aria-label={label}
        role={isNav ? undefined : "group"}
        className={cn("min-w-0", className)}
      >
        <div
          ref={trackRef}
          className={cn(
            "no-scrollbar relative flex overflow-x-auto rounded-full border border-fg/[0.08] bg-fg/[0.06] p-1 shadow-[inset_0_1px_2px_#00000040] sm:light:shadow-[inset_0_1px_2px_#0000000f]",
            // The light inset is `sm:`-scoped because `light:` outranks `max-sm:shadow-none`
            // in the cascade and drew a full-bleed hairline band behind the phone pills.
            // Phones: no enclosing track. A track that scrolls inside its own
            // rounded ends crops labels mid-word; separate pills running off
            // the screen edge read as "there's more" instead.
            "max-sm:-mx-4 max-sm:gap-2 max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:-my-2 max-sm:px-4 max-sm:py-2 max-sm:shadow-none",
            fill && "sm:overflow-visible",
          )}
        >
          {segments.map((segment) => {
            const selected = segment.value === shown;
            const content = (
              <>
                {selected && (
                  <motion.span
                    layoutId="segment-thumb"
                    transition={spring}
                    aria-hidden
                    className="absolute inset-0 rounded-full border border-fg/[0.1] bg-fg/[0.16] shadow-[0_3px_10px_-2px_#00000080,inset_0_1px_0_#ffffff1f] max-sm:shadow-[0_1px_4px_-1px_#00000059,inset_0_1px_0_#ffffff1f] light:border-fg/[0.06] light:bg-panel light:shadow-[0_2px_8px_-2px_#00000029]"
                  />
                )}
                <span className="relative flex items-center justify-center gap-1.5">
                  {segment.icon && (
                    <span className={cn("shrink-0", selected ? "text-brand-soft" : "text-faint")}>
                      {segment.icon}
                    </span>
                  )}
                  {segment.shortLabel ? (
                    <>
                      <span className="sm:hidden">{segment.shortLabel}</span>
                      <span className="hidden sm:inline">{segment.label}</span>
                    </>
                  ) : (
                    segment.label
                  )}
                  {segment.count !== undefined && (
                    <span className={cn("text-[11px] tabular-nums", selected ? "text-muted" : "text-faint")}>
                      {segment.count}
                    </span>
                  )}
                </span>
              </>
            );

            const classes = cn(
              "press relative flex min-h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium outline-offset-1 transition-colors duration-200 coarse:min-h-11 coarse:px-4 coarse:text-[14px]",
              fill && "sm:min-w-0 sm:flex-1",
              selected ? "text-text" : "text-muted fine:hover:text-text max-sm:border max-sm:border-fg/[0.08] max-sm:bg-fg/[0.05]",
            );

            if (segment.href) {
              return (
                <Link
                  key={segment.value}
                  href={segment.href}
                  scroll={false}
                  title={segment.title}
                  aria-current={selected ? "page" : undefined}
                  data-selected={selected}
                  onClick={() => setOptimistic(segment.value)}
                  className={classes}
                >
                  {content}
                </Link>
              );
            }

            return (
              <button
                key={segment.value}
                type="button"
                title={segment.title}
                aria-pressed={selected}
                data-selected={selected}
                onClick={() => onChange?.(segment.value)}
                className={classes}
              >
                {content}
              </button>
            );
          })}
        </div>
      </Wrapper>
    </LayoutGroup>
  );
}
