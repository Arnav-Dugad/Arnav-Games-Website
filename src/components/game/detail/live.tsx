"use client";

/**
 * Live, fast-moving data for the game page (players, reviews, Twitch, deals,
 * news, Game Pass), fetched in the browser so the page HTML stays identical
 * for every reader and cacheable.
 *
 * A deliberately small stale-while-revalidate hook rather than a dependency:
 *
 *  - A module-level cache keyed by URL means navigating back to a game shows
 *    its last numbers instantly, then refreshes them in place.
 *  - Every request is abortable; leaving the page (or a newer request) cancels
 *    the old one, so a slow response can never overwrite a fresher one.
 *  - It refreshes on an interval only while the tab is visible, and once when
 *    the reader returns to it — a backgrounded tab costs nothing.
 *  - A failed refresh keeps showing the last good data. Only a first load that
 *    fails reports "error", and tiles treat that exactly like "no data": they
 *    disappear rather than show a broken state.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameLiveData } from "@/lib/games/types";

/** Matches the route's own `s-maxage=120`: polling faster only re-reads the edge cache. */
const REFRESH_MS = 120_000;
/** Data younger than this is shown without a refetch on mount. */
const FRESH_MS = 60_000;

type Status = "loading" | "ready" | "error";

interface LiveState {
  data: GameLiveData | null;
  status: Status;
  /** True while a background refresh is in flight over existing data. */
  refreshing: boolean;
  refresh: () => void;
}

const cache = new Map<string, { data: GameLiveData; at: number }>();

const LiveContext = createContext<LiveState>({
  data: null,
  status: "error",
  refreshing: false,
  refresh: () => {},
});

export interface LiveRequest {
  id: number;
  steam?: number | null;
  twitch?: string | null;
  microsoft?: string | null;
  name: string;
}

export function liveUrl({ id, steam, twitch, microsoft, name }: LiveRequest): string {
  const params = new URLSearchParams();
  if (steam) params.set("steam", String(steam));
  if (twitch) params.set("twitch", twitch);
  if (microsoft) params.set("ms", microsoft);
  params.set("name", name.slice(0, 120));
  return `/api/game/${id}/live?${params.toString()}`;
}

export function GameLiveProvider({ request, children }: { request: LiveRequest; children: ReactNode }) {
  const url = liveUrl(request);
  const [entry, setEntry] = useState(() => cache.get(url) ?? null);
  const [status, setStatus] = useState<Status>(() => (cache.has(url) ? "ready" : "loading"));
  const [refreshing, setRefreshing] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setRefreshing(true);
    try {
      const res = await fetch(url, { signal: abort.signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as GameLiveData;
      const next = { data, at: Date.now() };
      cache.set(url, next);
      setEntry(next);
      setStatus("ready");
    } catch (error) {
      if (abort.signal.aborted) return;
      console.warn("[live] refresh failed:", error instanceof Error ? error.message : error);
      // Keep stale data on screen; only an empty first load is an error.
      setStatus((current) => (cache.has(url) ? current : "error"));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setRefreshing(false);
      }
    }
  }, [url]);

  useEffect(() => {
    const cached = cache.get(url);
    // Deferred a frame so the state updates in `load` stay off the effect body.
    const frame = !cached || Date.now() - cached.at > FRESH_MS ? requestAnimationFrame(() => void load()) : 0;

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    const onVisible = () => {
      const current = cache.get(url);
      if (document.visibilityState === "visible" && (!current || Date.now() - current.at > FRESH_MS)) void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      controller.current?.abort();
    };
  }, [url, load]);

  const value = useMemo<LiveState>(
    () => ({ data: entry?.data ?? null, status, refreshing, refresh: () => void load() }),
    [entry, status, refreshing, load],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useGameLive(): LiveState {
  return useContext(LiveContext);
}

/**
 * One live field: "loading" until the first response, then the value, or
 * "empty" when the source had nothing (or the request failed).
 */
export function useLiveField<T>(select: (data: GameLiveData) => T | null | undefined): { state: "loading" } | { state: "empty" } | { state: "ready"; value: T } {
  const { data, status } = useGameLive();
  if (!data) return status === "loading" ? { state: "loading" } : { state: "empty" };
  const value = select(data);
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return { state: "empty" };
  return { state: "ready", value };
}
