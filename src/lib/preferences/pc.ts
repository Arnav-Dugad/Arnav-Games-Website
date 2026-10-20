"use client";

/**
 * The reader's own PC specs, for "Will it run?" checks against Steam's
 * requirements. Entered once (game page sheet or Settings → My PC). The
 * device copy is what the page reads; when signed in it is also mirrored to
 * the account (see `PreferencesProvider`), so a new phone or browser can
 * still answer "will it run on my PC?".
 */

import { useCallback, useSyncExternalStore } from "react";
import type { UserPcSpecs } from "@/lib/games/types";
import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";

export const PC_SPECS_KEY = `${STORAGE_PREFIX}pc-specs`;
export const PC_SPECS_CHANGE_EVENT = "arnav-games:pc-specs-change";
const CHANGE_EVENT = PC_SPECS_CHANGE_EVENT;

let cachedRaw: string | null = null;
let cachedValue: UserPcSpecs | null = null;

const FORM_FACTORS = ["desktop", "laptop", "handheld"] as const;
const STORAGE = ["nvme", "sata-ssd", "hdd"] as const;
const OSES = ["windows", "macos", "linux", "steamos"] as const;
const RESOLUTIONS = ["720p", "1080p", "1440p", "4k"] as const;
const QUALITIES = ["low", "medium", "high", "max"] as const;
const FPS = [30, 60, 120] as const;

const oneOf = <T extends string | number>(list: readonly T[], value: unknown): T | undefined =>
  list.includes(value as T) ? (value as T) : undefined;
const gb = (value: unknown, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? value : undefined;

/**
 * Validates stored specs (device or account copy). The three parts are
 * required; every later field is optional and dropped when malformed, so a
 * bad value never costs the reader their whole saved PC. Mirrors the shape
 * `firestore.rules` accepts for `pcSpecs`.
 */
export function parsePcSpecs(raw: string | null): UserPcSpecs | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.cpu !== "string" || typeof value.gpu !== "string") return null;
    const ramGb = Number(value.ramGb);
    if (!Number.isFinite(ramGb) || ramGb <= 0 || ramGb > 1024) return null;
    const specs: UserPcSpecs = { cpu: value.cpu.slice(0, 120), gpu: value.gpu.slice(0, 120), ramGb };
    const formFactor = oneOf(FORM_FACTORS, value.formFactor);
    if (formFactor) specs.formFactor = formFactor;
    const vramGb = gb(value.vramGb, 128);
    if (vramGb) specs.vramGb = vramGb;
    const storage = oneOf(STORAGE, value.storage);
    if (storage) specs.storage = storage;
    const freeStorageGb = gb(value.freeStorageGb, 100_000);
    if (freeStorageGb) specs.freeStorageGb = freeStorageGb;
    const os = oneOf(OSES, value.os);
    if (os) specs.os = os;
    const display = value.display as Record<string, unknown> | undefined;
    const resolution = oneOf(RESOLUTIONS, display?.resolution);
    if (resolution) {
      const refreshHz = gb(display?.refreshHz, 1000);
      specs.display = refreshHz ? { resolution, refreshHz } : { resolution };
    }
    const goal = value.goal as Record<string, unknown> | undefined;
    const goalResolution = oneOf(RESOLUTIONS, goal?.resolution);
    const fps = oneOf(FPS, goal?.fps);
    const quality = oneOf(QUALITIES, goal?.quality);
    if (goalResolution && fps && quality) specs.goal = { resolution: goalResolution, fps, quality };
    return specs;
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
    cachedValue = parsePcSpecs(raw);
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

const RES: Record<string, string> = { "720p": "720p", "1080p": "1080p", "1440p": "1440p", "4k": "4K" };
const QUALITY: Record<string, string> = { low: "Low", medium: "Medium", high: "High", max: "Max" };

/** "RTX 4060 Laptop · 16 GB · 1440p High" — the one-line summary rows show. */
export function pcSummary(specs: UserPcSpecs): string {
  const goal = specs.goal ? `${RES[specs.goal.resolution]} ${QUALITY[specs.goal.quality]}${specs.goal.fps === 120 ? " · 120 fps" : ""}` : null;
  return [specs.gpu || specs.cpu, `${specs.ramGb} GB`, goal].filter(Boolean).join(" · ");
}
