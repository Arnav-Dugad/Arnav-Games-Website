"use client";

/**
 * Arrow buttons for every horizontal scroller on the site, on desktop.
 *
 * A mouse has no sideways swipe, so a rail that only scrolls with a trackpad
 * or shift+wheel is effectively hidden content. Rather than threading arrows
 * through two dozen components, this one layer (mounted once in SiteChrome):
 *
 *  - recognises scrollers by the classes the site already uses for them
 *    (`.snap-rail`, `.overflow-x-auto`) or an explicit `data-scroll-x`;
 *  - follows the pointer and shows arrows only for the scroller under it, in
 *    a portal positioned over its edges (no DOM injected into React trees);
 *  - hides an arrow at that end, and scrolls by most of a viewport-width.
 *
 * Fine pointers only. Scrollers with their own arrows opt out with
 * `data-no-arrows` (e.g. GameRail). Arrows are a pointer convenience, so they
 * are kept out of the tab order; keyboard users scroll the focused content.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePointerFine } from "@/hooks";
import { cn } from "@/lib/utils/cn";

const SCROLLER = ".snap-rail, .overflow-x-auto, [data-scroll-x]";
/** Chip rows and segmented controls get compact arrows; rails get large ones. */
const COMPACT_BELOW = 96;

interface Target {
  el: HTMLElement;
  rect: DOMRect;
  atStart: boolean;
  atEnd: boolean;
}

function scrollable(el: HTMLElement) {
  return el.scrollWidth - el.clientWidth > 8 && !el.closest("[data-no-arrows]");
}

function measure(el: HTMLElement): Target {
  return {
    el,
    rect: el.getBoundingClientRect(),
    atStart: el.scrollLeft <= 4,
    atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
  };
}

export function ScrollArrows() {
  const fine = usePointerFine();
  const [target, setTarget] = useState<Target | null>(null);
  const current = useRef<HTMLElement | null>(null);
  const overArrow = useRef(false);

  useEffect(() => {
    if (!fine) return;
    let frame = 0;

    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = current.current;
        setTarget(el && el.isConnected && scrollable(el) ? measure(el) : null);
      });
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || overArrow.current) return;
      const found = (event.target as Element | null)?.closest?.(SCROLLER) as HTMLElement | null;
      const next = found && scrollable(found) ? found : null;
      if (next === current.current) return;
      current.current?.removeEventListener("scroll", refresh);
      current.current = next;
      next?.addEventListener("scroll", refresh, { passive: true });
      refresh();
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", refresh, { passive: true, capture: true });
    window.addEventListener("resize", refresh);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", refresh, { capture: true });
      window.removeEventListener("resize", refresh);
      current.current?.removeEventListener("scroll", refresh);
    };
  }, [fine]);

  if (!fine || !target || typeof document === "undefined") return null;

  const { rect } = target;
  // Off-screen or too small to need help.
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.width < 160) return null;
  const compact = rect.height < COMPACT_BELOW;
  const size = compact ? 28 : 44;
  const top = rect.top + rect.height / 2 - size / 2;

  const scroll = (direction: -1 | 1) => {
    const el = target.el;
    el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.85), behavior: "smooth" });
  };

  const button = (direction: -1 | 1, hidden: boolean) => {
    const Icon = direction === -1 ? ChevronLeft : ChevronRight;
    const left = direction === -1 ? rect.left + 8 : rect.right - size - 8;
    return (
      <button
        key={direction}
        type="button"
        tabIndex={-1}
        aria-hidden
        onPointerEnter={() => (overArrow.current = true)}
        onPointerLeave={() => (overArrow.current = false)}
        onClick={() => scroll(direction)}
        style={{ top, left, width: size, height: size }}
        className={cn(
          "material press fixed z-(--z-sticky) grid place-items-center rounded-full text-text transition-opacity duration-200",
          "hover:scale-105",
          hidden ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <Icon size={compact ? 15 : 19} />
      </button>
    );
  };

  return createPortal(
    <>
      {button(-1, target.atStart)}
      {button(1, target.atEnd)}
    </>,
    document.body,
  );
}
