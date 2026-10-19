"use client";

/**
 * Preferences: the device copy first, the account as its mirror.
 *
 * Every preference is read from `localStorage` (synchronous, works signed
 * out, and never waits on the network) and, when signed in, mirrored to
 * `users/{uid}/settings/preferences` so it follows the reader to a new
 * browser or phone. The rule in both directions: a device that already made
 * a choice keeps it; a device that hasn't inherits the account's.
 *
 * This provider owns motion, poster sizes, release alerts and the wishlist
 * budget directly. Theme, price region, PC specs and recent searches are
 * owned by their own modules and mirrored by `account-mirror.ts`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { getUserPreferences, saveUserPreferences, type UserPreferences } from "@/lib/firebase/db";
import { STORAGE_PREFIX, migrateLegacyStorage, upgradeKeyedMap } from "@/lib/utils/storage-keys";
import { reconcileWithAccount, resetMirror, watchDeviceChanges } from "./account-mirror";

const MOTION_KEY = `${STORAGE_PREFIX}reduce-motion`;
const POSTER_KEY = `${STORAGE_PREFIX}poster-sizes`;
const NOTIFICATION_RELEASES_KEY = `${STORAGE_PREFIX}notifications:releases`;
const BUDGET_KEY = `${STORAGE_PREFIX}wishlist-budget`;
/**
 * The budget used to be smuggled into the poster-size map as "CUR:amount"
 * under this key. It is read once, moved to its own field (device and
 * account) and dropped from the map.
 */
const LEGACY_BUDGET_SIZE_KEY = `${STORAGE_PREFIX}wishlist-budget`;

export type WishlistBudget = { currency: string; amount: number };

function parseBudget(value: unknown): WishlistBudget | null {
  if (typeof value === "string") {
    const [currency, amount] = value.split(":");
    return parseBudget({ currency, amount: Number(amount) });
  }
  if (!value || typeof value !== "object") return null;
  const { currency, amount } = value as Partial<WishlistBudget>;
  return typeof currency === "string" && /^[A-Z]{3}$/.test(currency) && typeof amount === "number" && Number.isFinite(amount) && amount > 0
    ? { currency, amount: Math.round(amount) }
    : null;
}

function readLocalBudget(): WishlistBudget | null {
  try {
    return parseBudget(JSON.parse(window.localStorage.getItem(BUDGET_KEY) ?? "null"));
  } catch {
    return null;
  }
}

function withoutLegacyBudget(sizes: Record<string, string>): Record<string, string> {
  if (!(LEGACY_BUDGET_SIZE_KEY in sizes)) return sizes;
  const next = { ...sizes };
  delete next[LEGACY_BUDGET_SIZE_KEY];
  return next;
}

interface PreferencesValue {
  /** User-level motion opt-out, on top of the OS setting. */
  reduceMotion: boolean;
  setReduceMotion: (value: boolean) => void;
  /**
   * Poster density per collection page, mirrored to the account so it follows
   * the reader to a new device like every other preference.
   */
  posterSizes: Record<string, string>;
  setPosterSize: (key: string, size: string) => void;
  notificationReleases: boolean;
  setNotificationReleases: (value: boolean) => void;
  /** The wishlist "best buys" budget, in minor units of its currency. */
  wishlistBudget: WishlistBudget | null;
  setWishlistBudget: (value: WishlistBudget | null) => void;
  /** False until localStorage has been read, so nothing renders a wrong value. */
  ready: boolean;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [posterSizes, setPosterSizesState] = useState<Record<string, string>>({});
  const [notificationReleases, setNotificationReleasesState] = useState(true);
  const [wishlistBudget, setWishlistBudgetState] = useState<WishlistBudget | null>(null);
  const [ready, setReady] = useState(false);
  /** The uid whose account has been reconciled; device changes sync only after that. */
  const [mirrorUid, setMirrorUid] = useState<string | null>(null);
  /**
   * True once the device copy has been read. Account preferences are only
   * applied after this, so a slow Firestore read can never overwrite a choice
   * the reader just made on this device.
   */
  const [deviceLoaded, setDeviceLoaded] = useState(false);

  useEffect(() => {
    // Deferred a frame so nothing is written during the effect itself.
    //
    // localStorage is the source of truth for this device; the cookie is the
    // mirror the server reads. Preferring localStorage and then re-asserting
    // the cookie converges the two, and reading the cookie as a fallback covers
    // a browser that kept cookies but cleared site storage.
    const frame = requestAnimationFrame(() => {
      migrateLegacyStorage();
      try {
        setReduceMotionState(window.localStorage.getItem(MOTION_KEY) === "true");

        let budget = readLocalBudget();
        const storedSizes = window.localStorage.getItem(POSTER_KEY);
        if (storedSizes) {
          const parsed: unknown = JSON.parse(storedSizes);
          // Guard the shape: a hand-edited or stale value must not poison state.
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const sizes = upgradeKeyedMap(parsed as Record<string, string>);
            // One-time move of the budget out of the poster-size map.
            if (!budget) budget = parseBudget(sizes[LEGACY_BUDGET_SIZE_KEY]);
            const cleaned = withoutLegacyBudget(sizes);
            if (cleaned !== sizes) {
              window.localStorage.setItem(POSTER_KEY, JSON.stringify(cleaned));
              if (budget) window.localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
            }
            setPosterSizesState(cleaned);
          }
        }
        setWishlistBudgetState(budget);
        setNotificationReleasesState(window.localStorage.getItem(NOTIFICATION_RELEASES_KEY) !== "false");
      } catch {
        /* private mode or storage disabled — defaults are fine */
      }
      setReady(true);
      setDeviceLoaded(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  /**
   * Pull account preferences once signed in.
   *
   * Deliberately runs *after* the device read and only fills values the device
   * didn't already have. Signing in on a new browser inherits your settings;
   * signing in on a device you've already configured leaves it alone — and
   * pushes up whatever this device knows that the account doesn't yet.
   */
  useEffect(() => {
    if (!user || !deviceLoaded) return;
    let cancelled = false;
    resetMirror();

    getUserPreferences(user.uid)
      .then((prefs) => {
        if (cancelled) return;
        const push: UserPreferences = { ...reconcileWithAccount(prefs) };
        try {
          const hasLocalMotion = window.localStorage.getItem(MOTION_KEY) !== null;
          if (!hasLocalMotion && typeof prefs?.reduceMotion === "boolean") {
            setReduceMotionState(prefs.reduceMotion);
          }

          const hasLocalSizes = window.localStorage.getItem(POSTER_KEY) !== null;
          if (!hasLocalSizes && prefs?.posterSizes) {
            setPosterSizesState(withoutLegacyBudget(upgradeKeyedMap(prefs.posterSizes)));
          }
          const hasLocalReleaseAlerts = window.localStorage.getItem(NOTIFICATION_RELEASES_KEY) !== null;
          if (!hasLocalReleaseAlerts && typeof prefs?.notificationReleases === "boolean") {
            setNotificationReleasesState(prefs.notificationReleases);
          }

          const localBudget = readLocalBudget();
          const accountBudget =
            parseBudget(prefs?.wishlistBudget) ?? parseBudget(prefs?.posterSizes?.[LEGACY_BUDGET_SIZE_KEY]);
          if (!localBudget && accountBudget) {
            window.localStorage.setItem(BUDGET_KEY, JSON.stringify(accountBudget));
            setWishlistBudgetState(accountBudget);
          }
          if (prefs?.wishlistBudget === undefined && (localBudget ?? accountBudget)) {
            push.wishlistBudget = localBudget ?? accountBudget;
          }
        } catch {
          /* storage unavailable — account values simply aren't applied */
        }
        const legacy = Boolean(prefs?.posterSizes && LEGACY_BUDGET_SIZE_KEY in prefs.posterSizes);
        if (Object.keys(push).length > 0 || legacy) {
          void saveUserPreferences(user.uid, push, legacy ? { dropPosterSizeKeys: [LEGACY_BUDGET_SIZE_KEY] } : {}).catch(() => {});
        }
        setMirrorUid(user.uid);
      })
      .catch(() => {
        /* preferences are best-effort; the device copy already works */
      });

    return () => {
      cancelled = true;
    };
  }, [user, deviceLoaded]);

  // After reconciling, mirror every device-side change to the account.
  useEffect(() => {
    if (!user || mirrorUid !== user.uid) return;
    return watchDeviceChanges((patch) => {
      void saveUserPreferences(user.uid, patch).catch(() => {});
    });
  }, [user, mirrorUid]);

  useEffect(() => {
    // Lets CSS opt out of motion without every component subscribing.
    document.documentElement.dataset.reduceMotion = reduceMotion ? "true" : "false";
  }, [reduceMotion]);

  const setReduceMotion = useCallback(
    (value: boolean) => {
      setReduceMotionState(value);
      try {
        window.localStorage.setItem(MOTION_KEY, String(value));
      } catch {
        /* in-memory state still updates */
      }
      if (user) void saveUserPreferences(user.uid, { reduceMotion: value }).catch(() => {});
    },
    [user],
  );

  const setPosterSize = useCallback(
    (key: string, size: string) => {
      setPosterSizesState((prev) => {
        const next = { ...prev, [key]: size };
        try {
          window.localStorage.setItem(POSTER_KEY, JSON.stringify(next));
        } catch {
          /* in-memory state still updates */
        }
        // Merged server-side, so writing one page's choice can't clear another's.
        if (user) void saveUserPreferences(user.uid, { posterSizes: next }).catch(() => {});
        return next;
      });
    },
    [user],
  );

  const setNotificationReleases = useCallback(
    (value: boolean) => {
      setNotificationReleasesState(value);
      try {
        window.localStorage.setItem(NOTIFICATION_RELEASES_KEY, String(value));
      } catch {
        /* in-memory state still updates */
      }
      if (user) void saveUserPreferences(user.uid, { notificationReleases: value }).catch(() => {});
    },
    [user],
  );


  const setWishlistBudget = useCallback(
    (value: WishlistBudget | null) => {
      const next = value ? parseBudget(value) : null;
      setWishlistBudgetState(next);
      try {
        if (next) window.localStorage.setItem(BUDGET_KEY, JSON.stringify(next));
        else window.localStorage.removeItem(BUDGET_KEY);
      } catch {
        /* in-memory state still updates */
      }
      if (user) void saveUserPreferences(user.uid, { wishlistBudget: next }).catch(() => {});
    },
    [user],
  );

  const value = useMemo<PreferencesValue>(
    () => ({
      reduceMotion,
      setReduceMotion,
      posterSizes,
      setPosterSize,
      notificationReleases,
      setNotificationReleases,
      wishlistBudget,
      setWishlistBudget,
      ready,
    }),
    [
      reduceMotion,
      setReduceMotion,
      posterSizes,
      setPosterSize,
      notificationReleases,
      setNotificationReleases,
      wishlistBudget,
      setWishlistBudget,
      ready,
    ],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside <PreferencesProvider>.");
  return ctx;
}
