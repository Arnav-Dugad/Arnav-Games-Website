"use client";

/**
 * Recommendations v2 in the browser: one hook every surface shares (home "For
 * you", `/for-you`, the library's "For your devices", a game page's "More
 * like this").
 *
 * Cloudflare budget shapes it. The answer is ~100 KB and a POST, so browsers
 * never cache it; instead:
 *  - one in-memory answer per profile, shared by every mounted reader, with
 *    one request in flight at most;
 *  - one device slot (localStorage) holding the last answer and its profile
 *    hash for 6 hours — a returning reader with an unchanged library costs no
 *    Worker request at all;
 *  - feedback taps are batched: after a tap the old answer stays on screen
 *    (with the dismissed game filtered out locally) and the new profile is
 *    only requested once the reader pauses.
 *
 * The profile itself is anonymous (`buildTasteProfile`: ids and weights). Its
 * account inputs — reviews and platform/subscription settings — are read from
 * Firestore once per account and kept on the device for 6 hours too.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { getUserProfile, getUserReviews } from "@/lib/firebase/db";
import { readLocalCache, writeLocalCache } from "@/lib/utils/local-cache";
import type { RecommendationsV2, RecommendedGame, RecsProfile } from "@/lib/games/types";
import { useRecFeedback } from "./feedback";
import { buildTasteProfile, hasEnoughTaste, profileKey, type TasteReview } from "./profile";
import { usePersonal } from "@/lib/personal/store";

const TTL_MS = 6 * 60 * 60_000;
/** One device slot, overwritten: old profiles' answers never pile up in storage. */
const DEVICE_SLOT = "recs-v2";
/** How long a changed profile (after feedback) waits for further taps before asking again. */
const SETTLE_MS = 1500;

interface AccountInputs {
  reviews: TasteReview[];
  ownedPlatforms: string[];
  subscriptions: string[];
}

/* ---- account inputs: once per uid, cached on the device ----------------- */

const accountInputs = new Map<string, AccountInputs>();
const accountLoads = new Map<string, Promise<void>>();
const accountListeners = new Set<() => void>();

function loadAccount(uid: string) {
  if (accountInputs.has(uid) || accountLoads.has(uid)) return;
  const cacheKey = `recs-account:${uid}`;
  const cached = readLocalCache<AccountInputs>(cacheKey, TTL_MS);
  if (cached) {
    accountInputs.set(uid, cached);
    return;
  }
  const load = Promise.all([
    getUserReviews(uid).catch(() => []),
    getUserProfile(uid).catch(() => null),
  ]).then(([reviews, profile]) => {
    const inputs: AccountInputs = {
      reviews: reviews.map((review) => ({ gameId: review.gameId, rating: review.rating })),
      ownedPlatforms: profile?.ownedPlatforms ?? [],
      subscriptions: profile?.activeSubscriptions ?? [],
    };
    accountInputs.set(uid, inputs);
    writeLocalCache(cacheKey, inputs);
    accountLoads.delete(uid);
    accountListeners.forEach((listener) => listener());
  });
  accountLoads.set(uid, load);
}

function subscribeAccount(listener: () => void) {
  accountListeners.add(listener);
  return () => {
    accountListeners.delete(listener);
  };
}

/* ---- answers: shared in memory, one device slot ------------------------- */

type Answer = { status: "ready"; data: RecommendationsV2 } | { status: "error" };

const answers = new Map<string, Answer>();
const inflight = new Map<string, Promise<void>>();
const answerListeners = new Set<() => void>();

function emitAnswers() {
  answerListeners.forEach((listener) => listener());
}

function subscribeAnswers(listener: () => void) {
  answerListeners.add(listener);
  return () => {
    answerListeners.delete(listener);
  };
}

/** FNV-1a: a short stable name for a long profile key. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + text.length.toString(36);
}

function fromDevice(id: string): RecommendationsV2 | null {
  const slot = readLocalCache<{ id: string; data: RecommendationsV2 }>(DEVICE_SLOT, TTL_MS);
  return slot && slot.id === id ? slot.data : null;
}

function request(id: string, profile: RecsProfile, force = false) {
  if (!force && (answers.get(id)?.status === "ready" || inflight.has(id))) return;
  const cached = force ? null : fromDevice(id);
  if (cached) {
    answers.set(id, { status: "ready", data: cached });
    emitAnswers();
    return;
  }
  const load = fetch("/api/recommendations/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(profile),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as RecommendationsV2;
      answers.set(id, { status: "ready", data });
      writeLocalCache(DEVICE_SLOT, { id, data });
    })
    .catch((error: unknown) => {
      console.warn("[recs] v2 failed:", error instanceof Error ? error.message : error);
      if (answers.get(id)?.status !== "ready") answers.set(id, { status: "error" });
    })
    .finally(() => {
      inflight.delete(id);
      emitAnswers();
    });
  inflight.set(id, load);
  emitAnswers();
}

/* ---- the hook ------------------------------------------------------------ */

export type RecsView =
  /** Not applicable: signed out on a surface that needs an account, or too little taste. */
  | { status: "off"; reason: "signed-out" | "thin" | "disabled" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; data: RecommendationsV2; refreshing: boolean };

export interface UseRecsOptions {
  /** Default true. Lets a component mount the hook but only ask when it matters. */
  enabled?: boolean;
  /** Ask even without an account or enough taste (quality picks). Default false. */
  anonymous?: boolean;
}

export function useRecommendationsV2({ enabled = true, anonymous = false }: UseRecsOptions = {}) {
  const { user, loading: authLoading } = useAuth();
  const { entries, loading: libraryLoading } = useWatchlist();
  const feedback = useRecFeedback();
  // Hours the reader logged themselves weigh a game up in their taste.
  const own = usePersonal();
  const uid = user?.uid ?? null;

  const account = useSyncExternalStore(
    subscribeAccount,
    () => (uid ? accountInputs.get(uid) ?? null : null),
    () => null,
  );
  useEffect(() => {
    if (uid && enabled) loadAccount(uid);
  }, [uid, enabled]);

  const inputsReady = !authLoading && (!uid || (!libraryLoading && account !== null && feedback.ready && own.ready));

  const profile = useMemo<RecsProfile | null>(() => {
    if (!inputsReady) return null;
    const withHours = entries.map((entry) => (own.playtime[entry.gameId] ? { ...entry, hoursPlayed: own.playtime[entry.gameId] } : entry));
    return buildTasteProfile(uid ? withHours : [], account?.reviews ?? [], feedback.items, {
      ownedPlatforms: account?.ownedPlatforms ?? [],
      subscriptions: account?.subscriptions ?? [],
    });
  }, [inputsReady, uid, entries, account, feedback.items, own.playtime]);

  const personal = Boolean(profile && hasEnoughTaste(profile));
  const wanted = enabled && profile !== null && (personal || anonymous);
  const id = wanted && profile ? hash(profileKey(profile)) : null;

  // The id actually requested. It follows `id` at once when nothing is on
  // screen, and after a pause when feedback just changed the profile.
  const [asked, setAsked] = useState<{ id: string; profile: RecsProfile } | null>(null);
  const answer = useSyncExternalStore(
    subscribeAnswers,
    () => (asked ? answers.get(asked.id) ?? null : null),
    () => null,
  );
  const latest = useSyncExternalStore(
    subscribeAnswers,
    () => (id ? answers.get(id) ?? null : null),
    () => null,
  );

  useEffect(() => {
    if (!id || !profile || asked?.id === id) return;
    const known = answers.get(id)?.status === "ready" || fromDevice(id) !== null;
    const delay = known || !asked || answer?.status !== "ready" ? 0 : SETTLE_MS;
    const timer = window.setTimeout(() => {
      setAsked({ id, profile });
      request(id, profile);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [id, profile, asked, answer]);

  const retry = useCallback(() => {
    if (asked) request(asked.id, asked.profile, true);
  }, [asked]);

  // Hide anything dismissed (or added to the library) since the answer came
  // back, without waiting for the next request.
  const hidden = useMemo(() => {
    const ids = new Set<number>();
    for (const item of feedback.items) if (item.kind === "down" || item.kind === "not-interested") ids.add(item.gameId);
    if (uid) for (const entry of entries) ids.add(entry.gameId);
    return ids;
  }, [feedback.items, entries, uid]);

  const fresh = answer?.status === "ready" ? answer.data : latest?.status === "ready" ? latest.data : null;
  // While a changed profile (after feedback) is being asked about, keep the
  // last answer on screen instead of dropping back to skeletons. Per account:
  // signing in or out never shows the other profile's picks.
  const [kept, setKept] = useState<{ uid: string | null; data: RecommendationsV2 } | null>(null);
  if (fresh && (kept?.data !== fresh || kept.uid !== uid)) setKept({ uid, data: fresh });
  const base = fresh ?? (kept && kept.uid === uid ? kept.data : null);
  const data = useMemo(() => (base ? filterAnswer(base, hidden) : null), [base, hidden]);

  let view: RecsView;
  if (!enabled) view = { status: "off", reason: "disabled" };
  else if (!authLoading && !uid && !anonymous) view = { status: "off", reason: "signed-out" };
  else if (profile && !personal && !anonymous) view = { status: "off", reason: "thin" };
  else if (data) view = { status: "ready", data, refreshing: Boolean(id && asked?.id !== id) || inflight.has(asked?.id ?? "") };
  else if (answer?.status === "error") view = { status: "error", retry };
  else view = { status: "loading" };

  return { view, signedIn: Boolean(uid), personal, feedback, hidden };
}

function filterAnswer(data: RecommendationsV2, hidden: Set<number>): RecommendationsV2 {
  if (hidden.size === 0) return data;
  const keep = (list: RecommendedGame[]) => list.filter((item) => !hidden.has(item.game.id));
  return {
    ...data,
    forYou: keep(data.forYou),
    becauseYouLiked: data.becauseYouLiked
      .map((group) => ({ ...group, games: keep(group.games) }))
      .filter((group) => group.games.length > 0),
    hiddenGems: keep(data.hiddenGems),
    newForYou: keep(data.newForYou),
    comingSoonForYou: keep(data.comingSoonForYou),
    onYourDevices: keep(data.onYourDevices),
  };
}
