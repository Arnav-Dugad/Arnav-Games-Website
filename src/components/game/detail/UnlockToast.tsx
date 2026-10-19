"use client";

/**
 * The moment you mark a game "Played": an achievement-style unlock, the way
 * consoles celebrate a trophy — a gold trophy, "Played Elden Ring", and one
 * light sweep across the card. Motion with a job (confirm, delight once), so
 * it's shown only when motion is allowed; StatusPicker falls back to the
 * plain toast otherwise.
 *
 * Portalled to the body and positioned like the app's toasts: bottom-centre
 * above the phone tab bar, bottom-right on desktop. It dismisses itself.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Trophy } from "lucide-react";

const SHOW_MS = 3600;

export function UnlockToast({ name }: { name: string }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setOpen(false), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-[400] flex justify-center px-4 lg:bottom-6 lg:justify-end lg:px-6">
      <AnimatePresence>
        {open && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 28, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.22 } }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            onClick={() => setOpen(false)}
            className="material pointer-events-auto relative flex w-full max-w-sm items-center gap-3.5 overflow-hidden rounded-2xl py-3 pl-3 pr-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.65)]"
          >
            {/* One sweep of light across the card, after it lands. */}
            <motion.span
              aria-hidden
              initial={{ x: "-120%" }}
              animate={{ x: "320%" }}
              transition={{ delay: 0.35, duration: 1.1, ease: [0.4, 0, 0.2, 1] }}
              className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent"
            />
            <motion.span
              aria-hidden
              initial={{ scale: 0.4, rotate: -18 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 14, delay: 0.08 }}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffe58a,#e9a90c_60%,#9c6a00)] text-[#3b2600] shadow-[0_0_24px_-2px_rgba(255,200,40,0.7)]"
            >
              <Trophy size={20} strokeWidth={2.4} />
            </motion.span>
            <span className="relative min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-gold">Game completed</span>
              <span className="block truncate text-[15px] font-semibold text-text">Played {name}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
