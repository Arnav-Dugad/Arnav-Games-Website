"use client";

/**
 * The floating card behind "Update available" and the install suggestion.
 *
 * Same material, radius and position as `Toast` (bottom-centre above the tab
 * bar on phones, bottom-right on desktop) so it reads as part of the same
 * family — but it stays until acted on, because both carry a real choice,
 * which the auto-dismissing toast API can't hold.
 *
 * Non-modal: it never takes focus or traps it. Escape dismisses.
 */

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { cn } from "@/lib/utils/cn";

interface PwaCardProps {
  open: boolean;
  onDismiss: () => void;
  dismissLabel: string;
  icon: ReactNode;
  title: string;
  body: string;
  actions: ReactNode;
}

export function PwaCard({ open, onDismiss, dismissLabel, icon, title, body, actions }: PwaCardProps) {
  const calm = useCalmMotion();
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          initial={calm ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={calm ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
          transition={calm ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 34 }}
          className={cn(
            // Under sheets and search (see the stacking scale in globals.css):
            // above them it covered a sheet's bottom buttons. Clears the tab
            // bar on touch tablets as well as phones.
            "material fixed z-(--z-card) flex items-start gap-3.5 rounded-[22px] p-3.5 pr-2.5",
            "inset-x-4 bottom-(--float-bottom) mx-auto max-w-sm",
            "sm:inset-x-auto sm:right-6 sm:mx-0 sm:w-[24rem]",
          )}
        >
          {icon}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id={titleId} className="text-[15px] font-semibold leading-snug">
              {title}
            </h2>
            <p id={bodyId} className="mt-0.5 text-[13px] leading-snug text-muted">
              {body}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-fg/8 hover:text-text coarse:h-11 coarse:w-11"
          >
            <X size={15} />
          </button>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
