"use client";

/**
 * One overlay component with two genuinely different presentations:
 *  - coarse pointers get a bottom sheet that can be flung away with a drag
 *  - fine pointers get a centred dialog that scales in
 *
 * They are not the same component restyled — the transform origin, the exit
 * gesture and the safe-area handling all differ, which is the point.
 */

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useDialogFocus, useEscapeKey, useIsMobile, useLockBodyScroll } from "@/hooks";
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

  useLockBodyScroll(open);
  useEscapeKey(onClose, open);
  useDialogFocus(open, panelRef);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-[6px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />

          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              "material relative z-10 w-full outline-none",
              "max-h-[88dvh] overflow-y-auto overscroll-contain",
              "rounded-t-[34px] pb-[env(safe-area-inset-bottom)]",
              "sm:max-w-lg sm:rounded-[30px] sm:pb-0",
              className,
            )}
            initial={isMobile ? { y: "100%" } : { opacity: 0, scale: 0.94, y: 12 }}
            animate={isMobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={isMobile ? { y: "100%" } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 40, mass: 0.9 }}
            drag={isMobile ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={(_, info) => {
              // Dismiss on a decisive downward fling or a long drag.
              if (info.offset.y > 130 || info.velocity.y > 600) onClose();
            }}
          >
            {isMobile && (
              <div className="sticky top-0 z-10 flex justify-center pt-3 pb-1">
                <span aria-hidden className="h-[5px] w-9 rounded-full bg-white/30" />
              </div>
            )}

            {!bare && (
              <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 sm:px-6 sm:pt-6">
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
                  className="press -mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.09] text-muted transition-colors hover:bg-white/[0.15] hover:text-text"
                >
                  <X size={18} />
                </button>
              </header>
            )}

            <div className={cn(!bare && "px-5 pb-6 sm:px-6")}>{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
