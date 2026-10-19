"use client";

/**
 * Touch pull-to-refresh, mounted once in SiteChrome.
 *
 * The page sets `overscroll-behavior-y: none` (globals.css), which switches
 * off Chrome Android's native pull-to-refresh and iOS's top bounce — so this
 * restores the gesture with a version that refreshes *data* (the RSC payload,
 * via `router.refresh()`) instead of reloading the whole document and losing
 * client state.
 *
 * It only ever engages when it's unambiguous:
 *  - touch input, with the document scrolled to the very top;
 *  - the drag is clearly downward (horizontal swipes — rails, cover-flow —
 *    are abandoned on the first decisive move);
 *  - no sheet, dialog or menu is open (body scroll locked or an
 *    `aria-modal` surface present), and the touch didn't start inside a
 *    scrolled-down inner scroller or a form field.
 *
 * The pill follows the finger with rubber-band resistance and its arrow
 * rotates with progress; crossing the threshold arms it with a haptic tick.
 * Releasing armed starts the refresh inside a transition, and the spinner
 * keeps going until that transition settles — the real end of the refresh,
 * not a guess.
 *
 * Positions are written straight to the DOM per frame; React state changes
 * only on phase transitions (idle → pulling → refreshing).
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";

/** Resisted pull distance (px) at which releasing refreshes. */
const THRESHOLD = 76;
/** The pill never travels further than this, however far the finger goes. */
const MAX_PULL = 132;
/** Where the pill rests while refreshing. */
const HOLD = 64;
/** Minimum spin, so a fast cache hit still reads as "it refreshed". */
const MIN_SPIN_MS = 650;

type Phase = "idle" | "pulling" | "refreshing";

function resist(distance: number): number {
  // Linear-ish at first, then increasingly stiff toward MAX_PULL.
  return MAX_PULL * (1 - Math.exp(-distance / (MAX_PULL * 1.6)));
}

function blocked(target: EventTarget | null): boolean {
  if (document.body.style.overflow === "hidden") return true;
  if (document.querySelector("[aria-modal='true'], [data-context-menu-layer]")) return true;
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable='true'], [data-no-pull-refresh]")) return true;
  // Any vertically scrolled ancestor owns the gesture (e.g. a long list
  // inside a panel that isn't at its own top).
  for (let node: Element | null = target; node && node !== document.body; node = node.parentElement) {
    if (node.scrollTop > 0) return true;
  }
  return false;
}

export function PullToRefresh() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [pending, startTransition] = useTransition();
  const [spinUntil, setSpinUntil] = useState(0);
  const pillRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<Phase>("idle");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Refresh ends when the transition has settled *and* the minimum spin has
  // elapsed — whichever is later.
  useEffect(() => {
    if (phase !== "refreshing" || pending) return;
    const wait = Math.max(0, spinUntil - Date.now());
    const timer = setTimeout(() => {
      const pill = pillRef.current;
      if (pill) {
        pill.style.transition = "transform 0.42s var(--ease-apple), opacity 0.3s ease";
        pill.style.transform = "translate3d(0, -72px, 0) scale(0.7)";
        pill.style.opacity = "0";
      }
      setPhase("idle");
    }, wait);
    return () => clearTimeout(timer);
  }, [phase, pending, spinUntil]);

  useEffect(() => {
    // Touch-capable devices only; mice never pull.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let decided = false;
    let pulling = false;
    let armed = false;
    let pull = 0;
    let frame = 0;

    const paint = () => {
      frame = 0;
      const pill = pillRef.current;
      const icon = iconRef.current;
      if (!pill || !icon) return;
      const progress = Math.min(1, pull / THRESHOLD);
      pill.style.transition = "none";
      pill.style.opacity = String(Math.min(1, pull / 24));
      pill.style.transform = `translate3d(0, ${pull - 56}px, 0) scale(${0.72 + progress * 0.28})`;
      icon.style.transform = `rotate(${progress * 180}deg)`;
    };

    const reset = () => {
      tracking = false;
      decided = false;
      pulling = false;
      armed = false;
      pull = 0;
      document.removeEventListener("touchmove", onTouchMove);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        decided = true;
        // Sideways or upward: not ours, stop listening for this touch.
        if (Math.abs(dx) > Math.abs(dy) || dy < 0 || window.scrollY > 0) {
          reset();
          return;
        }
        pulling = true;
        setPhase("pulling");
      }
      if (!pulling) return;

      // Pulled back above the start: hand the gesture back to scrolling.
      if (dy <= 0) {
        pull = 0;
        if (!frame) frame = requestAnimationFrame(paint);
        return;
      }
      if (event.cancelable) event.preventDefault();
      pull = resist(dy);
      const nowArmed = pull >= THRESHOLD;
      if (nowArmed !== armed) {
        armed = nowArmed;
        if (armed) haptic("medium");
        iconRef.current?.parentElement?.setAttribute("data-armed", String(armed));
      }
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || phaseRef.current === "refreshing") return;
      if (window.scrollY > 0 || blocked(event.target)) return;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
      decided = false;
      // Registered per gesture, and only from the very top of the page: a
      // document-wide non-passive touchmove listener would otherwise make
      // every scroll on the site wait on the main thread.
      document.addEventListener("touchmove", onTouchMove, { passive: false });
    };

    const onTouchEnd = () => {
      if (!tracking) return;
      const wasArmed = pulling && armed;
      const wasPulling = pulling;
      reset();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const pill = pillRef.current;
      if (!wasPulling || !pill) return;

      pill.style.transition = "transform 0.45s var(--ease-apple), opacity 0.3s ease";
      if (wasArmed) {
        pill.style.transform = `translate3d(0, ${HOLD - 56}px, 0) scale(1)`;
        setSpinUntil(Date.now() + MIN_SPIN_MS);
        setPhase("refreshing");
        startTransition(() => router.refresh());
      } else {
        pill.style.transform = "translate3d(0, -56px, 0) scale(0.72)";
        pill.style.opacity = "0";
        setPhase("idle");
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, [router]);

  const refreshing = phase === "refreshing";

  return (
    <div
      aria-hidden={phase === "idle"}
      className="pointer-events-none fixed inset-x-0 top-[calc(var(--chrome-top)+0.25rem)] z-(--z-ptr) flex justify-center lg:fine:hidden"
    >
      <div
        ref={pillRef}
        className="material grid h-10 w-10 place-items-center rounded-full opacity-0 will-change-transform"
        style={{ transform: "translate3d(0, -56px, 0) scale(0.72)" }}
      >
        <span
          data-armed="false"
          className={cn(
            "grid place-items-center text-muted transition-colors duration-200 data-[armed=true]:text-brand-soft",
            refreshing && "text-brand-soft",
          )}
        >
          {refreshing ? (
            <Loader2 size={18} strokeWidth={2.4} className="animate-spin" />
          ) : (
            <span ref={iconRef} className="grid place-items-center">
              <ArrowDown size={18} strokeWidth={2.4} />
            </span>
          )}
        </span>
      </div>
      <span role="status" className="sr-only">
        {refreshing ? "Refreshing" : ""}
      </span>
    </div>
  );
}
