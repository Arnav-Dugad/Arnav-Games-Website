/**
 * Core Web Vitals (LCP, CLS, INP) without the `web-vitals` dependency.
 *
 * Follows the same definitions as Google's library closely enough for a p75
 * on a dashboard, and no further:
 *
 * - LCP: the last `largest-contentful-paint` entry before the first input or
 *   the page being hidden. Only meaningful for the hard load, so it's
 *   attributed to the landing path.
 * - CLS: the largest *session window* of layout shifts (shifts < 1s apart,
 *   window capped at 5s), ignoring shifts right after input.
 * - INP: per interaction, the longest event duration; then roughly the 98th
 *   percentile of interactions (worst one for every 50), as the spec does.
 *
 * Everything is reported once, when the page is first hidden (tab switch,
 * close, app switch on mobile) — the last moment we reliably get to run.
 * Soft navigations don't reset the metrics, so CLS/INP describe the whole
 * page lifetime and are attributed to the path the visitor was on when it
 * ended.
 */

import { deviceClass, isUntrackedPath, send } from "./client";
import type { ClientEvent } from "./types";

let started = false;

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}
interface EventTimingEntry extends PerformanceEntry {
  interactionId?: number;
}

function observe(type: string, callback: (entries: PerformanceEntry[]) => void, extra?: object) {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return null;
    const observer = new PerformanceObserver((list) => callback(list.getEntries()));
    observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    return observer;
  } catch {
    return null;
  }
}

/** Starts collection for this page load. Idempotent. */
export function startWebVitals(): void {
  if (started || typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  started = true;

  const landingPath = window.location.pathname;
  // A page loaded in a background tab paints whenever it's revealed, which
  // makes LCP meaningless — the library skips it too.
  const loadedVisible = document.visibilityState === "visible";

  // --- LCP -----------------------------------------------------------------
  let lcp: number | null = null;
  let lcpFinal = false;
  const lcpObserver = observe("largest-contentful-paint", (entries) => {
    if (lcpFinal) return;
    const last = entries[entries.length - 1];
    if (last) lcp = last.startTime;
  });
  const finaliseLcp = () => {
    if (lcpFinal) return;
    lcpFinal = true;
    lcpObserver?.disconnect();
  };
  // Input stops LCP: anything painted after it is a response, not loading.
  for (const type of ["keydown", "pointerdown"] as const) {
    window.addEventListener(type, finaliseLcp, { once: true, capture: true, passive: true });
  }

  // --- CLS -----------------------------------------------------------------
  let cls = 0;
  let sessionValue = 0;
  let sessionStart = 0;
  let sessionLast = 0;
  observe("layout-shift", (entries) => {
    for (const entry of entries as LayoutShiftEntry[]) {
      if (entry.hadRecentInput) continue;
      const gapOk = entry.startTime - sessionLast < 1000;
      const spanOk = entry.startTime - sessionStart < 5000;
      if (sessionValue > 0 && gapOk && spanOk) {
        sessionValue += entry.value;
      } else {
        sessionValue = entry.value;
        sessionStart = entry.startTime;
      }
      sessionLast = entry.startTime;
      cls = Math.max(cls, sessionValue);
    }
  });

  // --- INP -----------------------------------------------------------------
  const interactions = new Map<number, number>();
  const recordInteraction = (entries: PerformanceEntry[]) => {
    for (const entry of entries as EventTimingEntry[]) {
      const id = entry.interactionId;
      if (!id) continue;
      interactions.set(id, Math.max(interactions.get(id) ?? 0, entry.duration));
    }
  };
  // 40ms is the smallest threshold the API allows; quicker interactions can't
  // move a p98 that matters.
  observe("event", recordInteraction, { durationThreshold: 40 });
  observe("first-input", recordInteraction);

  const inp = (): number | null => {
    // `interactionCount` counts every interaction, including the fast ones
    // the observer never saw, which is what the percentile is taken over.
    const total =
      (performance as Performance & { interactionCount?: number }).interactionCount ??
      interactions.size;
    if (interactions.size === 0) return total > 0 ? 0 : null;
    const sorted = [...interactions.values()].sort((a, b) => b - a);
    const index = Math.min(sorted.length - 1, Math.floor(total / 50));
    return sorted[index];
  };

  // --- Report --------------------------------------------------------------
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    finaliseLcp();
    const device = deviceClass();
    const currentPath = window.location.pathname;
    const events: ClientEvent[] = [];
    if (loadedVisible && lcp !== null && !isUntrackedPath(landingPath)) {
      events.push({ type: "vital", name: "LCP", value: Math.round(lcp), path: landingPath, device });
    }
    if (!isUntrackedPath(currentPath)) {
      events.push({ type: "vital", name: "CLS", value: Number(cls.toFixed(4)), path: currentPath, device });
      const inpValue = inp();
      if (inpValue !== null) {
        events.push({ type: "vital", name: "INP", value: Math.round(inpValue), path: currentPath, device });
      }
    }
    send(events);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") report();
  });
  // bfcache-capable browsers may skip visibilitychange on unload.
  window.addEventListener("pagehide", report);
}
