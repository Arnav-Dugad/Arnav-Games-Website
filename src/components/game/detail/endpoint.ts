"use client";

/**
 * A tiny shared cache for the game page's secondary data: Worker JSON
 * endpoints (`/insights`, `/market`, `/pc`) and the Firestore history
 * documents the browser reads directly.
 *
 * Several components read the same answer — the bento's price tile and the
 * Prices section both want the market, the compare page wants several games
 * at once — so the cache is module-level and keyed: one request per key
 * however many readers mount, and navigating back shows the last answer
 * instantly. It is deliberately smaller than `live.tsx` (no polling): prices
 * and history move daily, not by the minute.
 *
 * States are honest about *why* there is no data:
 *  - "missing": the source answered but had nothing (the section hides),
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

/** Answers this fresh are reused without asking again (and the Worker sets matching cache headers). */
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

/** A loader resolves to the data, or null for "nothing there"; it throws on failure. */
export type Loader<T> = () => Promise<T | null>;

const jsonLoader = (url: string): Loader<unknown> => async () => {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (response.status === 404 || response.status === 204) return null;
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
};

/** Loads `key` with `loader` unless a fresh answer (or a request) already exists. */
export function loadResource(key: string, loader: Loader<unknown>, force = false): Promise<void> {
  const cached = cache.get(key);
  if (!force && cached && cached.state.status !== "loading" && Date.now() - cached.at < FRESH_MS) {
    return Promise.resolve();
  }
  const running = inflight.get(key);
  if (running) return running;

  // Keep showing the previous answer while a refresh runs.
  if (!cached) cache.set(key, { state: LOADING, at: Date.now() });

  const request = loader()
    .then((data) => (data === null || data === undefined ? ({ status: "missing" } as const) : ({ status: "ready", data } as const)))
    .catch((error: unknown) => {
      console.warn("[endpoint]", key, error instanceof Error ? error.message : error);
      const previous = cache.get(key)?.state;
      // A failed refresh keeps the last good data on screen.
      return previous && previous.status === "ready" ? previous : ({ status: "error" } as const);
    })
    .then((state) => {
      cache.set(key, { state, at: Date.now() });
      inflight.delete(key);
      emit();
    });

  inflight.set(key, request);
  emit();
  return request;
}

/**
 * Reads one keyed resource. `key = null` means "not yet" (e.g. the price
 * region is still being detected) and reports loading without loading
 * anything. The loader is captured when a load starts, so it may close over
 * render values freely.
 */
export function useResource<T>(key: string | null, loader: Loader<T>): EndpointState<T> & { retry: () => void } {
  const state = useSyncExternalStore(
    subscribe,
    () => (key ? cache.get(key)?.state ?? LOADING : LOADING),
    () => LOADING,
  ) as EndpointState<T>;

  useEffect(() => {
    if (key) void loadResource(key, loader);
    // The key identifies the data; a new loader for the same key is the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const retry = useCallback(() => {
    if (key) void loadResource(key, loader, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { ...state, retry };
}

export function loadEndpoint(url: string, force = false): Promise<void> {
  return loadResource(url, jsonLoader(url), force);
}

/**
 * Reads one Worker endpoint. `url = null` means "not yet" and reports
 * loading without fetching anything.
 */
export function useEndpoint<T>(url: string | null): EndpointState<T> & { retry: () => void } {
  return useResource<T>(url, (url ? jsonLoader(url) : async () => null) as Loader<T>);
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

export function pcUrl(ids: GameIds): string {
  return `/api/game/${ids.id}/pc?${hints(ids).toString()}`;
}

/**
 * The game page's one Worker request: live data, market, PC info and patch
 * notes together (see `/api/game/[id]/insights`). `twitch` and `name` are
 * hints for the live part.
 */
export function insightsUrl(ids: GameIds & { twitch?: string | null; name?: string | null }, country: string): string {
  const params = hints(ids);
  params.set("cc", country);
  if (ids.twitch) params.set("twitch", ids.twitch);
  if (ids.name) params.set("name", ids.name.slice(0, 120));
  return `/api/game/${ids.id}/insights?${params.toString()}`;
}
