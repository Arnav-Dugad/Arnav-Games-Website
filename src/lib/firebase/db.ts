/**
 * Firestore access layer.
 *
 * Data model (user data; see `firestore.rules` for who may read/write what)
 *   users/{uid}                        profile document
 *   users/{uid}/watchlist/{gameId}     one doc per tracked game
 *   users/{uid}/settings/preferences   display + device preferences, mirrored
 *   reviews/{gameId}__{uid}            one review per user per game
 *
 * Public statistics (player/Twitch/review/score/price/release history) live
 * in their own read-only collections, written only by the server — see
 * `src/lib/games/stats-docs.ts`.
 *
 * Reviews are top-level rather than nested under the game so they can be
 * queried both ways (by game, and by author for the profile page) without
 * duplicating writes. Ordering is done in memory instead of with `orderBy`,
 * which keeps the app working on a fresh project with no composite indexes
 * configured — a deliberate trade at these collection sizes.
 */

import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./config";
import type { GameDetail, GameSummary, UserPcSpecs } from "@/lib/games/types";
import { releaseState } from "@/lib/games/release-state";

export type WatchStatus = "none" | "want" | "playing" | "played";
export const LIBRARY_SCHEMA_VERSION = 3;

export interface SubscriptionAccess {
  /** Stable service slug, for example `game-pass` or `playstation-plus`. */
  service: string;
  /** Platform family used for this play-through. */
  platform: string;
}

export interface FollowedRelease {
  gameId: number;
  slug: string;
  name: string;
  kind: "dlc" | "expansion";
  released: string | null;
  releaseWindow: string | null;
  image: string | null;
  imageFallback: string | null;
}

export interface WatchlistEntry {
  gameId: number;
  /** Direct storefront id when known; older records legitimately omit it. */
  steamAppId?: number | null;
  slug: string;
  name: string;
  image: string | null;
  /** Poster fallback, mirroring `GameSummary`. See `GameCover`. */
  imageFallback: string | null;
  released: string | null;
  /** Imprecise-but-known window, e.g. "Q4 2026". See `GameSummary`. */
  releaseWindow: string | null;
  tba: boolean;
  metacritic: number | null;
  /** Following controls release/DLC notifications; it never owns the record. */
  following: boolean;
  /** Explicit membership in the saved-games watchlist. Independent from alerts and ownership. */
  watchlisted: boolean;
  /** Versioned catalogue snapshot metadata, refreshed from IGDB in the background. */
  metadataVersion: number;
  metadataUpdatedAt: number;
  /** Main-story completion time in hours when the provider knows it. */
  playtime?: number;
  status: WatchStatus;
  /**
   * Which platform the user played (or intends to play) this on — a family
   * slug such as "playstation". Null until they say.
   */
  platform: string | null;
  /** Epoch ms, set when the status first moves to "playing". */
  startedAt: number | null;
  /** Epoch ms, set when the status first moves to "played". */
  finishedAt: number | null;
  /**
   * Genre ids copied from the game at save time. Denormalised deliberately:
   * the recommendation engine needs a taste profile without fetching detail
   * pages for every tracked game.
   */
  genreIds: number[];
  /** Genre labels kept with the record so personal analytics remain useful offline. */
  genres?: Array<{ id: number; slug: string; name: string }>;
  /** Platform family slugs the game is available on. */
  platformSlugs: string[];
  /**
   * Storefronts/platforms the user actually owns this on — e.g. ["steam",
   * "playstation"]. Distinct from `platform`, which records where they *played*
   * it: people routinely own a game somewhere they've never launched it, and
   * own the same game in more than one place.
   */
  ownedOn: string[];
  /** Subscription services used to play this game, paired with the platform. */
  subscriptionAccess: SubscriptionAccess[];
  /** DLC/expansion snapshot used by both in-app and scheduled notifications. */
  followedReleases: FollowedRelease[];
  /** Epoch ms. Written client-side so the list can sort before the server timestamp lands. */
  addedAt: number;
}

/** A Firestore document may remain as a harmless tombstone after its last signal is cleared. */
export function hasPersonalGameData(entry: WatchlistEntry): boolean {
  return entry.watchlisted
    || entry.following
    || entry.status !== "none"
    || (entry.ownedOn ?? []).length > 0
    || (entry.subscriptionAccess ?? []).length > 0;
}

export interface Review {
  id: string;
  gameId: number;
  slug: string;
  gameName: string;
  uid: string;
  author: string;
  photoURL: string | null;
  /** 1–10, matching the detail page's scoring scale. */
  rating: number;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  bio: string;
  favouriteGenre: string | null;
  /** Exact systems and storefront ecosystems the player has access to. */
  ownedPlatforms: string[];
  /** Subscription services the player currently uses. */
  activeSubscriptions: string[];
  /** Optional public-facing gaming handle. */
  gamerTag: string;
  /** Broad play-style preference used only for profile presentation. */
  playStyle: "casual" | "balanced" | "dedicated" | "competitive" | null;
  createdAt: number;
}

/**
 * Account-level display preferences.
 *
 * Mirrored from `localStorage` rather than replacing it. The device copy is
 * what makes preferences work signed-out and available synchronously on the
 * first paint; this copy is what makes them follow the account to a new
 * browser or phone. Neither alone covers both cases.
 *
 * Every field is optional: a profile written before a preference existed must
 * stay readable, and a partial write must never blank a key it didn't set.
 */
export interface UserPreferences {
  /** User-level motion opt-out, on top of the OS setting. */
  reduceMotion?: boolean;
  /**
   * Poster density on the collection pages, keyed by page.
   *
   * A map rather than a single value because the right density genuinely
   * differs per page — a watchlist is usually read as a list with inline
   * controls, a library as a wall of covers.
   */
  posterSizes?: Record<string, string>;
  /** Stable derived-notification ids already seen by this account. */
  notificationReadIds?: string[];
  notificationReleases?: boolean;
  /** Appearance. "system" follows the device's light/dark setting. */
  theme?: "system" | "light" | "dark";
  /** An explicitly chosen price country (ISO alpha-2); null = automatic. */
  priceRegion?: string | null;
  /** The reader's own PC, for "Will it run?"; null = not entered. */
  pcSpecs?: UserPcSpecs | null;
  /** Newest first, at most 8. */
  recentSearches?: string[];
  /** "Best buys this month" budget, in minor units of `currency`. */
  wishlistBudget?: { currency: string; amount: number } | null;
  updatedAt?: number;
}

const reviewId = (gameId: number, uid: string) => `${gameId}__${uid}`;

/** Every write goes through this so a null db (unconfigured) is a clean error. */
function requireDb() {
  const db = getDb();
  if (!db) throw new Error("Firebase is not configured.");
  return db;
}

/* ---------------------------------------------------------------------------
 * Profiles
 * ------------------------------------------------------------------------ */

export async function ensureUserProfile(input: {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}): Promise<void> {
  const db = getDb();
  if (!db) return;
  const ref = doc(db, "users", input.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;

  const profile: UserProfile = {
    uid: input.uid,
    displayName: input.displayName?.trim() || input.email?.split("@")[0] || "Player",
    email: input.email,
    photoURL: input.photoURL,
    bio: "",
    favouriteGenre: null,
    ownedPlatforms: [],
    activeSubscriptions: [],
    gamerTag: "",
    playStyle: null,
    createdAt: Date.now(),
  };
  await setDoc(ref, { ...profile, createdAtServer: serverTimestamp() });
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const db = getDb();
  if (!db) return null;
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const data = snap.data() as UserProfile;
  return {
    ...data,
    ownedPlatforms: data.ownedPlatforms ?? [],
    activeSubscriptions: data.activeSubscriptions ?? [],
    gamerTag: data.gamerTag ?? "",
    playStyle: data.playStyle ?? null,
  };
}

export async function updateUserProfile(
  uid: string,
  patch: Partial<Pick<UserProfile, "displayName" | "bio" | "favouriteGenre" | "photoURL" | "ownedPlatforms" | "activeSubscriptions" | "gamerTag" | "playStyle">>,
): Promise<void> {
  const db = requireDb();
  await updateDoc(doc(db, "users", uid), { ...patch, updatedAt: serverTimestamp() });
}

/* ---------------------------------------------------------------------------
 * Preferences
 * ------------------------------------------------------------------------ */

/**
 * Reads account preferences.
 *
 * Returns null rather than throwing when Firebase is unconfigured or the
 * profile predates preferences, so the caller can simply fall back to whatever
 * the device already knows.
 */
export async function getUserPreferences(uid: string): Promise<UserPreferences | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, "users", uid, "settings", "preferences"));
    return snap.exists() ? (snap.data() as UserPreferences) : null;
  } catch (err) {
    console.warn("[prefs] read failed", err);
    return null;
  }
}

/**
 * Merges a preference patch into the account.
 *
 * `merge: true` matters: preferences are written from several places (settings
 * page, a region change on a game page), and a whole-document write from one of
 * them would silently clear whatever the others had set.
 */
export async function saveUserPreferences(
  uid: string,
  patch: UserPreferences,
  options: { dropPosterSizeKeys?: string[] } = {},
): Promise<void> {
  const db = getDb();
  if (!db) return;
  // A merge write deep-merges maps, so removing a poster-size key needs an
  // explicit field delete (used once, to retire the old budget key).
  const drops = options.dropPosterSizeKeys?.length
    ? Object.fromEntries(options.dropPosterSizeKeys.map((key) => [key, deleteField()]))
    : null;
  const posterSizes = drops ? { ...patch.posterSizes, ...drops } : patch.posterSizes;
  await setDoc(
    doc(db, "users", uid, "settings", "preferences"),
    { ...patch, ...(posterSizes ? { posterSizes } : {}), updatedAt: Date.now(), updatedAtServer: serverTimestamp() },
    { merge: true },
  );
}

/* ---------------------------------------------------------------------------
 * Watchlist
 * ------------------------------------------------------------------------ */

function followedReleasesFromGame(game: GameSummary): FollowedRelease[] {
  const detail = game as Partial<Pick<GameDetail, "dlcs" | "expansions" | "standaloneExpansions">>;
  const releases = [
    ...(detail.dlcs ?? []).map((entry) => ({ entry, kind: "dlc" as const })),
    ...(detail.expansions ?? []).map((entry) => ({ entry, kind: "expansion" as const })),
    ...(detail.standaloneExpansions ?? []).map((entry) => ({ entry, kind: "expansion" as const })),
  ];
  const seen = new Set<number>();
  return releases.flatMap(({ entry, kind }) => {
    if (seen.has(entry.id)) return [];
    seen.add(entry.id);
    return [{
      gameId: entry.id,
      slug: entry.slug,
      name: entry.name,
      kind,
      released: entry.released,
      releaseWindow: entry.releaseWindow,
      image: entry.image,
      imageFallback: entry.imageFallback,
    }];
  });
}

/** Catalogue-owned fields only. Never include personal state in this patch. */
export function gameMetadataPatch(game: GameSummary): Partial<WatchlistEntry> {
  const steamSlugMatch = game.slug.match(/-s(\d+)$/);
  const steamAppId = "steamAppId" in game && typeof game.steamAppId === "number"
    ? game.steamAppId
    : steamSlugMatch?.[1] ? Number(steamSlugMatch[1]) : null;
  const hasRelatedReleases = "dlcs" in game
    || "expansions" in game
    || "standaloneExpansions" in game;
  return {
    gameId: game.id,
    steamAppId,
    slug: game.slug,
    name: game.name,
    image: game.image,
    imageFallback: game.imageFallback,
    released: game.released,
    releaseWindow: game.releaseWindow,
    tba: game.tba,
    metacritic: game.metacritic,
    playtime: game.playtime,
    genreIds: game.genres.map((genre) => genre.id),
    genres: game.genres.map(({ id, slug, name }) => ({ id, slug, name })),
    platformSlugs: game.parentPlatforms.map((platform) => platform.slug),
    // Summary responses do not contain DLC relationships. Omitting this field
    // preserves a richer snapshot written from the detail page.
    ...(hasRelatedReleases ? { followedReleases: followedReleasesFromGame(game) } : {}),
    metadataVersion: LIBRARY_SCHEMA_VERSION,
    metadataUpdatedAt: Date.now(),
  };
}

export function watchlistEntryFromGame(
  game: GameSummary,
  status: WatchStatus,
  following = false,
): WatchlistEntry {
  return {
    ...gameMetadataPatch(game),
    gameId: game.id,
    slug: game.slug,
    name: game.name,
    image: game.image,
    imageFallback: game.imageFallback,
    released: game.released,
    releaseWindow: game.releaseWindow,
    tba: game.tba,
    metacritic: game.metacritic,
    following,
    watchlisted: status === "want",
    metadataVersion: LIBRARY_SCHEMA_VERSION,
    metadataUpdatedAt: Date.now(),
    playtime: game.playtime,
    status,
    platform: null,
    startedAt: status === "playing" ? Date.now() : null,
    finishedAt: status === "played" ? Date.now() : null,
    ownedOn: [],
    subscriptionAccess: [],
    followedReleases: followedReleasesFromGame(game),
    genreIds: game.genres.map((genre) => genre.id),
    genres: game.genres.map(({ id, slug, name }) => ({ id, slug, name })),
    platformSlugs: game.parentPlatforms.map((platform) => platform.slug),
    addedAt: Date.now(),
  };
}

/** Creates a personal game record without implicitly following it. */
export async function ensureWatchlistEntry(
  uid: string,
  game: GameSummary,
  status: WatchStatus = "none",
): Promise<void> {
  const db = requireDb();
  const ref = doc(db, "users", uid, "watchlist", String(game.id));
  const snap = await getDoc(ref);
  if (!snap.exists()) await setDoc(ref, watchlistEntryFromGame(game, status, false));
  else await setDoc(ref, gameMetadataPatch(game), { merge: true });
}

/** Following is independent from ownership and progress, so unfollowing is lossless. */
export async function setGameFollowing(
  uid: string,
  game: GameSummary,
  following: boolean,
  exists: boolean,
): Promise<void> {
  const db = requireDb();
  const ref = doc(db, "users", uid, "watchlist", String(game.id));
  if (!exists) {
    await setDoc(ref, watchlistEntryFromGame(game, "none", following));
    return;
  }
  await setDoc(ref, {
    ...gameMetadataPatch(game),
    following,
  }, { merge: true });
}

export async function setGameWatchlisted(
  uid: string,
  game: GameSummary,
  watchlisted: boolean,
  exists: boolean,
): Promise<void> {
  const db = requireDb();
  const ref = doc(db, "users", uid, "watchlist", String(game.id));
  if (!exists) {
    const entry = watchlistEntryFromGame(game, "none", false);
    await setDoc(ref, { ...entry, watchlisted });
    return;
  }
  await setDoc(ref, { ...gameMetadataPatch(game), watchlisted }, { merge: true });
}

export async function addToWatchlist(uid: string, entry: WatchlistEntry): Promise<void> {
  const db = requireDb();
  await setDoc(doc(db, "users", uid, "watchlist", String(entry.gameId)), entry);
}

export async function removeFromWatchlist(uid: string, gameId: number): Promise<void> {
  const db = requireDb();
  await updateDoc(doc(db, "users", uid, "watchlist", String(gameId)), {
    watchlisted: false,
  });
}

/**
 * Updates play status, stamping the first transition into each state.
 *
 * Timestamps are only ever written once — re-marking something as "playing"
 * after finishing it shouldn't rewrite when you originally started.
 */
export async function setWatchStatus(
  uid: string,
  gameId: number,
  status: WatchStatus,
  current?: WatchlistEntry,
): Promise<void> {
  const db = requireDb();
  const patch: Record<string, unknown> = {
    status,
    ...(status === "want" ? { watchlisted: true } : {}),
  };
  if (status === "playing" && !current?.startedAt) patch.startedAt = Date.now();
  if (status === "played" && !current?.finishedAt) patch.finishedAt = Date.now();
  await updateDoc(doc(db, "users", uid, "watchlist", String(gameId)), patch);
}

/**
 * Records where the user owns a game.
 *
 * Written as a whole array rather than an arrayUnion so removing an entry uses
 * the same path as adding one, and so the caller's optimistic state and the
 * stored value can never diverge in shape.
 */
export async function setOwnedOn(
  uid: string,
  gameId: number,
  ownedOn: string[],
): Promise<void> {
  const db = requireDb();
  await updateDoc(doc(db, "users", uid, "watchlist", String(gameId)), {
    ownedOn: [...new Set(ownedOn)],
  });
}

export async function setSubscriptionAccess(
  uid: string,
  gameId: number,
  access: SubscriptionAccess[],
): Promise<void> {
  const db = requireDb();
  const unique = new Map(access.map((item) => [`${item.service}:${item.platform}`, item]));
  await updateDoc(doc(db, "users", uid, "watchlist", String(gameId)), {
    subscriptionAccess: [...unique.values()],
  });
}

/** Records which platform the user is playing a tracked game on. */
export async function setWatchPlatform(
  uid: string,
  gameId: number,
  platform: string | null,
): Promise<void> {
  const db = requireDb();
  await updateDoc(doc(db, "users", uid, "watchlist", String(gameId)), { platform });
}

export type BatchLibraryChange =
  | { kind: "status"; value: WatchStatus }
  | { kind: "ownership-add"; value: string }
  | { kind: "ownership-remove"; value: string }
  | { kind: "watchlisted"; value: boolean }
  | { kind: "following"; value: boolean }
  | { kind: "platform"; value: string | null }
  | { kind: "subscriptions-clear" };

export function batchPatchForEntry(
  entry: WatchlistEntry,
  change: BatchLibraryChange,
  now = Date.now(),
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (change.kind === "status") {
    patch.status = change.value;
    if (change.value === "want") patch.watchlisted = true;
    if (change.value === "playing" && !entry.startedAt) patch.startedAt = now;
    if (change.value === "played" && !entry.finishedAt) patch.finishedAt = now;
  } else if (change.kind === "ownership-add") {
    patch.ownedOn = [...new Set([...(entry.ownedOn ?? []), change.value])];
  } else if (change.kind === "ownership-remove") {
    patch.ownedOn = (entry.ownedOn ?? []).filter((slug) => slug !== change.value);
  } else if (change.kind === "watchlisted") {
    patch.watchlisted = change.value;
  } else if (change.kind === "following") {
    patch.following = change.value;
  } else if (change.kind === "platform") {
    patch.platform = change.value;
  } else {
    patch.subscriptionAccess = [];
  }
  return patch;
}

/** Applies one explicit personal-state change to many unique games atomically per chunk. */
export async function batchUpdateLibraryEntries(
  uid: string,
  entries: WatchlistEntry[],
  change: BatchLibraryChange,
): Promise<void> {
  const db = requireDb();
  const unique = [...new Map(entries.map((entry) => [entry.gameId, entry])).values()];
  if (
    change.kind === "status"
    && (change.value === "playing" || change.value === "played")
    && unique.some((entry) => releaseState(entry) === "upcoming")
  ) {
    throw new Error("Playing or Played cannot be applied to unreleased or TBA games.");
  }
  for (let offset = 0; offset < unique.length; offset += 400) {
    const batch = writeBatch(db);
    for (const entry of unique.slice(offset, offset + 400)) {
      const patch = batchPatchForEntry(entry, change);
      batch.set(doc(db, "users", uid, "watchlist", String(entry.gameId)), patch, { merge: true });
    }
    await batch.commit();
  }
}

/** Repairs stale catalogue snapshots while preserving every personal field. */
export async function syncWatchlistMetadata(uid: string, games: GameSummary[]): Promise<void> {
  const db = requireDb();
  for (let offset = 0; offset < games.length; offset += 400) {
    const batch = writeBatch(db);
    for (const game of games.slice(offset, offset + 400)) {
      batch.set(
        doc(db, "users", uid, "watchlist", String(game.id)),
        gameMetadataPatch(game),
        { merge: true },
      );
    }
    await batch.commit();
  }
}

/** Live watchlist. Returns a no-op unsubscribe when Firebase is unconfigured. */
export function subscribeWatchlist(
  uid: string,
  onChange: (entries: WatchlistEntry[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const db = getDb();
  if (!db) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, "users", uid, "watchlist"),
    (snap) => {
      // Documents written before `releaseWindow` existed omit the field
      // entirely, so normalise it rather than letting `undefined` reach the UI.
      const entries = snap.docs.map((d) => {
        const data = d.data() as WatchlistEntry;
        // Documents predate several fields; normalise rather than letting
        // `undefined` reach the UI or the recommendation profile.
        return {
          ...data,
          steamAppId: data.steamAppId ?? null,
          // Legacy watchlist records represented follows. Preserve that intent
          // while all new personal records opt in explicitly.
          following: data.following ?? true,
          watchlisted: data.watchlisted ?? true,
          metadataVersion: data.metadataVersion ?? 0,
          metadataUpdatedAt: data.metadataUpdatedAt ?? 0,
          status: ["none", "want", "playing", "played"].includes(data.status)
            ? data.status
            : "none",
          releaseWindow: data.releaseWindow ?? null,
          imageFallback: data.imageFallback ?? null,
          platform: data.platform ?? null,
          startedAt: data.startedAt ?? null,
          finishedAt: data.finishedAt ?? null,
          genreIds: data.genreIds ?? [],
          genres: data.genres ?? [],
          ownedOn: data.ownedOn ?? [],
          subscriptionAccess: data.subscriptionAccess ?? [],
          followedReleases: data.followedReleases ?? [],
          platformSlugs: data.platformSlugs ?? [],
        };
      }).filter(hasPersonalGameData);
      entries.sort((a, b) => b.addedAt - a.addedAt);
      onChange(entries);
    },
    (err) => onError?.(err),
  );
}

/* ---------------------------------------------------------------------------
 * Reviews
 * ------------------------------------------------------------------------ */

export async function upsertReview(input: {
  gameId: number;
  slug: string;
  gameName: string;
  uid: string;
  author: string;
  photoURL: string | null;
  rating: number;
  body: string;
}): Promise<void> {
  const db = requireDb();
  const id = reviewId(input.gameId, input.uid);
  const ref = doc(db, "reviews", id);
  const existing = await getDoc(ref);
  const now = Date.now();

  const review: Review = {
    id,
    gameId: input.gameId,
    slug: input.slug,
    gameName: input.gameName,
    uid: input.uid,
    author: input.author,
    photoURL: input.photoURL,
    rating: Math.min(10, Math.max(1, Math.round(input.rating))),
    body: input.body.trim().slice(0, 4000),
    createdAt: existing.exists() ? (existing.data() as Review).createdAt : now,
    updatedAt: now,
  };
  await setDoc(ref, review);
}

export async function deleteReview(gameId: number, uid: string): Promise<void> {
  const db = requireDb();
  await deleteDoc(doc(db, "reviews", reviewId(gameId, uid)));
}

export function subscribeGameReviews(
  gameId: number,
  onChange: (reviews: Review[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const db = getDb();
  if (!db) {
    onChange([]);
    return () => {};
  }
  const q = query(collection(db, "reviews"), where("gameId", "==", gameId), fsLimit(200));
  return onSnapshot(
    q,
    (snap) => {
      const reviews = snap.docs.map((d) => d.data() as Review);
      reviews.sort((a, b) => b.updatedAt - a.updatedAt);
      onChange(reviews);
    },
    (err) => onError?.(err),
  );
}

export async function getUserReviews(uid: string): Promise<Review[]> {
  const db = getDb();
  if (!db) return [];
  const q = query(collection(db, "reviews"), where("uid", "==", uid), fsLimit(200));
  const snap = await getDocs(q);
  const reviews = snap.docs.map((d) => d.data() as Review);
  reviews.sort((a, b) => b.updatedAt - a.updatedAt);
  return reviews;
}

/** Mean of the community scores, rounded to one decimal. */
export function averageRating(reviews: Review[]): number | null {
  if (reviews.length === 0) return null;
  const total = reviews.reduce((sum, r) => sum + r.rating, 0);
  return Math.round((total / reviews.length) * 10) / 10;
}

/* ---------------------------------------------------------------------------
 * Recommendation feedback
 * ------------------------------------------------------------------------ */

/**
 * users/{uid}/feedback/{gameId} — one opinion per game on a recommendation.
 * Read once per session (see `src/lib/recs/feedback.ts`, which also keeps a
 * device copy so signed-out readers can tune picks too).
 */
export interface StoredRecFeedback {
  gameId: number;
  kind: "up" | "down" | "not-interested" | "ignored";
  at: number;
}

export async function getRecFeedback(uid: string): Promise<StoredRecFeedback[]> {
  const db = getDb();
  if (!db) return [];
  const snap = await getDocs(query(collection(db, "users", uid, "feedback"), fsLimit(400)));
  return snap.docs.map((d) => d.data() as StoredRecFeedback).filter((item) => item.gameId > 0);
}

export async function setRecFeedback(uid: string, item: StoredRecFeedback): Promise<void> {
  const db = requireDb();
  await setDoc(doc(db, "users", uid, "feedback", String(item.gameId)), {
    gameId: item.gameId,
    kind: item.kind,
    at: Math.round(item.at),
  });
}

export async function deleteRecFeedback(uid: string, gameId: number): Promise<void> {
  const db = requireDb();
  await deleteDoc(doc(db, "users", uid, "feedback", String(gameId)));
}
