/**
 * Namespace for every key this site writes to localStorage.
 *
 * The site was previously called LUDEX and stored its keys under `ludex:`.
 * `migrateLegacyStorage` moves those across once, so renaming the site never
 * silently resets anyone's preferences.
 */
export const STORAGE_PREFIX = "arnav-games:";
const LEGACY_PREFIX = "ludex:";

/** Renames a legacy `ludex:` key; any other key is returned unchanged. */
export function upgradeStorageKey(key: string): string {
  return key.startsWith(LEGACY_PREFIX) ? STORAGE_PREFIX + key.slice(LEGACY_PREFIX.length) : key;
}

/** Same as `upgradeStorageKey`, applied to every key of a stored map. */
export function upgradeKeyedMap<T>(map: Record<string, T>): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    const upgraded = upgradeStorageKey(key);
    // A value already written under the new key wins over the legacy copy.
    if (upgraded === key || !(upgraded in map)) next[upgraded] = value;
  }
  return next;
}

let migrated = false;

/** Idempotent; safe to call from any client entry point. */
export function migrateLegacyStorage() {
  if (migrated || typeof window === "undefined") return;
  migrated = true;
  try {
    const store = window.localStorage;
    const legacyKeys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
    }
    for (const key of legacyKeys) {
      const next = upgradeStorageKey(key);
      const value = store.getItem(key);
      if (value !== null && store.getItem(next) === null) store.setItem(next, value);
      store.removeItem(key);
    }
  } catch {
    /* storage unavailable — nothing to migrate */
  }
}
