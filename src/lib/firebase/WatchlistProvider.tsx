"use client";

/**
 * Watchlist state, subscribed once for the whole app.
 *
 * Every card on a grid needs to know whether its game is tracked. Subscribing
 * per-card would open dozens of Firestore listeners on a single page, so this
 * provider holds one snapshot listener and exposes a lookup.
 *
 * Toggles are optimistic: the local set updates immediately and rolls back if
 * the write fails, so the button never feels like it's waiting on the network.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthProvider";
import {
  ensureWatchlistEntry,
  batchUpdateLibraryEntries,
  removeFromWatchlist,
  setGameFollowing,
  setGameWatchlisted,
  setOwnedOn,
  setSubscriptionAccess,
  setWatchPlatform,
  setWatchStatus,
  subscribeWatchlist,
  syncWatchlistMetadata,
  LIBRARY_SCHEMA_VERSION,
  type SubscriptionAccess,
  type BatchLibraryChange,
  type WatchStatus,
  type WatchlistEntry,
} from "./db";
import type { GameSummary } from "@/lib/games/types";

interface WatchlistContextValue {
  entries: WatchlistEntry[];
  loading: boolean;
  isWatched: (gameId: number) => boolean;
  isFollowed: (gameId: number) => boolean;
  isWatchlisted: (gameId: number) => boolean;
  statusOf: (gameId: number) => WatchStatus | null;
  ensure: (game: GameSummary) => Promise<void>;
  /** Returns the new explicit follow state. */
  toggleFollow: (game: GameSummary) => Promise<boolean>;
  toggleWatchlist: (game: GameSummary) => Promise<boolean>;
  syncFollow: (game: GameSummary) => Promise<void>;
  setStatus: (gameId: number, status: WatchStatus) => Promise<void>;
  /** Records which platform the user is playing on. */
  setPlatform: (gameId: number, platform: string | null) => Promise<void>;
  /** Records where the user owns the game. */
  setOwnership: (gameId: number, ownedOn: string[]) => Promise<void>;
  ownershipOf: (gameId: number) => string[];
  setAccess: (gameId: number, access: SubscriptionAccess[]) => Promise<void>;
  accessOf: (gameId: number) => SubscriptionAccess[];
  remove: (gameId: number) => Promise<void>;
  batchUpdate: (gameIds: number[], change: BatchLibraryChange) => Promise<void>;
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [entriesOwnerUid, setEntriesOwnerUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Follow writes are optimistic; personal records remain server-backed. */
  const [pendingFollowing, setPendingFollowing] = useState<Map<number, boolean>>(new Map());
  const [pendingWatchlisted, setPendingWatchlisted] = useState<Map<number, boolean>>(new Map());
  const metadataAttempted = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!user) {
      // Signing out clears the cached list a frame later, keeping the state
      // write out of the effect body.
      const frame = requestAnimationFrame(() => {
        setEntries([]);
        setEntriesOwnerUid(null);
        setPendingFollowing(new Map());
        setPendingWatchlisted(new Map());
        setLoading(false);
      });
      return () => cancelAnimationFrame(frame);
    }
    const unsubscribe = subscribeWatchlist(
      user.uid,
      (next) => {
        setEntries(next);
        setEntriesOwnerUid(user.uid);
        setPendingFollowing(new Map());
        setPendingWatchlisted(new Map());
        setLoading(false);
      },
      (err) => {
        console.error("[watchlist] subscription failed", err);
        setEntriesOwnerUid(user.uid);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    metadataAttempted.current.clear();
  }, [user?.uid]);

  // Never expose or refresh the previous account's snapshot during an auth switch.
  const activeEntries = useMemo(
    () => entriesOwnerUid === user?.uid ? entries : [],
    [entriesOwnerUid, user?.uid, entries],
  );
  const activeLoading = loading || Boolean(user && entriesOwnerUid !== user.uid);

  useEffect(() => {
    if (!user || activeEntries.length === 0) return;
    const staleBefore = Date.now() - 7 * 86_400_000;
    const stale = activeEntries.filter((entry) =>
      !/-s\d+$/.test(entry.slug)
      && !metadataAttempted.current.has(entry.gameId)
      && (entry.metadataVersion < LIBRARY_SCHEMA_VERSION || entry.metadataUpdatedAt < staleBefore),
    );
    if (stale.length === 0) return;
    for (const entry of stale) metadataAttempted.current.add(entry.gameId);

    void (async () => {
      for (let offset = 0; offset < stale.length; offset += 100) {
        const ids = stale.slice(offset, offset + 100).map((entry) => entry.gameId);
        const response = await fetch("/api/library/metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!response.ok) continue;
        const payload = await response.json() as { games?: GameSummary[] };
        if (payload.games?.length) await syncWatchlistMetadata(user.uid, payload.games);
      }
    })().catch((error) => console.warn("[library] metadata refresh failed", error));
  }, [activeEntries, user]);

  const serverIds = useMemo(() => new Set(activeEntries.map((e) => e.gameId)), [activeEntries]);

  const isWatched = useCallback(
    (gameId: number) => serverIds.has(gameId),
    [serverIds],
  );

  const isFollowed = useCallback(
    (gameId: number) => pendingFollowing.get(gameId)
      ?? activeEntries.find((entry) => entry.gameId === gameId)?.following
      ?? false,
    [activeEntries, pendingFollowing],
  );

  const isWatchlisted = useCallback(
    (gameId: number) => pendingWatchlisted.get(gameId)
      ?? activeEntries.find((entry) => entry.gameId === gameId)?.watchlisted
      ?? false,
    [activeEntries, pendingWatchlisted],
  );

  const statusOf = useCallback(
    (gameId: number) => activeEntries.find((e) => e.gameId === gameId)?.status ?? null,
    [activeEntries],
  );

  const ensure = useCallback(
    async (game: GameSummary) => {
      if (!user) throw new Error("Sign in to save games.");
      // Existing records also need the current catalogue snapshot. The write
      // merges metadata only, so no personal state can be overwritten.
      await ensureWatchlistEntry(user.uid, game);
    },
    [user],
  );

  const toggleFollow = useCallback(
    async (game: GameSummary) => {
      if (!user) throw new Error("Sign in to follow games.");
      const exists = isWatched(game.id);
      const next = !isFollowed(game.id);

      setPendingFollowing((prev) => new Map(prev).set(game.id, next));
      try {
        await setGameFollowing(user.uid, game, next, exists);
        return next;
      } catch (err) {
        setPendingFollowing((prev) => {
          const rolled = new Map(prev);
          rolled.delete(game.id);
          return rolled;
        });
        throw err;
      }
    },
    [user, isWatched, isFollowed],
  );

  const setStatus = useCallback(
    async (gameId: number, status: WatchStatus) => {
      if (!user) throw new Error("Sign in to use your watchlist.");
      // Pass the current entry so first-transition timestamps aren't rewritten.
      const current = activeEntries.find((entry) => entry.gameId === gameId);
      await setWatchStatus(user.uid, gameId, status, current);
    },
    [user, activeEntries],
  );

  const setOwnership = useCallback(
    async (gameId: number, ownedOn: string[]) => {
      if (!user) throw new Error("Sign in to track what you own.");
      await setOwnedOn(user.uid, gameId, ownedOn);
    },
    [user],
  );

  const ownershipOf = useCallback(
    (gameId: number) => activeEntries.find((entry) => entry.gameId === gameId)?.ownedOn ?? [],
    [activeEntries],
  );

  const toggleWatchlist = useCallback(
    async (game: GameSummary) => {
      if (!user) throw new Error("Sign in to save games.");
      const next = !isWatchlisted(game.id);
      setPendingWatchlisted((previous) => new Map(previous).set(game.id, next));
      try {
        await setGameWatchlisted(user.uid, game, next, isWatched(game.id));
        return next;
      } catch (error) {
        setPendingWatchlisted((previous) => {
          const rolled = new Map(previous);
          rolled.delete(game.id);
          return rolled;
        });
        throw error;
      }
    },
    [user, isWatchlisted, isWatched],
  );

  const syncFollow = useCallback(
    async (game: GameSummary) => {
      if (!user) return;
      await setGameFollowing(user.uid, game, true, true);
    },
    [user],
  );

  const setAccess = useCallback(
    async (gameId: number, access: SubscriptionAccess[]) => {
      if (!user) throw new Error("Sign in to track subscription play.");
      await setSubscriptionAccess(user.uid, gameId, access);
    },
    [user],
  );

  const accessOf = useCallback(
    (gameId: number) => activeEntries.find((entry) => entry.gameId === gameId)?.subscriptionAccess ?? [],
    [activeEntries],
  );

  const setPlatform = useCallback(
    async (gameId: number, platform: string | null) => {
      if (!user) throw new Error("Sign in to use your watchlist.");
      await setWatchPlatform(user.uid, gameId, platform);
    },
    [user],
  );

  const remove = useCallback(
    async (gameId: number) => {
      if (!user) throw new Error("Sign in to use your watchlist.");
      await removeFromWatchlist(user.uid, gameId);
    },
    [user],
  );

  const batchUpdate = useCallback(async (gameIds: number[], change: BatchLibraryChange) => {
    if (!user) throw new Error("Sign in to edit your games.");
    const wanted = new Set(gameIds);
    const selected = activeEntries.filter((entry) => wanted.has(entry.gameId));
    if (selected.length === 0) return;
    await batchUpdateLibraryEntries(user.uid, selected, change);
  }, [user, activeEntries]);

  const value = useMemo<WatchlistContextValue>(
    () => ({
      entries: activeEntries,
      loading: activeLoading,
      isWatched,
      isFollowed,
      isWatchlisted,
      statusOf,
      ensure,
      toggleFollow,
      toggleWatchlist,
      syncFollow,
      setStatus,
      setPlatform,
      setOwnership,
      ownershipOf,
      setAccess,
      accessOf,
      remove,
      batchUpdate,
    }),
    [activeEntries, activeLoading, isWatched, isFollowed, isWatchlisted, statusOf, ensure, toggleFollow, toggleWatchlist, syncFollow, setStatus, setPlatform, setOwnership, ownershipOf, setAccess, accessOf, remove, batchUpdate],
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistContextValue {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error("useWatchlist must be used inside <WatchlistProvider>.");
  return ctx;
}
