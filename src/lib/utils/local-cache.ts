/**
 * A tiny time-boxed cache in localStorage for answers that are the same for
 * every reader and change slowly (trending suggestions, recommendations,
 * time-to-beat). Each hit is one Cloudflare Worker request not made — the
 * Workers Free plan counts every API call, and Worker responses on
 * workers.dev aren't edge-cached.
 *
 * Best effort: private mode, full storage or corrupt JSON all read as a miss.
 */

import { STORAGE_PREFIX } from "./storage-keys";

const PREFIX = `${STORAGE_PREFIX}cache:`;

export function readLocalCache<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { at?: number; value?: T };
    if (typeof entry.at !== "number" || Date.now() - entry.at > maxAgeMs || entry.value === undefined) return null;
    return entry.value;
  } catch {
    return null;
  }
}

export function writeLocalCache(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Quota or blocked storage: drop old entries once and give up quietly.
    try {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const name = window.localStorage.key(i);
        if (name?.startsWith(PREFIX)) window.localStorage.removeItem(name);
      }
    } catch {
      /* storage unavailable */
    }
  }
}
