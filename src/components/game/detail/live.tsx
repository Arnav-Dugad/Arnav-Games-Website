"use client";

/**
 * The game page's server data after first paint — live numbers (players,
 * reviews, Twitch, deals, news, Game Pass) plus the market, PC info and patch
 * notes — fetched in the browser so the page HTML stays identical for every
 * reader.
 *
 * Cloudflare budget, which shapes everything here: the first load is ONE
 * Worker request (`/api/game/[id]/insights`), shared by every section through
 * `endpoint.ts`'s keyed cache; history charts read Firestore directly. After
 * that only the live numbers refresh, from the lighter `/live`, every five
 * minutes while the tab is visible and at most MAX_POLLS times per page view
 * — a tab left open all day no longer costs a request every two minutes.
 *
 *  - A module-level cache keyed by URL means navigating back to a game shows
 *    its last numbers instantly, then refreshes them in place.
 *  - Every refresh is abortable; leaving the page (or a newer refresh)
 *    cancels the old one, so a slow response can never overwrite a fresher one.
 *  - A failed refresh keeps showing the last good data. Only a first load that
 *    fails reports "error", and tiles treat that exactly like "no data": they
 *    disappear rather than show a broken state.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameExtras, GameInsights, GameLiveData } from "@/lib/games/types";
import { usePriceRegion } from "@/lib/preferences/region";
import { insightsUrl, useEndpoint, type EndpointState, type GameIds } from "./endpoint";

/** Live numbers move by the minute, but a 5-minute view of them is plenty for a reader. */
const REFRESH_MS = 5 * 60_000;
/** Auto-refreshes per page view; the refresh button and returning to the tab still work after. */
const MAX_POLLS = 6;

type Status = "loading" | "ready" | "error";

interface LiveState {
  data: GameLiveData | null;
  status: Status;
  /** True while a background refresh is in flight over existing data. */
  refreshing: boolean;
  refresh: () => void;
}

interface InsightsContextValue {
  ids: GameIds;
  insights: EndpointState<GameInsights>;
  retry: () => void;
  request: LiveRequest;
}

/** Live refreshes by URL, newer than the insights answer they extend. */
const polled = new Map<string, { data: GameLiveData; at: number }>();

const LiveContext = createContext<LiveState>({
  data: null,
  status: "error",
  refreshing: false,
  refresh: () => {},
});
const InsightsContext = createContext<InsightsContextValue | null>(null);

export interface LiveRequest {
  id: number;
  steam?: number | null;
  twitch?: string | null;
  microsoft?: string | null;
  name: string;
  /** IGDB slug: a hint that saves the extras route an IGDB lookup. */
  slug?: string | null;
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
  const [region] = usePriceRegion();
  const ids = useMemo<GameIds>(
    () => ({ id: request.id, steam: request.steam ?? null, microsoft: request.microsoft ?? null }),
    [request.id, request.steam, request.microsoft],
  );
  // Wait for the region rather than load a market for the wrong country.
  const insights = useEndpoint<GameInsights>(region ? insightsUrl({ ...ids, twitch: request.twitch, name: request.name }, region) : null);
  const url = liveUrl(request);

  const [latest, setLatest] = useState(() => polled.get(url) ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const polls = useRef(0);

  const base = insights.status === "ready" ? insights.data.live : null;
  const baseAt = base ? Date.parse(base.fetchedAt) || 0 : 0;
  const data = latest && latest.at >= baseAt ? latest.data : base ?? latest?.data ?? null;
  const status: Status = data ? "ready" : insights.status === "loading" ? "loading" : "error";

  const load = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setRefreshing(true);
    try {
      const res = await fetch(url, { signal: abort.signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      const next = { data: (await res.json()) as GameLiveData, at: Date.now() };
      polled.set(url, next);
      if (polled.size > 50) polled.delete(polled.keys().next().value!);
      setLatest(next);
    } catch (error) {
      if (abort.signal.aborted) return;
      // Keep stale data on screen.
      console.warn("[live] refresh failed:", error instanceof Error ? error.message : error);
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setRefreshing(false);
      }
    }
  }, [url]);

  const freshest = Math.max(baseAt, latest?.at ?? 0);
  const ready = insights.status !== "loading";
  useEffect(() => {
    if (!ready) return;
    polls.current = 0;
    const stale = () => Date.now() - Math.max(freshest, polled.get(url)?.at ?? 0) > REFRESH_MS;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible" || polls.current >= MAX_POLLS || !stale()) return;
      polls.current++;
      void load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && stale()) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      controller.current?.abort();
    };
    // `freshest` is read through the closure on each tick; restarting the
    // timer whenever data lands would defeat the poll cap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, load, ready]);

  const live = useMemo<LiveState>(
    () => ({ data, status, refreshing, refresh: () => void load() }),
    [data, status, refreshing, load],
  );
  const context = useMemo<InsightsContextValue>(
    () => ({ ids, insights, retry: insights.retry, request }),
    [ids, insights, request],
  );

  return (
    <InsightsContext.Provider value={context}>
      <LiveContext.Provider value={live}>{children}</LiveContext.Provider>
    </InsightsContext.Provider>
  );
}

export function useGameLive(): LiveState {
  return useContext(LiveContext);
}

const sameIds = (a: GameIds, b: GameIds) =>
  a.id === b.id && (a.steam ?? null) === (b.steam ?? null) && (a.microsoft ?? null) === (b.microsoft ?? null);

/**
 * One part of the page's insights answer as an endpoint state, or null when
 * `ids` aren't the page's game (the compare page, a related game) — callers
 * then fall back to the part's own route.
 */
export function useInsightPart<K extends "market" | "pc" | "patches" | "cloud" | "antiCheat">(
  ids: GameIds | null,
  part: K,
): (EndpointState<NonNullable<GameInsights[K]>> & { retry: () => void }) | null {
  const context = useContext(InsightsContext);
  if (!context || !ids || !sameIds(context.ids, ids)) return null;
  const { insights, retry } = context;
  if (insights.status !== "ready") return { ...insights, retry };
  const value = insights.data[part];
  if (value !== null && value !== undefined) return { status: "ready", data: value as NonNullable<GameInsights[K]>, retry };
  const failed = (insights.data.unavailable as string[]).includes(part);
  return { status: failed ? "error" : "missing", retry };
}

/**
 * The page's second part (`/api/game/[id]/extras`: Steam tags, PCGamingWiki,
 * speedruns, mods, credited people). Requested only once `enabled` (a
 * section is near the viewport) and after the insights answer, whose
 * resolved Steam id it reuses. Every section shares one request through the
 * endpoint cache. Null outside a game page.
 */
export function useGameExtras(enabled: boolean): EndpointState<GameExtras> | null {
  const context = useContext(InsightsContext);
  const resolved = context?.insights.status === "ready" ? context.insights.data.ids : null;
  const settled = context ? context.insights.status !== "loading" : false;
  let url: string | null = null;
  if (context && enabled && settled) {
    const params = new URLSearchParams();
    const steam = resolved?.steam ?? context.request.steam ?? null;
    if (steam) params.set("steam", String(steam));
    params.set("name", context.request.name.slice(0, 120));
    if (context.request.slug) params.set("slug", context.request.slug);
    url = `/api/game/${context.request.id}/extras?${params.toString()}`;
  }
  const state = useEndpoint<GameExtras>(url);
  return context ? state : null;
}

/** The game this page is about (id, name, slug), or null outside a game page. */
export function useGameRequest(): LiveRequest | null {
  return useContext(InsightsContext)?.request ?? null;
}

/** A part of the page's own insights answer, whatever ids a section was given (e.g. none, for a game with no store ids). */
export function usePagePart<K extends "cloud" | "antiCheat">(part: K) {
  const context = useContext(InsightsContext);
  return useInsightPart(context?.ids ?? null, part);
}

/** The page's resolved Twitch category (the server fills gaps IGDB leaves). */
export function useResolvedTwitchId(): string | null {
  const context = useContext(InsightsContext);
  return context?.insights.status === "ready" ? context.insights.data.ids.twitch : null;
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
