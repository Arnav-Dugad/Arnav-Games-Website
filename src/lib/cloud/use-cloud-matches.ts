"use client";

/**
 * Game Pass + GeForce NOW membership for a set of the reader's games, from one
 * `POST /api/cloud/match` — shared by every library shelf that needs it
 * ("Play next on Game Pass", "Play in the cloud", card badges), so the library
 * costs one Worker request however many of them render.
 *
 * Answers are kept in memory for the session and on the device for 30
 * minutes (the route's own cache window), keyed by the sorted id list. Only
 * anonymous IGDB ids leave the browser.
 */

import { useEffect, useSyncExternalStore } from "react";
import { readLocalCache, writeLocalCache } from "@/lib/utils/local-cache";
import type { CloudMatchResponse } from "@/lib/games/types";

const TTL_MS = 30 * 60_000;
const MAX_IDS = 300;
const DEVICE_SLOT = "cloud-match";

type State = { status: "loading" } | { status: "ready"; data: CloudMatchResponse } | { status: "error" };

const answers = new Map<string, State>();
const listeners = new Set<() => void>();
const LOADING: State = { status: "loading" };

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function load(key: string) {
  if (answers.has(key)) return;
  const slot = readLocalCache<{ key: string; data: CloudMatchResponse }>(DEVICE_SLOT, TTL_MS);
  if (slot?.key === key) {
    answers.set(key, { status: "ready", data: slot.data });
    emit();
    return;
  }
  answers.set(key, LOADING);
  fetch("/api/cloud/match", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ids: key.split(",").map(Number) }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as CloudMatchResponse;
      if (!data || typeof data.matches !== "object") throw new Error("malformed");
      answers.set(key, { status: "ready", data });
      writeLocalCache(DEVICE_SLOT, { key, data });
    })
    .catch((error: unknown) => {
      console.warn("[cloud] match failed:", error instanceof Error ? error.message : error);
      answers.set(key, { status: "error" });
    })
    .finally(emit);
}

/** The id list a set of games is matched under (positive IGDB ids, sorted, capped). */
export function cloudKey(ids: number[]): string {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]
    .sort((a, b) => a - b)
    .slice(0, MAX_IDS)
    .join(",");
}

/**
 * Matches for `ids` (pass the same list from every caller to share one
 * request). Null `ids` or an empty list = not yet / nothing to ask.
 */
export function useCloudMatches(ids: number[] | null): State {
  const key = ids ? cloudKey(ids) : "";
  const state = useSyncExternalStore(
    subscribe,
    () => (key ? answers.get(key) ?? LOADING : LOADING),
    () => LOADING,
  );
  useEffect(() => {
    if (key) load(key);
  }, [key]);
  return key ? state : { status: "error" };
}
