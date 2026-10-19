"use client";

/**
 * Registers /sw.js and surfaces "a new version is waiting".
 *
 * Production only. In `next dev` a service worker would cache hot-reloading
 * dev bundles and serve stale code, so dev instead *unregisters* any worker
 * left behind on this origin (e.g. from testing a production build on the
 * same port) — the dev-safe mode.
 *
 * Update flow: a new sw.js installs in the background and then waits, so it
 * never swaps code under a page mid-session. The UI offers "Reload"; that
 * posts SKIP_WAITING, the new worker takes control, and `controllerchange`
 * reloads the page onto it. The very first install also fires
 * `controllerchange` (clients.claim), which is why the reload is gated on the
 * person having asked for it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const SW_URL = "/sw.js";
/**
 * Dev-only escape hatch for working on sw.js itself: set this localStorage key
 * to "1" and reload, and dev registers the worker too (accepting that it will
 * cache dev bundles in that browser profile). Not read in production builds.
 */
const DEV_OPT_IN_KEY = "arnav-games:dev-sw";

function devOptIn(): boolean {
  try {
    return window.localStorage.getItem(DEV_OPT_IN_KEY) === "1";
  } catch {
    return false;
  }
}
/** Long-lived installed apps rarely navigate; re-check for updates when they come back. */
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function useServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloadRequested = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;

    if (process.env.NODE_ENV !== "production" && !devOptIn()) {
      void sw.getRegistrations().then((regs) => {
        for (const reg of regs) {
          const script = (reg.active ?? reg.waiting ?? reg.installing)?.scriptURL;
          if (script && new URL(script).pathname === SW_URL) void reg.unregister();
        }
      });
      return;
    }

    let registration: ServiceWorkerRegistration | null = null;
    let lastCheck = Date.now();
    let cancelled = false;

    const track = (reg: ServiceWorkerRegistration) => {
      // Only an *update* is worth announcing: with no controller this is the
      // first install, which is silent.
      if (reg.waiting && sw.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const next = reg.installing;
        next?.addEventListener("statechange", () => {
          if (next.state === "installed" && sw.controller) setWaiting(next);
        });
      });
    };

    const register = () => {
      sw.register(SW_URL, { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          if (cancelled) return;
          registration = reg;
          track(reg);
        })
        .catch((err) => console.warn("[pwa] service worker registration failed", err));
    };

    const onControllerChange = () => {
      if (!reloadRequested.current) return;
      reloadRequested.current = false;
      window.location.reload();
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || !registration) return;
      if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastCheck = Date.now();
      void registration.update().catch(() => {});
    };

    sw.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisible);

    // Registration (and the shell precache it kicks off) waits for the page's
    // own load so it never competes with first paint for bandwidth.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      sw.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("load", register);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) {
      window.location.reload();
      return;
    }
    reloadRequested.current = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  const dismiss = useCallback(() => setWaiting(null), []);

  return { updateReady: waiting !== null, applyUpdate, dismiss };
}
