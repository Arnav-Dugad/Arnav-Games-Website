"use client";

/**
 * Install state shared by the engagement prompt and the Settings row.
 *
 * The deferred `beforeinstallprompt` event is captured by the inline boot
 * script (see pwa-boot-script.ts) onto `window.__agInstallPrompt`, so it lives
 * outside React; these hooks read it through `useSyncExternalStore`.
 */

import { useSyncExternalStore } from "react";
import { INSTALL_PROMPT_EVENT } from "./pwa-boot-script";

/** Chromium-only; not in lib.dom. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

declare global {
  interface Window {
    __agInstallPrompt?: BeforeInstallPromptEvent | null;
  }
  interface Navigator {
    /** iOS Safari: true when launched from the home screen. */
    standalone?: boolean;
  }
}

function subscribePrompt(onChange: () => void) {
  window.addEventListener(INSTALL_PROMPT_EVENT, onChange);
  return () => window.removeEventListener(INSTALL_PROMPT_EVENT, onChange);
}

/** The captured prompt, or null when the browser hasn't offered one (yet). */
export function useInstallPrompt(): BeforeInstallPromptEvent | null {
  return useSyncExternalStore(
    subscribePrompt,
    () => window.__agInstallPrompt ?? null,
    () => null,
  );
}

/**
 * Shows the browser's own install dialog. The event is single-use, so it is
 * cleared whatever the outcome; Chromium fires a fresh one later if the
 * person declined.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = window.__agInstallPrompt;
  if (!event) return "unavailable";
  window.__agInstallPrompt = null;
  window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}

const INSTALLED_QUERY =
  "(display-mode: standalone), (display-mode: fullscreen), (display-mode: window-controls-overlay), (display-mode: minimal-ui)";

function subscribeDisplayMode(onChange: () => void) {
  const list = window.matchMedia(INSTALLED_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

export function isRunningInstalled(): boolean {
  return window.matchMedia(INSTALLED_QUERY).matches || window.navigator.standalone === true;
}

/** True when this page is running as the installed app rather than in a tab. */
export function useRunningInstalled(): boolean {
  return useSyncExternalStore(subscribeDisplayMode, isRunningInstalled, () => false);
}

export type InstallPlatform =
  /** iPhone/iPad: no install API, only Share → Add to Home Screen. */
  | "ios"
  /** Safari on macOS 14+: File → Add to Dock. */
  | "mac-safari"
  /** Anything else (Chromium without a captured prompt yet, Firefox…). */
  | "other";

export function detectInstallPlatform(): InstallPlatform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (iOS) return "ios";
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\//.test(ua);
  if (/Macintosh/.test(ua) && safari) return "mac-safari";
  return "other";
}

const noop = () => () => {};

/** Client-only platform read; "other" during SSR and hydration. */
export function useInstallPlatform(): InstallPlatform {
  return useSyncExternalStore(noop, detectInstallPlatform, () => "other");
}
