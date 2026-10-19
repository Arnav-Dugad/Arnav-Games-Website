"use client";

/**
 * Anchored popover that escapes its container.
 *
 * A normal absolutely-positioned dropdown is at the mercy of every ancestor:
 * one `overflow-hidden` clips it, one `isolate` traps its z-index. The game
 * hero has both — it needs `overflow-hidden` for the parallax backdrop — so an
 * in-flow dropdown opened from there was drawn *behind* the page content and
 * cut off at the hero's edge.
 *
 * Rendering into a portal at the document root sidesteps ancestor clipping
 * entirely. The trade is that position has to be computed rather than
 * inherited, so the anchor is measured on open and tracked while scrolling.
 */

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "@/hooks";
import { cn } from "@/lib/utils/cn";

const GAP = 8;
const MARGIN = 12;

interface Position {
  top: number;
  left: number;
  /** Actual rendered width after clamping to the viewport. */
  width: number;
  /** Set when the popover had to flip above the anchor to stay on screen. */
  above: boolean;
}

export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  width = 256,
  className,
  label,
  align = "start",
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  width?: number;
  className?: string;
  label?: string;
  /** Which anchor edge the panel lines up with. `end` suits right-aligned triggers. */
  align?: "start" | "end";
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 320;

    // Flip above the anchor when there isn't room below — on a phone the
    // ownership button often sits low in the viewport.
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < panelHeight + GAP + MARGIN && rect.top > panelHeight + GAP;

    /*
     * Clamp the width before positioning.
     *
     * A fixed pixel width wider than the viewport can't be rescued by shifting
     * `left` — it just overflows the right edge, and `html { overflow-x: clip }`
     * then truncates it silently instead of allowing a scroll. The 340px
     * subscription picker did exactly that below ~364px.
     */
    const clampedWidth = Math.min(width, window.innerWidth - MARGIN * 2);

    // Keep the panel inside the viewport horizontally rather than letting it
    // run off the right edge on narrow screens.
    const maxLeft = window.innerWidth - clampedWidth - MARGIN;
    const preferred = align === "end" ? rect.right - clampedWidth : rect.left;
    const left = Math.max(MARGIN, Math.min(preferred, maxLeft));

    setPosition({
      top: above ? rect.top - panelHeight - GAP : rect.bottom + GAP,
      left,
      width: clampedWidth,
      above,
    });
  }, [anchorRef, width, align]);

  // Layout effect so the first paint is already in the right place — a
  // measure-then-move would show the panel jumping.
  //
  // The stale position from a previous open is deliberately left alone rather
  // than cleared on close: this runs before paint, so reopening re-measures
  // before anything is drawn, and clearing it here would be a state write in an
  // effect body for no visible benefit.
  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const onScroll = () => place();
    // `true` captures scrolls on any ancestor, not just the window.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  useEscapeKey(onClose, open);

  // Outside-click has to account for the anchor too, or the trigger's own
  // click would close and immediately reopen the panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose, anchorRef]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label={label}
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          style={{
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            // The measured width, not the requested one — see `place()`.
            width: position?.width ?? width,
            // Hidden until measured, so it never flashes at the fallback spot.
            visibility: position ? "visible" : "hidden",
          }}
          className={cn(
            "material material-menu fixed z-[300] overflow-hidden rounded-[22px] p-1.5",
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
