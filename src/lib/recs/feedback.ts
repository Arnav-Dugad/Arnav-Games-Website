"use client";

/**
 * Feedback on recommendations ("More like this", "Not interested"), shared by
 * every surface that shows picks.
 *
 * Two copies, for the same reason preferences have two:
 *  - the device copy (localStorage) works signed out and is readable on the
 *    first frame, so a dismissed game never flashes back in;
 *  - the account copy (Firestore `users/{uid}/feedback/{gameId}`) follows the
 *    reader to another browser. It is read once per account per session —
 *    not subscribed — because feedback only ever changes from this tab.
 *
 * Opinions made while signed out are uploaded on the next sign-in (bounded),
 * and the newest opinion per game wins when the two copies disagree.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { deleteRecFeedback, getRecFeedback, setRecFeedback } from "@/lib/firebase/db";
import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";
import type { RecFeedback } from "./profile";

export type FeedbackKind = RecFeedback["kind"];

const DEVICE_KEY = `${STORAGE_PREFIX}rec-feedback`;
/** Enough history to matter; the profile itself only sends the newest 200. */
const MAX_ITEMS = 400;
/** Signed-out opinions uploaded on sign-in, at most — each is one write. */
const MAX_UPLOAD = 40;

let items: RecFeedback[] = [];
/**
 * Whose opinions the device copy holds: null = made signed out (uploaded on
 * the next sign-in), a uid = that account's. Another account signing in on
 * the same device starts from its own copy instead of inheriting them.
 */
let owner: string | null = null;
let hydrated = false;
/** The account whose Firestore copy has been merged in this session. */
let syncedUid: string | null = null;
let syncing: Promise<void> | null = null;
const listeners = new Set<() => void>();

const EMPTY: RecFeedback[] = [];

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function valid(item: unknown): item is RecFeedback {
  const value = item as RecFeedback;
  return (
    typeof value?.gameId === "number" &&
    value.gameId > 0 &&
    ["up", "down", "not-interested", "ignored"].includes(value.kind) &&
    typeof value.at === "number"
  );
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = JSON.parse(window.localStorage.getItem(DEVICE_KEY) ?? "{}") as { owner?: unknown; items?: unknown };
    if (Array.isArray(raw.items)) items = raw.items.filter(valid).slice(-MAX_ITEMS);
    owner = typeof raw.owner === "string" ? raw.owner : null;
  } catch {
    items = [];
  }
}

function persistDevice() {
  try {
    window.localStorage.setItem(DEVICE_KEY, JSON.stringify({ owner, items }));
  } catch {
    /* storage full or blocked: the in-memory copy still works this session */
  }
}

/** Newest opinion per game wins. */
function merge(a: RecFeedback[], b: RecFeedback[]): RecFeedback[] {
  const latest = new Map<number, RecFeedback>();
  for (const item of [...a, ...b]) {
    const current = latest.get(item.gameId);
    if (!current || item.at > current.at) latest.set(item.gameId, item);
  }
  return [...latest.values()].sort((x, y) => x.at - y.at).slice(-MAX_ITEMS);
}

function sync(uid: string) {
  if (syncedUid === uid || syncing) return;
  syncing = getRecFeedback(uid)
    .then(async (remote) => {
      const known = new Map(remote.map((item) => [item.gameId, item]));
      // Another account's device copy is never merged into this one.
      const local = owner === null || owner === uid ? items : [];
      // Device opinions the account doesn't have yet (made signed out).
      const upload = local
        .filter((item) => item.kind !== "ignored" && (known.get(item.gameId)?.at ?? 0) < item.at)
        .slice(-MAX_UPLOAD);
      items = merge(local, remote);
      owner = uid;
      persistDevice();
      syncedUid = uid;
      emit();
      await Promise.all(upload.map((item) => setRecFeedback(uid, item).catch(() => undefined)));
    })
    .catch((error: unknown) => {
      // Rules or network: keep the device copy; try again next session.
      console.warn("[recs] feedback sync failed:", error instanceof Error ? error.message : error);
      syncedUid = uid;
    })
    .finally(() => {
      syncing = null;
      emit();
    });
}

/**
 * The reader's feedback, and a setter. `ready` is false until the account copy
 * has been merged (signed in) — callers that build a profile wait for it so
 * the first recommendations request already reflects it.
 */
export function useRecFeedback() {
  const { user, loading } = useAuth();
  const uid = user?.uid ?? null;
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      hydrate();
      return items;
    },
    () => EMPTY,
  );
  const syncState = useSyncExternalStore(
    subscribe,
    () => `${syncedUid ?? ""}|${syncing ? 1 : 0}`,
    () => "|0",
  );

  useEffect(() => {
    if (uid) sync(uid);
  }, [uid]);

  const ready = !loading && (!uid || (syncState.startsWith(`${uid}|`) && syncState.endsWith("|0")));
  // Signed out after using an account here: that account's opinions stay
  // with it rather than shaping the signed-out picks.
  const visible = uid ? (owner === uid ? snapshot : EMPTY) : owner === null ? snapshot : EMPTY;

  const set = useCallback(
    (gameId: number, kind: FeedbackKind | null) => {
      hydrate();
      const at = Date.now();
      if ((uid ?? null) !== owner && (!uid || syncedUid === uid)) {
        // First opinion for a different owner on this device: start its own copy.
        items = uid ? items : [];
        owner = uid;
      }
      items = kind
        ? merge(items.filter((item) => item.gameId !== gameId), [{ gameId, kind, at }])
        : items.filter((item) => item.gameId !== gameId);
      persistDevice();
      emit();
      if (!uid) return Promise.resolve();
      const write = kind ? setRecFeedback(uid, { gameId, kind, at }) : deleteRecFeedback(uid, gameId);
      return write.catch((error: unknown) => {
        // The device copy already holds it; the account copy catches up on the next sign-in sync.
        console.warn("[recs] feedback save failed:", error instanceof Error ? error.message : error);
      });
    },
    [uid],
  );

  return { items: visible, ready, set };
}

/** The current opinion on one game, or null. */
export function feedbackFor(list: RecFeedback[], gameId: number): FeedbackKind | null {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].gameId === gameId) return list[i].kind;
  return null;
}
