"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Subscribes to a media query.
 *
 * Built on `useSyncExternalStore` rather than `useState` + effect: the server
 * snapshot is always `false`, so server HTML and the first client render agree,
 * and React re-renders with the real value immediately after hydration without
 * an extra state round-trip.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** True on real pointing devices. Gates cursor-following and tilt effects. */
export function usePointerFine(): boolean {
  return useMediaQuery("(hover: hover) and (pointer: fine)");
}

export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/**
 * The single gate for expensive motion: heavy effects run only for users on a
 * precise pointer who haven't asked for reduced motion.
 */
export function useRichMotion(): boolean {
  const fine = usePointerFine();
  const reduced = usePrefersReducedMotion();
  return fine && !reduced;
}

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

/**
 * Ticks once a second toward a target date.
 *
 * Returns null until the first frame after mount — the value is time-dependent,
 * so a server-rendered figure would be stale on arrival. The first tick is
 * scheduled on an animation frame rather than run inline, which keeps the state
 * update out of the effect body and off the initial render path.
 */
export function useCountdown(target: string | null | undefined): CountdownParts | null {
  const [parts, setParts] = useState<CountdownParts | null>(null);

  useEffect(() => {
    const targetMs = target
      ? new Date(`${target.slice(0, 10)}T00:00:00Z`).getTime()
      : Number.NaN;

    if (Number.isNaN(targetMs)) {
      const frame = requestAnimationFrame(() => setParts(null));
      return () => cancelAnimationFrame(frame);
    }

    const tick = () => {
      const diff = targetMs - Date.now();
      if (diff <= 0) {
        setParts({ days: 0, hours: 0, minutes: 0, seconds: 0, done: true });
        return;
      }
      setParts({
        days: Math.floor(diff / 86_400_000),
        hours: Math.floor((diff / 3_600_000) % 24),
        minutes: Math.floor((diff / 60_000) % 60),
        seconds: Math.floor((diff / 1000) % 60),
        done: false,
      });
    };

    const frame = requestAnimationFrame(tick);
    const interval = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
    };
  }, [target]);

  return parts;
}

/*
 * Reference-counted, because locks nest: a context menu lifted inside the
 * search overlay, a sheet opened from a sheet. With each lock saving and
 * restoring the body's style on its own, releasing them out of order (the
 * outer one first — e.g. a navigation closing both at once) restored the
 * inner lock's saved "hidden" last, and the page stayed unscrollable until
 * a reload. Only the first lock saves and only the last release restores.
 */
let scrollLocks = 0;
let savedBodyStyle = { overflow: "", paddingRight: "" };

/** Locks page scroll while a modal or sheet is open, preserving scrollbar width. */
export function useLockBodyScroll(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    const { body, documentElement } = document;
    if (scrollLocks++ === 0) {
      savedBodyStyle = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
      const gap = window.innerWidth - documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (gap > 0) body.style.paddingRight = `${gap}px`;
    }

    return () => {
      if (--scrollLocks > 0) return;
      scrollLocks = 0;
      body.style.overflow = savedBodyStyle.overflow;
      body.style.paddingRight = savedBodyStyle.paddingRight;
    };
  }, [locked]);
}

/** Fires when the user clicks outside the referenced element. */
export function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  handler: () => void,
  active = true,
): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(event.target as Node)) handler();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [ref, handler, active]);
}

/** Escape-to-close, scoped to whether the surface is open. */
export function useEscapeKey(handler: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handler();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handler, active]);
}

/**
 * Gives modal surfaces a complete keyboard lifecycle: focus enters the panel,
 * Tab stays inside it, and the control that opened it receives focus again on
 * close. Keeping this shared prevents each overlay drifting into a subtly
 * different (and often incomplete) implementation.
 */
export function useDialogFocus(
  active: boolean,
  panelRef: React.RefObject<HTMLElement | null>,
  initialFocusRef?: React.RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusable = () => Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    ).filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");

    const frame = requestAnimationFrame(() => {
      const target = initialFocusRef?.current ?? focusable()[0] ?? panelRef.current;
      target?.focus();
    });

    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const candidates = focusable();
      if (candidates.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !panel.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !panel.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapTab);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trapTab);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, initialFocusRef, panelRef]);
}

/**
 * Scroll direction plus distance, for the auto-hiding header.
 *
 * Reads are throttled to one per animation frame; the initial read is also
 * deferred to a frame so no state is written during the effect itself.
 */
export function useScrollDirection(threshold = 8) {
  const [direction, setDirection] = useState<"up" | "down">("up");
  const [scrolled, setScrolled] = useState(false);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    const update = () => {
      const y = window.scrollY;
      setScrolled(y > 24);
      if (Math.abs(y - lastY.current) >= threshold) {
        setDirection(y > lastY.current && y > 80 ? "down" : "up");
        lastY.current = y;
      }
      ticking.current = false;
    };

    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(update);
    };

    lastY.current = window.scrollY;
    // Covers restored scroll positions on back-navigation.
    const frame = requestAnimationFrame(update);
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [threshold]);

  return { direction, scrolled };
}
