"use client";

/**
 * iOS-style elastic overscroll for a horizontal scroller on touch.
 *
 * Native scrolling is never replaced: momentum, snap points and the scroll
 * position all stay the browser's. This only adds what Android and desktop
 * Chromium lack — when the finger keeps dragging past the first or last item,
 * the track follows with increasing resistance and springs back on release.
 *
 * iOS already does this natively for every scroller, so the hook stands down
 * there rather than doubling the effect. Elsewhere it also sets
 * `overscroll-behavior-x: none`, which suppresses Chrome's own stretch/glow
 * so the two affordances don't stack.
 *
 * All listeners are passive (nothing is prevented), one set per scroller, and
 * the transform is written in a single rAF per frame.
 */

import { useEffect, type RefObject } from "react";

function isIOS(): boolean {
  // `-webkit-touch-callout` is implemented only by iOS/iPadOS WebKit.
  return typeof CSS !== "undefined" && CSS.supports("-webkit-touch-callout", "none");
}

/** Apple's rubber-band curve: d·(1 − 1/(x·c/d + 1)). */
function rubber(overshoot: number, dimension: number, constant = 0.55): number {
  return (1 - 1 / ((overshoot * constant) / dimension + 1)) * dimension;
}

export function useRubberBand(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    if (!window.matchMedia("(pointer: coarse)").matches || isIOS()) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const previousOverscroll = element.style.overscrollBehaviorX;
    element.style.overscrollBehaviorX = "none";

    let startX = 0;
    let startY = 0;
    let startScroll = 0;
    let axis: "x" | "y" | null = null;
    let offset = 0;
    let frame = 0;

    const paint = () => {
      frame = 0;
      element.style.transform = offset ? `translate3d(${offset}px, 0, 0)` : "";
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      if (document.documentElement.dataset.reduceMotion === "true") return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      startScroll = element.scrollLeft;
      axis = null;
      offset = 0;
      element.style.transition = "";
    };

    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      if (axis === null) {
        const dy = touch.clientY - startY;
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (axis !== "x") return;

      // Where the content *would* be if scrolling had no ends; the part
      // beyond either end is the overscroll.
      const max = element.scrollWidth - element.clientWidth;
      const virtual = startScroll - dx;
      let next = 0;
      if (virtual < 0) next = rubber(-virtual, element.clientWidth);
      else if (virtual > max) next = -rubber(virtual - max, element.clientWidth);
      if (next !== offset) {
        offset = next;
        if (!frame) frame = requestAnimationFrame(paint);
      }
    };

    const onEnd = () => {
      if (!offset) return;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      offset = 0;
      // A slightly springy settle, like UIScrollView's bounce-back.
      element.style.transition = "transform 0.55s cubic-bezier(0.22, 1.2, 0.36, 1)";
      element.style.transform = "";
    };

    const options = { passive: true } as const;
    element.addEventListener("touchstart", onStart, options);
    element.addEventListener("touchmove", onMove, options);
    element.addEventListener("touchend", onEnd, options);
    element.addEventListener("touchcancel", onEnd, options);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onEnd);
      element.style.overscrollBehaviorX = previousOverscroll;
      element.style.transform = "";
      element.style.transition = "";
    };
  }, [ref, enabled]);
}
