"use client";

/**
 * One overlay component with two genuinely different presentations:
 *  - coarse pointers get a bottom sheet that can be flung away with a drag
 *  - fine pointers get a centred dialog that scales in
 *
 * They are not the same component restyled — the transform origin, the exit
 * gesture and the safe-area handling all differ, which is the point.
 *
 * The sheet's drag is hand-rolled on touch events rather than using a drag
 * library, because it has to cooperate with the sheet's own scrolling the
 * way iOS sheets do: the content scrolls natively, and only once it is at
 * its top does a further downward pull start moving the sheet — in one
 * continuous gesture, with no lift-and-retry. (A drag gesture recogniser
 * would need `touch-action: none` on the panel, which kills native scrolling
 * of long sheets like the filter panels.) The grabber and header always drag.
 *
 * Release is velocity-aware: a short, fast flick dismisses as surely as a long
 * slow drag, by projecting where the sheet would coast to. Pulling upward
 * meets rubber-band resistance instead of a hard stop.
 */

import { AnimatePresence, animate, motion, useMotionValue, type MotionValue } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus, useEscapeKey, useIsMobile, useLockBodyScroll } from "@/hooks";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Hides the default header when the content supplies its own. */
  bare?: boolean;
}

const SPRING = { type: "spring", stiffness: 420, damping: 40, mass: 0.9 } as const;

/** Apple's rubber-band curve, for pulling the sheet up past its rest point. */
function rubber(distance: number, dimension: number): number {
  return (1 - 1 / ((distance * 0.55) / dimension + 1)) * dimension;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  className,
  bare = false,
}: SheetProps) {
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragY = useMotionValue(0);

  useLockBodyScroll(open);
  useEscapeKey(onClose, open);
  useDialogFocus(open, panelRef);

  useSheetDrag({ active: open && isMobile, panelRef, y: dragY, onClose });

  // Rendered at the document root. A sheet opened from inside the header
  // (the account sheet) or a sticky dock inherits that ancestor's stacking
  // context, so its z-index only counted *within* the chrome layer — the tab
  // bar, painted later at the same level, covered the sheet's bottom rows
  // and buttons. A portal also escapes transformed or clipping ancestors.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-(--z-sheet) flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-[6px] light:bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />

          {/* Two layers: the outer one owns enter/exit (in %), the inner one
              the finger's drag offset (in px), so a dismiss continues from
              wherever the drag left off instead of mixing units on one value. */}
          <motion.div
            className="relative z-10 w-full sm:max-w-lg"
            initial={isMobile ? { y: "100%" } : { opacity: 0, scale: 0.94, y: 12 }}
            animate={isMobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={isMobile ? { y: "100%" } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={SPRING}
          >
            <motion.div
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className={cn(
                "material w-full outline-none",
                "max-h-[88dvh] overflow-y-auto overscroll-contain",
                "rounded-t-[34px] pb-[env(safe-area-inset-bottom)]",
                "sm:rounded-[30px] sm:pb-0",
                className,
              )}
              style={isMobile ? { y: dragY } : undefined}
            >
              {isMobile && (
                <div data-sheet-handle className="sticky top-0 z-10 flex touch-none justify-center pt-3 pb-1">
                  <span aria-hidden className="h-[5px] w-9 rounded-full bg-fg/30" />
                </div>
              )}

              {!bare && (
                <header
                  data-sheet-handle
                  className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 sm:px-6 sm:pt-6"
                >
                  <div className="min-w-0">
                    {title && <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>}
                    {description && (
                      <p className="mt-1 text-sm text-muted">{description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="press -mr-1.5 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-text sm:-mr-1 sm:mt-0 sm:h-9 sm:w-9"
                  >
                    {/* The visible disc stays 36px; on touch the button around
                        it is a full 44px target. */}
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-fg/[0.09] transition-colors hover:bg-fg/[0.15]">
                      <X size={18} />
                    </span>
                  </button>
                </header>
              )}

              <div className={cn(!bare && "px-5 pb-6 sm:px-6")}>{children}</div>
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * The touch drag for the bottom sheet. See the file header for the model.
 * Listeners are attached to the panel only while it is open on a phone.
 */
function useSheetDrag({
  active,
  panelRef,
  y,
  onClose,
}: {
  active: boolean;
  panelRef: React.RefObject<HTMLDivElement | null>;
  y: MotionValue<number>;
  onClose: () => void;
}) {
  useEffect(() => {
    // The panel mounts inside AnimatePresence a tick after `open` flips;
    // wait a frame for it.
    if (!active) return;
    let panel: HTMLDivElement | null = null;
    let cleanup = () => {};
    const frame = requestAnimationFrame(() => {
      panel = panelRef.current;
      if (!panel) return;
      const element = panel;

      let startY = 0;
      let lastY = 0;
      let fromHandle = false;
      let dragging = false;
      let origin = 0;
      let samples: { t: number; y: number }[] = [];

      const onStart = (event: TouchEvent) => {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        startY = lastY = touch.clientY;
        fromHandle = event.target instanceof Element && Boolean(event.target.closest("[data-sheet-handle]"));
        dragging = false;
        samples = [{ t: event.timeStamp, y: touch.clientY }];
      };

      const onMove = (event: TouchEvent) => {
        const touch = event.touches[0];
        if (!touch) return;
        const dy = touch.clientY - startY;
        lastY = touch.clientY;

        if (!dragging) {
          // Content that can still scroll up keeps the gesture; at its top,
          // a downward pull hands over to the sheet mid-gesture.
          const atTop = element.scrollTop <= 0;
          const pullingDown = touch.clientY > (samples[samples.length - 1]?.y ?? startY);
          if (!(fromHandle || (atTop && pullingDown && dy > 0))) {
            samples.push({ t: event.timeStamp, y: touch.clientY });
            return;
          }
          dragging = true;
          // From the handle the sheet tracks the whole gesture; from content,
          // it starts where the finger is now, so it doesn't jump by the
          // distance already spent scrolling.
          origin = (fromHandle ? startY : touch.clientY) - Math.max(0, y.get());
        }

        if (event.cancelable) event.preventDefault();
        const offset = touch.clientY - origin;
        y.set(offset >= 0 ? offset : -rubber(-offset, element.offsetHeight));
        samples.push({ t: event.timeStamp, y: touch.clientY });
        if (samples.length > 6) samples.shift();
      };

      const onEnd = (event: TouchEvent) => {
        if (!dragging) return;
        dragging = false;
        const recent = samples.find((sample) => event.timeStamp - sample.t < 100) ?? samples[0];
        const elapsed = Math.max(1, event.timeStamp - recent.t);
        const velocity = ((lastY - recent.y) / elapsed) * 1000; // px/s, + is down
        const offset = y.get();
        // Where a flick would coast to in ~0.2s.
        const projected = offset + velocity * 0.2;
        // Either coasting past ~30% of the sheet, or a decisive downward flick.
        const dismiss = offset > 8 && (projected > element.offsetHeight * 0.3 || velocity > 700);
        if (dismiss) {
          haptic("light");
          onClose();
        } else {
          animate(y, 0, { ...SPRING, velocity });
        }
      };

      element.addEventListener("touchstart", onStart, { passive: true });
      element.addEventListener("touchmove", onMove, { passive: false });
      element.addEventListener("touchend", onEnd, { passive: true });
      element.addEventListener("touchcancel", onEnd, { passive: true });
      cleanup = () => {
        element.removeEventListener("touchstart", onStart);
        element.removeEventListener("touchmove", onMove);
        element.removeEventListener("touchend", onEnd);
        element.removeEventListener("touchcancel", onEnd);
      };
    });
    return () => {
      cancelAnimationFrame(frame);
      cleanup();
    };
  }, [active, panelRef, y, onClose]);

  // A sheet dismissed mid-drag keeps its offset through the exit; the next
  // open must start from rest.
  useEffect(() => {
    if (!active) return;
    y.jump(0);
  }, [active, y]);
}
