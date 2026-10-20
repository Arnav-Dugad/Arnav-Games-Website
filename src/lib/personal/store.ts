"use client";

/**
 * The reader's own play records: a play journal (session notes with a mood
 * and optional hours) and personal hours per game.
 *
 *   users/{uid}/journal/{entryId}   one session note (see firestore.rules)
 *   users/{uid}/playtime/{gameId}   { gameId, hours, updatedAt }
 *   users/{uid}/purchases/{gameId}  what they paid (see `spend.ts`)
 *
 * Read straight from Firestore in the browser (no Worker request), once per
 * account per session, and kept on the device so the next visit paints
 * instantly. Writes are optimistic: the device copy changes first and is
 * rolled back if Firestore refuses.
 *
 * Logging a session with hours also adds them to that game's total, so a
 * journal kept honestly becomes a playtime record without double entry.
 */

import { useEffect, useSyncExternalStore } from "react";
import { collection, deleteDoc, doc, getDocs, limit, orderBy, query, setDoc, writeBatch } from "firebase/firestore";
import { getDb } from "@/lib/firebase/config";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";
import { validPurchase, type Purchase } from "./spend";

export const MOODS = ["great", "good", "okay", "meh", "frustrated"] as const;
export type Mood = (typeof MOODS)[number];
export const MOOD_LABEL: Record<Mood, string> = { great: "Loved it", good: "Good", okay: "Okay", meh: "Meh", frustrated: "Frustrated" };

export interface JournalEntry {
  id: string;
  gameId: number;
  slug: string;
  name: string;
  image: string | null;
  note: string;
  mood: Mood;
  /** Session length, when given. */
  hours: number | null;
  /** Epoch ms. */
  at: number;
}

export interface GameRef {
  id: number;
  slug: string;
  name: string;
  image: string | null;
}

interface PersonalState {
  uid: string;
  status: "loading" | "ready" | "error";
  journal: JournalEntry[];
  /** gameId → hours. */
  playtime: Record<number, number>;
  /** gameId → what they paid. */
  purchases: Record<number, Purchase>;
}

/** Newest 300 entries is plenty for every view and keeps the read bounded. */
const JOURNAL_LIMIT = 300;
export const NOTE_MAX = 1000;
export const SESSION_MAX_HOURS = 48;
export const PLAYTIME_MAX_HOURS = 100_000;

let state: PersonalState | null = null;
const listeners = new Set<() => void>();
const loading = new Set<string>();

const deviceKey = (uid: string) => `${STORAGE_PREFIX}personal:${uid}`;

function emit() {
  for (const listener of listeners) listener();
}

function set(next: PersonalState) {
  state = next;
  try {
    window.localStorage.setItem(deviceKey(next.uid), JSON.stringify({ journal: next.journal, playtime: next.playtime, purchases: next.purchases }));
  } catch {
    /* storage full or blocked: the in-memory copy still works */
  }
  emit();
}

function validEntry(value: unknown): value is JournalEntry {
  const entry = value as JournalEntry;
  return (
    typeof entry?.id === "string" &&
    typeof entry.gameId === "number" &&
    typeof entry.slug === "string" &&
    typeof entry.name === "string" &&
    typeof entry.note === "string" &&
    (MOODS as readonly string[]).includes(entry.mood) &&
    typeof entry.at === "number"
  );
}

function fromDevice(uid: string): PersonalState | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(deviceKey(uid)) ?? "null") as { journal?: unknown[]; playtime?: Record<string, unknown>; purchases?: Record<string, unknown> } | null;
    if (!raw) return null;
    const playtime: Record<number, number> = {};
    for (const [id, hours] of Object.entries(raw.playtime ?? {})) if (typeof hours === "number" && hours > 0) playtime[Number(id)] = hours;
    const purchases: Record<number, Purchase> = {};
    for (const value of Object.values(raw.purchases ?? {})) if (validPurchase(value)) purchases[value.gameId] = value;
    return { uid, status: "loading", journal: (raw.journal ?? []).filter(validEntry), playtime, purchases };
  } catch {
    return null;
  }
}

async function load(uid: string) {
  if (loading.has(uid)) return;
  const db = getDb();
  if (!db) return;
  loading.add(uid);
  if (state?.uid !== uid) set(fromDevice(uid) ?? { uid, status: "loading", journal: [], playtime: {}, purchases: {} });
  try {
    const [journalSnap, playtimeSnap, purchaseSnap] = await Promise.all([
      getDocs(query(collection(db, "users", uid, "journal"), orderBy("at", "desc"), limit(JOURNAL_LIMIT))),
      getDocs(collection(db, "users", uid, "playtime")),
      // Rules for purchases may deploy after this code: a refusal leaves the
      // spending tracker empty rather than failing the journal with it.
      getDocs(collection(db, "users", uid, "purchases")).catch(() => null),
    ]);
    const journal = journalSnap.docs.map((snap): unknown => ({ image: null, hours: null, ...snap.data(), id: snap.id })).filter(validEntry);
    const playtime: Record<number, number> = {};
    for (const snap of playtimeSnap.docs) {
      const hours = snap.data().hours;
      if (typeof hours === "number" && hours > 0) playtime[Number(snap.id)] = hours;
    }
    const purchases: Record<number, Purchase> = purchaseSnap ? {} : { ...(state?.uid === uid ? state.purchases : {}) };
    for (const snap of purchaseSnap?.docs ?? []) {
      const value = snap.data();
      if (validPurchase(value)) purchases[value.gameId] = value;
    }
    if (state?.uid === uid) set({ uid, status: "ready", journal, playtime, purchases });
  } catch (error) {
    // Rules not deployed yet, offline, or quota: keep the device copy.
    console.warn("[personal] load failed:", error instanceof Error ? error.message : error);
    if (state?.uid === uid) set({ ...state, status: "error" });
    loading.delete(uid);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: Omit<PersonalState, "uid"> = { status: "loading", journal: [], playtime: {}, purchases: {} };

export interface Personal {
  /** Null when signed out (or Firebase isn't configured). */
  uid: string | null;
  ready: boolean;
  journal: JournalEntry[];
  playtime: Record<number, number>;
  purchases: Record<number, Purchase>;
}

/** The signed-in reader's journal and hours. Loads once per account per session. */
export function usePersonal(): Personal {
  const { user, enabled } = useAuth();
  const uid = enabled ? user?.uid ?? null : null;
  const snapshot = useSyncExternalStore(subscribe, () => state, () => null);
  useEffect(() => {
    if (uid) void load(uid);
  }, [uid]);
  const own = uid && snapshot?.uid === uid ? snapshot : null;
  return {
    uid,
    ready: own ? own.status !== "loading" : !uid,
    journal: own?.journal ?? EMPTY.journal,
    playtime: own?.playtime ?? EMPTY.playtime,
    purchases: own?.purchases ?? EMPTY.purchases,
  };
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("Saving isn't available on this deployment.");
  return db;
}

const roundHours = (hours: number) => Math.round(hours * 10) / 10;

/** Sets a game's total hours (0 clears it). */
export async function setPlaytime(uid: string, gameId: number, hours: number): Promise<void> {
  const db = requireDb();
  const value = Math.min(PLAYTIME_MAX_HOURS, Math.max(0, roundHours(hours)));
  const before = state;
  if (state?.uid === uid) {
    const playtime = { ...state.playtime };
    if (value > 0) playtime[gameId] = value;
    else delete playtime[gameId];
    set({ ...state, playtime });
  }
  try {
    const ref = doc(db, "users", uid, "playtime", String(gameId));
    if (value > 0) await setDoc(ref, { gameId, hours: value, updatedAt: Date.now() });
    else await deleteDoc(ref);
  } catch (error) {
    if (before) set(before);
    throw error;
  }
}

/**
 * Hours from an import (Steam), merged so nothing already recorded shrinks:
 * each game keeps the larger of its current total and the imported one.
 * Batched — a big library is a few commits, not hundreds of round trips.
 */
export async function importPlaytime(uid: string, hours: Record<number, number>): Promise<number> {
  const db = requireDb();
  const current = state?.uid === uid ? state.playtime : {};
  const changes = Object.entries(hours)
    .map(([id, value]) => [Number(id), Math.min(PLAYTIME_MAX_HOURS, roundHours(value))] as const)
    .filter(([id, value]) => id !== 0 && value > 0 && value > (current[id] ?? 0));
  for (let offset = 0; offset < changes.length; offset += 400) {
    const batch = writeBatch(db);
    for (const [gameId, value] of changes.slice(offset, offset + 400)) {
      batch.set(doc(db, "users", uid, "playtime", String(gameId)), { gameId, hours: value, updatedAt: Date.now() });
    }
    await batch.commit();
  }
  if (state?.uid === uid && changes.length) set({ ...state, playtime: { ...state.playtime, ...Object.fromEntries(changes) } });
  return changes.length;
}

/**
 * Records (or, with null, forgets) what the reader paid for a game. One
 * purchase per game: the document id is the game id.
 */
export async function setPurchase(uid: string, gameId: number, purchase: Omit<Purchase, "gameId" | "updatedAt"> | null): Promise<void> {
  const db = requireDb();
  const ref = doc(db, "users", uid, "purchases", String(gameId));
  const before = state;
  const next: Purchase | null = purchase ? { ...purchase, gameId, updatedAt: Date.now() } : null;
  if (next && !validPurchase(next)) throw new Error("That price couldn't be saved.");
  if (state?.uid === uid) {
    const purchases = { ...state.purchases };
    if (next) purchases[gameId] = next;
    else delete purchases[gameId];
    set({ ...state, purchases });
  }
  try {
    if (next) await setDoc(ref, next);
    else await deleteDoc(ref);
  } catch (error) {
    if (before) set(before);
    throw error;
  }
}

/** Adds a session note; its hours (if any) are added to the game's total. */
export async function addJournalEntry(
  uid: string,
  game: GameRef,
  input: { note: string; mood: Mood; hours: number | null },
): Promise<JournalEntry> {
  const db = requireDb();
  const ref = doc(collection(db, "users", uid, "journal"));
  const hours = input.hours && input.hours > 0 ? Math.min(SESSION_MAX_HOURS, roundHours(input.hours)) : null;
  const entry: JournalEntry = {
    id: ref.id,
    gameId: game.id,
    slug: game.slug.slice(0, 200),
    name: game.name.slice(0, 200),
    image: game.image && game.image.length <= 2048 ? game.image : null,
    note: input.note.trim().slice(0, NOTE_MAX),
    mood: input.mood,
    hours,
    at: Date.now(),
  };
  const before = state;
  if (state?.uid === uid) set({ ...state, journal: [entry, ...state.journal] });
  try {
    const { id: _id, ...data } = entry;
    void _id;
    await setDoc(ref, data);
  } catch (error) {
    if (before) set(before);
    throw error;
  }
  if (hours) await setPlaytime(uid, game.id, (state?.playtime[game.id] ?? 0) + hours).catch(() => undefined);
  return entry;
}

/** Removes a note, and takes its hours back off the game's total. */
export async function deleteJournalEntry(uid: string, entry: JournalEntry): Promise<void> {
  const db = requireDb();
  const before = state;
  if (state?.uid === uid) set({ ...state, journal: state.journal.filter((item) => item.id !== entry.id) });
  try {
    await deleteDoc(doc(db, "users", uid, "journal", entry.id));
  } catch (error) {
    if (before) set(before);
    throw error;
  }
  if (entry.hours) await setPlaytime(uid, entry.gameId, Math.max(0, (state?.playtime[entry.gameId] ?? 0) - entry.hours)).catch(() => undefined);
}

/* -------------------------------------------------------------------------- */
/* "Log a session" from anywhere                                              */
/* -------------------------------------------------------------------------- */

export const LOG_SESSION_EVENT = "arnav-games:log-session";
export const EDIT_PURCHASE_EVENT = "arnav-games:edit-purchase";

/** Opens the session sheet (mounted once by `SessionLogHost`) for a game. */
export function openSessionLog(game: GameRef) {
  window.dispatchEvent(new CustomEvent<GameRef>(LOG_SESSION_EVENT, { detail: game }));
}

/** Opens the "What you paid" sheet (mounted once by `SessionLogHost`) for a game. */
export function openPurchaseEditor(game: GameRef) {
  window.dispatchEvent(new CustomEvent<GameRef>(EDIT_PURCHASE_EVENT, { detail: game }));
}
