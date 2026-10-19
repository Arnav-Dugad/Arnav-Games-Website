/**
 * Firebase bootstrap.
 *
 * Two rules govern this file:
 *
 * 1. It must never throw when the env vars are absent. The app ships before
 *    Firebase is configured, and an unconfigured build has to render — auth UI
 *    simply reports itself as unavailable instead of crashing the route.
 * 2. Nothing initialises during SSR. The Firebase JS SDK is browser-only, so
 *    every accessor short-circuits on the server and initialises lazily on
 *    first use in the client.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so each one is referenced
 * statically here — a computed lookup like `process.env[key]` would not be.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Whether enough config is present to talk to Firebase at all. Checked before
 * every accessor and surfaced to the UI so auth screens can explain themselves
 * rather than failing silently.
 */
export const firebaseEnabled: boolean = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (typeof window === "undefined" || !firebaseEnabled) return null;
  if (cachedApp) return cachedApp;
  try {
    cachedApp = getApps().length
      ? getApp()
      : initializeApp({
          apiKey: firebaseConfig.apiKey!,
          authDomain: firebaseConfig.authDomain,
          projectId: firebaseConfig.projectId!,
          storageBucket: firebaseConfig.storageBucket,
          messagingSenderId: firebaseConfig.messagingSenderId,
          appId: firebaseConfig.appId!,
        });
    return cachedApp;
  } catch (err) {
    console.error("[firebase] init failed", err);
    return null;
  }
}

export function getFirebaseAuth(): Auth | null {
  if (cachedAuth) return cachedAuth;
  const app = getFirebaseApp();
  if (!app) return null;
  try {
    cachedAuth = getAuth(app);
    return cachedAuth;
  } catch (err) {
    console.error("[firebase] auth unavailable", err);
    return null;
  }
}

/**
 * Firestore with an on-device cache, so the library and watchlist render
 * offline (and instantly on launch) from the last snapshot, and writes made
 * offline queue and sync when the connection returns.
 *
 * The multi-tab manager lets several open tabs (or the installed app and a
 * tab) share one IndexedDB cache instead of the second one failing to get it.
 * Where IndexedDB is missing (some private modes, locked-down webviews) it
 * falls back to the in-memory cache: online behaviour is unchanged, there's
 * just no offline copy.
 */
export function getDb(): Firestore | null {
  if (cachedDb) return cachedDb;
  const app = getFirebaseApp();
  if (!app) return null;
  try {
    cachedDb = initializeFirestore(app, {
      localCache:
        typeof indexedDB !== "undefined"
          ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
          : memoryLocalCache(),
    });
    return cachedDb;
  } catch (err) {
    // initializeFirestore throws if this app already has an instance (e.g.
    // after a hot reload reset this module's cache); reuse that one.
    try {
      cachedDb = getFirestore(app);
      return cachedDb;
    } catch {
      console.error("[firebase] firestore unavailable", err);
      return null;
    }
  }
}

/** Turns Firebase's error codes into copy a person can act on. */
export function authErrorMessage(code: string): string {
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account already exists with that email.";
    case "auth/weak-password":
      return "Passwords need to be at least 6 characters.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was cancelled.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups and try again.";
    case "auth/account-exists-with-different-credential":
      return "That email is already registered with a different sign-in method.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network problem — check your connection and try again.";
    case "auth/operation-not-allowed":
      return "That sign-in method isn't enabled for this project yet.";
    case "auth/unauthorized-domain":
      return "This domain isn't authorised in your Firebase console.";
    default:
      return "Something went wrong. Please try again.";
  }
}
