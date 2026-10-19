"use client";

/**
 * Connectivity pill under the header.
 *
 * Offline: says so, and what still works — the library and watchlist render
 * from Firestore's on-device cache and visited pages from the service worker.
 * Back online: a brief confirmation, then it gets out of the way.
 *
 * `navigator.onLine` only knows whether there is *a* network, not whether it
 * reaches the internet, so this can stay quiet on captive Wi-Fi; that's the
 * browser's limit, and the service worker still falls back correctly there.
 * Pointer-transparent so it never blocks the page beneath it.
 */

import { AnimatePresence, motion } from "motion/react";
import { Check, WifiOff } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useCalmMotion } from "@/components/interactions/motion-prefs";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Assumes online during SSR/hydration so the first paint never shows a false alarm. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

const BACK_ONLINE_MS = 2500;

export function OfflineBanner() {
  const online = useOnline();
  const calm = useCalmMotion();
  const [showBack, setShowBack] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    // Deferred a frame so the state write isn't synchronous in the effect body.
    const frame = requestAnimationFrame(() => setShowBack(true));
    const timer = setTimeout(() => setShowBack(false), BACK_ONLINE_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [online]);

  const state = !online ? "offline" : showBack ? "online" : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(var(--chrome-top)+0.5rem)] z-(--z-offline) flex justify-center px-4"
    >
      <AnimatePresence mode="wait">
        {state && (
          <motion.p
            key={state}
            initial={calm ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={calm ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={calm ? { duration: 0.15 } : { type: "spring", stiffness: 460, damping: 34 }}
            className="material inline-flex max-w-full items-center gap-2 rounded-full py-2 pl-3 pr-4 text-[13px] font-medium"
          >
            {state === "offline" ? (
              <>
                <WifiOff size={15} className="shrink-0 text-gold" aria-hidden />
                <span className="truncate">You&rsquo;re offline — showing your saved library</span>
              </>
            ) : (
              <>
                <Check size={15} className="shrink-0 text-mint" aria-hidden />
                <span>Back online</span>
              </>
            )}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
