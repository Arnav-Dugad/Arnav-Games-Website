"use client";

/**
 * IGDB time-to-beat for the reader's games, shared by /stats and /library so
 * both pages quote the same backlog hours.
 *
 * Time-to-beat is catalogue data, identical for every user and slow to
 * change, so it is cached for the life of the tab. Revisiting a page or
 * adding one game then costs one small request for the new id, not the whole
 * library again.
 */

import { useEffect, useMemo, useState } from "react";
import { personalGameIds, type TimeToBeatLike } from "@/lib/games/stats";
import type { WatchlistEntry } from "@/lib/firebase/db";

/** Where the lookup stands. "unavailable" means hide every hours figure. */
export type HoursStatus = "loading" | "ready" | "unavailable";

const ttbCache = new Map<number, TimeToBeatLike | null>();
let ttbSourceAvailable: boolean | null = null;
const EMPTY: Record<number, TimeToBeatLike> = {};

interface MetadataResponse {
  timeToBeat?: Record<string, TimeToBeatLike>;
  timeToBeatAvailable?: boolean;
}

async function loadTimeToBeat(ids: number[]): Promise<boolean> {
  const missing = ids.filter((id) => !ttbCache.has(id));
  if (missing.length === 0) return ttbSourceAvailable ?? false;

  const chunks: number[][] = [];
  for (let offset = 0; offset < missing.length; offset += 100) chunks.push(missing.slice(offset, offset + 100));

  const results = await Promise.all(chunks.map(async (chunk) => {
    const response = await fetch("/api/library/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: chunk, include: ["timeToBeat"] }),
    });
    if (!response.ok) return false;
    const payload = await response.json() as MetadataResponse;
    if (!payload.timeToBeatAvailable) return false;
    // Cache misses too, so a game IGDB doesn't know isn't re-asked every visit.
    for (const id of chunk) ttbCache.set(id, payload.timeToBeat?.[String(id)] ?? null);
    return true;
  }));

  // One answering chunk is enough to show hours; coverage notes then say how
  // many games actually had data.
  ttbSourceAvailable = results.some(Boolean) || Boolean(ttbSourceAvailable);
  return ttbSourceAvailable;
}

/**
 * `{ status, data }` for the given entries. `data` is null unless ready.
 * Pass `preview` (dev sample routes only) to skip the network entirely.
 */
export function useTimeToBeat(
  entries: WatchlistEntry[],
  { enabled = true, preview }: { enabled?: boolean; preview?: Record<number, TimeToBeatLike> } = {},
): { status: HoursStatus; data: Record<number, TimeToBeatLike> | null } {
  const ids = useMemo(() => personalGameIds(entries), [entries]);
  const idsKey = ids.join(",");
  const [state, setState] = useState<{ key: string; status: HoursStatus; data: Record<number, TimeToBeatLike> | null }>({
    key: "",
    status: "loading",
    data: null,
  });

  useEffect(() => {
    if (preview || !enabled || !idsKey) return;
    let active = true;
    const wanted = idsKey.split(",").map(Number);
    loadTimeToBeat(wanted)
      .then((available) => {
        if (!active) return;
        const data: Record<number, TimeToBeatLike> = {};
        for (const id of wanted) {
          const value = ttbCache.get(id);
          if (value) data[id] = value;
        }
        setState({ key: idsKey, status: available ? "ready" : "unavailable", data: available ? data : null });
      })
      .catch(() => {
        if (active) setState({ key: idsKey, status: "unavailable", data: null });
      });
    return () => {
      active = false;
    };
  }, [idsKey, enabled, preview]);

  if (preview) return { status: "ready", data: preview };
  // No IGDB ids at all (e.g. only Steam-sourced records) means there is
  // nothing to look up: hours are "ready" with no data, which the cards
  // report honestly rather than spinning forever. Until the lookup for *this*
  // set of games lands, keep the previous figures instead of flashing zero.
  if (!idsKey) return { status: "ready", data: EMPTY };
  const status: HoursStatus = state.key === idsKey ? state.status : state.status === "ready" ? "ready" : "loading";
  return { status, data: status === "ready" ? state.data : null };
}
