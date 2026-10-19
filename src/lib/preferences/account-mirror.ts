"use client";

/**
 * Mirrors device-held preferences to the signed-in account and back.
 *
 * Theme, an explicitly chosen price region, PC specs and recent searches
 * each live in localStorage, owned by their own module (`theme.ts`,
 * `region.ts`, `pc.ts`, `recent.ts`), because they must be readable
 * synchronously — the theme before first paint. The device stays the fast
 * source of truth; this module only copies:
 *
 *  - on sign-in, a value the device has never set is restored from the
 *    account, and a value only the device has is pushed up (a device that
 *    already made its own choice keeps it — same rule as the motion and
 *    poster-size preferences);
 *  - afterwards, every change the owning module announces (its change event)
 *    is pushed to the account, debounced and merged into one write.
 *
 * `synced` remembers the last value exchanged per field, so restoring a value
 * (which fires the owner's change event) never echoes back as a write.
 */

import type { UserPreferences } from "@/lib/firebase/db";
import { MAX_RECENT, RECENT_EVENT, RECENT_KEY } from "@/components/search/recent";
import { PC_SPECS_CHANGE_EVENT, PC_SPECS_KEY, parsePcSpecs } from "./pc";
import { REGION_CHANGE_EVENT, REGION_KEY } from "./region";
import { THEME_CHANGE_EVENT, THEME_KEY } from "./theme-script";

type Field = "theme" | "priceRegion" | "pcSpecs" | "recentSearches";

interface Mirror {
  field: Field;
  key: string;
  event: string;
  /** The device's value, or undefined when this device never chose one. */
  device(): unknown;
  /** What "no choice" means when pushing a cleared value. */
  cleared: unknown;
  /** The localStorage string for an account value, or null if it isn't valid. */
  restore(value: unknown): string | null;
}

const COUNTRY = /^[A-Z]{2}$/;

function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length <= 200).slice(0, MAX_RECENT)
    : null;
}

const MIRRORS: Mirror[] = [
  {
    field: "theme",
    key: THEME_KEY,
    event: THEME_CHANGE_EVENT,
    device: () => {
      const value = get(THEME_KEY);
      return value === "light" || value === "dark" ? value : undefined;
    },
    cleared: "system",
    restore: (value) => (value === "light" || value === "dark" ? value : null),
  },
  {
    field: "priceRegion",
    key: REGION_KEY,
    event: REGION_CHANGE_EVENT,
    device: () => {
      const value = get(REGION_KEY);
      return value && COUNTRY.test(value) ? value : undefined;
    },
    cleared: null,
    restore: (value) => (typeof value === "string" && COUNTRY.test(value) ? value : null),
  },
  {
    field: "pcSpecs",
    key: PC_SPECS_KEY,
    event: PC_SPECS_CHANGE_EVENT,
    device: () => parsePcSpecs(get(PC_SPECS_KEY)) ?? undefined,
    cleared: null,
    restore: (value) => {
      const specs = value ? parsePcSpecs(JSON.stringify(value)) : null;
      return specs ? JSON.stringify(specs) : null;
    },
  },
  {
    field: "recentSearches",
    key: RECENT_KEY,
    event: RECENT_EVENT,
    device: () => {
      const raw = get(RECENT_KEY);
      if (raw === null) return undefined;
      try {
        return strings(JSON.parse(raw)) ?? undefined;
      } catch {
        return undefined;
      }
    },
    cleared: [],
    restore: (value) => {
      const list = strings(value);
      return list && list.length > 0 ? JSON.stringify(list) : null;
    },
  },
];

const synced = new Map<Field, string>();
const json = (value: unknown) => JSON.stringify(value ?? null);

/** Forget what was exchanged (on sign-out or an account switch). */
export function resetMirror(): void {
  synced.clear();
}

/**
 * Reconciles device and account after sign-in. Restores account values the
 * device lacks (announcing each through its owner's event) and returns the
 * patch of device values the account lacks, for the caller to save.
 */
export function reconcileWithAccount(prefs: UserPreferences | null): Partial<UserPreferences> {
  const patch: Record<string, unknown> = {};
  for (const mirror of MIRRORS) {
    const device = mirror.device();
    const account = prefs?.[mirror.field];
    if (device === undefined) {
      if (account === undefined) {
        // Neither side chose: "no choice" is already in sync.
        synced.set(mirror.field, json(mirror.cleared));
        continue;
      }
      synced.set(mirror.field, json(account));
      const stored = mirror.restore(account);
      if (stored === null) continue;
      try {
        window.localStorage.setItem(mirror.key, stored);
      } catch {
        continue;
      }
      window.dispatchEvent(new Event(mirror.event));
    } else if (account === undefined) {
      synced.set(mirror.field, json(device));
      patch[mirror.field] = device;
    } else {
      // Both chose: this device keeps its own; the next change here syncs.
      synced.set(mirror.field, json(account));
    }
  }
  return patch as Partial<UserPreferences>;
}

/**
 * Pushes device changes to the account via `save`, debounced (a burst of
 * recent-search updates or a slider becomes one write). Returns the
 * unsubscribe.
 */
export function watchDeviceChanges(save: (patch: Partial<UserPreferences>) => void, delayMs = 1500): () => void {
  let pending: Record<string, unknown> = {};
  let timer = 0;
  const flush = () => {
    timer = 0;
    const patch = pending;
    pending = {};
    if (Object.keys(patch).length > 0) save(patch as Partial<UserPreferences>);
  };
  const handlers = MIRRORS.map((mirror) => {
    const handler = () => {
      const value = mirror.device() ?? mirror.cleared;
      const encoded = json(value);
      if (synced.get(mirror.field) === encoded) return;
      synced.set(mirror.field, encoded);
      pending[mirror.field] = value;
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, delayMs);
    };
    window.addEventListener(mirror.event, handler);
    return [mirror.event, handler] as const;
  });
  return () => {
    for (const [event, handler] of handlers) window.removeEventListener(event, handler);
    if (timer) {
      window.clearTimeout(timer);
      flush();
    }
  };
}
