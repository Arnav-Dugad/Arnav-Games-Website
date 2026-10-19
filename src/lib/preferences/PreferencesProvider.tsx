"use client";

/**
 * Local, device-scoped preferences.
 *
 * Deliberately stored in `localStorage` rather than Firestore: these are display
 * choices, not account data. A preference that follows the device is the right
 * model for something like "reduce motion on this laptop".
 *
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
import { getUserPreferences, saveUserPreferences } from "@/lib/firebase/db";
import { STORAGE_PREFIX, migrateLegacyStorage, upgradeKeyedMap } from "@/lib/utils/storage-keys";

const MOTION_KEY = `${STORAGE_PREFIX}reduce-motion`;
const POSTER_KEY = `${STORAGE_PREFIX}poster-sizes`;
const NOTIFICATION_RELEASES_KEY = `${STORAGE_PREFIX}notifications:releases`;

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
  /** False until localStorage has been read, so nothing renders a wrong value. */
  ready: boolean;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [posterSizes, setPosterSizesState] = useState<Record<string, string>>({});
  const [notificationReleases, setNotificationReleasesState] = useState(true);
  const [ready, setReady] = useState(false);
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

        const storedSizes = window.localStorage.getItem(POSTER_KEY);
        if (storedSizes) {
          const parsed: unknown = JSON.parse(storedSizes);
          // Guard the shape: a hand-edited or stale value must not poison state.
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            setPosterSizesState(upgradeKeyedMap(parsed as Record<string, string>));
          }
        }
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
   * signing in on a device you've already configured leaves it alone.
   */
  useEffect(() => {
    if (!user || !deviceLoaded) return;
    let cancelled = false;

    getUserPreferences(user.uid)
      .then((prefs) => {
        if (cancelled || !prefs) return;
        try {
          const hasLocalMotion = window.localStorage.getItem(MOTION_KEY) !== null;
          if (!hasLocalMotion && typeof prefs.reduceMotion === "boolean") {
            setReduceMotionState(prefs.reduceMotion);
          }

          const hasLocalSizes = window.localStorage.getItem(POSTER_KEY) !== null;
          if (!hasLocalSizes && prefs.posterSizes) {
            setPosterSizesState(upgradeKeyedMap(prefs.posterSizes));
          }
          const hasLocalReleaseAlerts = window.localStorage.getItem(NOTIFICATION_RELEASES_KEY) !== null;
          if (!hasLocalReleaseAlerts && typeof prefs.notificationReleases === "boolean") {
            setNotificationReleasesState(prefs.notificationReleases);
          }
        } catch {
          /* storage unavailable — account values simply aren't applied */
        }
      })
      .catch(() => {
        /* preferences are best-effort; the device copy already works */
      });

    return () => {
      cancelled = true;
    };
  }, [user, deviceLoaded]);

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


  const value = useMemo<PreferencesValue>(
    () => ({
      reduceMotion,
      setReduceMotion,
      posterSizes,
      setPosterSize,
      notificationReleases,
      setNotificationReleases,
      ready,
    }),
    [
      reduceMotion,
      setReduceMotion,
      posterSizes,
      setPosterSize,
      notificationReleases,
      setNotificationReleases,
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
