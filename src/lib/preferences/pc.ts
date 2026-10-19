"use client";

/**
 * The reader's own PC specs, for "Will it run?" checks against Steam's
 * requirements. Entered once (game page sheet or Settings → My PC) and kept
 * on this device only — hardware is a property of the machine you're on.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { UserPcSpecs } from "@/lib/games/types";
import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";

export const PC_SPECS_KEY = `${STORAGE_PREFIX}pc-specs`;
const CHANGE_EVENT = "arnav-games:pc-specs-change";

let cachedRaw: string | null = null;
let cachedValue: UserPcSpecs | null = null;

function parse(raw: string | null): UserPcSpecs | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<UserPcSpecs>;
    if (typeof value.cpu !== "string" || typeof value.gpu !== "string") return null;
    const ramGb = Number(value.ramGb);
    if (!Number.isFinite(ramGb) || ramGb <= 0 || ramGb > 1024) return null;
    return { cpu: value.cpu.slice(0, 120), gpu: value.gpu.slice(0, 120), ramGb };
  } catch {
    return null;
  }
}

/** Snapshot with a stable identity, as useSyncExternalStore requires. */
function read(): UserPcSpecs | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PC_SPECS_KEY);
  } catch {
    /* storage blocked */
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** `[specs, setSpecs]`; specs is null until entered (and on the server). Pass null to clear. */
export function usePcSpecs(): [UserPcSpecs | null, (next: UserPcSpecs | null) => void] {
  const specs = useSyncExternalStore(subscribe, read, () => null);

  const setSpecs = useCallback((next: UserPcSpecs | null) => {
    try {
      if (next) window.localStorage.setItem(PC_SPECS_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(PC_SPECS_KEY);
    } catch {
      /* storage blocked — nothing to persist */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [specs, setSpecs];
}
