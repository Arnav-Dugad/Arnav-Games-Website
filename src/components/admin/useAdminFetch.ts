"use client";

import { useCallback } from "react";
import type { User } from "firebase/auth";

/**
 * `fetch` for the admin APIs: attaches the Firebase ID token (or, in `next
 * dev` only, the `devBypass` flag the server also checks) and never caches.
 * The token comes from the SDK's cache — the dashboard's first stats load
 * already forced a refresh, so a newly granted claim is in it.
 */
export function useAdminFetch(user: User | null, devBypass: boolean) {
  return useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const url = new URL(path, window.location.origin);
      if (devBypass) url.searchParams.set("devBypass", "1");
      const headers = new Headers(init.headers);
      if (user && !devBypass) headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
      if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      return fetch(url, { ...init, headers, cache: "no-store" });
    },
    [user, devBypass],
  );
}

export type AdminFetch = ReturnType<typeof useAdminFetch>;

/** Runs `tick` now and every `ms` while the tab is visible; pauses when hidden. */
export function startVisiblePolling(tick: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (timer) return;
    tick();
    timer = setInterval(tick, ms);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
  onVisibility();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
