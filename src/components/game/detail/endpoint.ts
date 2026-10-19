"use client";

/**
 * A tiny shared cache for the game page's secondary JSON endpoints
 * (`/market`, `/players`, `/pc`).
 *
 * Several components read the same response — the bento's price tile and the
 * Prices section both want `/market`, the compare page wants all three for up
 * to three games — so the cache is module-level and keyed by URL: one request
 * per URL however many readers mount, and navigating back shows the last
 * answer instantly. It is deliberately smaller than `live.tsx` (no polling):
 * prices and history move daily, not by the minute.
 *
 * States are honest about *why* there is no data:
 *  - "missing": the endpoint answered 404 / had nothing (the section hides),
 *  - "error": the request failed (the section hides, or offers a retry).
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type EndpointState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "missing" }
  | { status: "error" };

interface Entry {
  state: EndpointState<unknown>;
  at: number;
}

/** Responses are cached at the edge for minutes; re-reading sooner is waste. */
const FRESH_MS = 5 * 60_000;
const LOADING: EndpointState<never> = { status: "loading" };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadEndpoint(url: string, force = false): Promise<void> {
  const cached = cache.get(url);
  if (!force && cached && cached.state.status !== "loading" && Date.now() - cached.at < FRESH_MS) {
    return Promise.resolve();
  }
  const running = inflight.get(url);
  if (running) return running;

  // Keep showing the previous answer while a refresh runs.
  if (!cached) cache.set(url, { state: LOADING, at: Date.now() });

  const request = fetch(url, { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (response.status === 404 || response.status === 204) return { status: "missing" } as const;
      if (!response.ok) throw new Error(String(response.status));
      const data: unknown = await response.json();
      return data === null ? ({ status: "missing" } as const) : ({ status: "ready", data } as const);
    })
    .catch((error: unknown) => {
      console.warn("[endpoint]", url, error instanceof Error ? error.message : error);
      const previous = cache.get(url)?.state;
      // A failed refresh keeps the last good data on screen.
      return previous && previous.status === "ready" ? previous : ({ status: "error" } as const);
    })
    .then((state) => {
      cache.set(url, { state, at: Date.now() });
      inflight.delete(url);
      emit();
    });

  inflight.set(url, request);
  emit();
  return request;
}

/**
 * Reads one endpoint. `url = null` means "not yet" (e.g. the price region is
 * still being detected) and reports loading without fetching anything.
 */
export function useEndpoint<T>(url: string | null): EndpointState<T> & { retry: () => void } {
  const state = useSyncExternalStore(
    subscribe,
    () => (url ? cache.get(url)?.state ?? LOADING : LOADING),
    () => LOADING,
  ) as EndpointState<T>;

  useEffect(() => {
    if (url) void loadEndpoint(url);
  }, [url]);

  const retry = useCallback(() => {
    if (url) void loadEndpoint(url, true);
  }, [url]);

  return { ...state, retry };
}

/**
 * Several endpoints at once (the compare page reads one per game), without a
 * variable number of hook calls. The snapshot array keeps its identity until
 * one of its entries actually changes, as `useSyncExternalStore` requires.
 */
export function useEndpoints<T>(urls: (string | null)[]): EndpointState<T>[] {
  const key = urls.join("\n");
  const read = useCallback(() => {
    const next = key.split("\n").map((url) => (url ? cache.get(url)?.state ?? LOADING : LOADING));
    const last = snapshots.get(key);
    if (last && last.length === next.length && next.every((state, index) => state === last[index])) return last;
    snapshots.set(key, next);
    return next;
  }, [key]);
  const states = useSyncExternalStore(subscribe, read, () => EMPTY) as EndpointState<T>[];

  useEffect(() => {
    key.split("\n").forEach((url) => {
      if (url) void loadEndpoint(url);
    });
  }, [key]);

  return states.length === urls.length ? states : urls.map(() => LOADING);
}

const EMPTY: EndpointState<never>[] = [];
/** Last snapshot per URL set, so an unchanged read returns the same array. */
const snapshots = new Map<string, EndpointState<unknown>[]>();

/* ------------------------------------------------------------------------ */

export interface GameIds {
  id: number;
  steam?: number | null;
  microsoft?: string | null;
}

function hints({ steam, microsoft }: GameIds, params = new URLSearchParams()) {
  if (steam) params.set("steam", String(steam));
  if (microsoft) params.set("ms", microsoft);
  return params;
}

export function marketUrl(ids: GameIds, country: string, regional = false): string {
  const params = hints(ids);
  params.set("cc", country);
  if (regional) params.set("regional", "1");
  return `/api/game/${ids.id}/market?${params.toString()}`;
}

export function playersUrl(ids: GameIds): string {
  return `/api/game/${ids.id}/players?${hints(ids).toString()}`;
}

export function pcUrl(ids: GameIds): string {
  return `/api/game/${ids.id}/pc?${hints(ids).toString()}`;
}
