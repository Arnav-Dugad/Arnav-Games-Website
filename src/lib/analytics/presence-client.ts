/**
 * "Online now" heartbeat.
 *
 * Each tab makes up a random id in memory (never stored, gone on reload) and
 * posts `{ id, path }` to `/api/presence` every 30 seconds while it is
 * visible and someone has touched it in the last five minutes. Hiding the tab
 * sends a "leave" so the live count drops at once instead of after the TTL.
 *
 * Kept deliberately cheap — every beat is a Worker and a Durable Object
 * request — so it stays quiet for DNT/GPC, hidden or idle tabs and /admin,
 * and stops for good when the server says presence isn't available (dev).
 */

import { isUntrackedPath, trackingAllowed } from "./client";

const ENDPOINT = "/api/presence";
const BEAT_MS = 30_000;
const MIN_GAP_MS = 5_000;
const IDLE_MS = 5 * 60_000;

let started = false;
let unavailable = false;
let tabId = "";
let currentPath = "/";
let lastBeat = 0;
let lastActivity = Date.now();
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
/** Whether the server currently believes this tab is online. */
let present = false;

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function eligible(): boolean {
  return (
    !unavailable &&
    trackingAllowed() &&
    document.visibilityState === "visible" &&
    !isUntrackedPath(currentPath) &&
    Date.now() - lastActivity < IDLE_MS
  );
}

function beat() {
  if (!eligible()) {
    if (present) leave();
    return;
  }
  const now = Date.now();
  if (now - lastBeat < MIN_GAP_MS) {
    // Rapid navigation: one beat at the end of the gap carries the latest path.
    if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        beat();
      }, MIN_GAP_MS - (now - lastBeat));
    }
    return;
  }
  lastBeat = now;
  present = true;
  void fetch(ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ id: tabId, path: currentPath }),
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    keepalive: true,
  })
    .then(async (response) => {
      // 204 = recorded. A JSON body only ever says "don't bother".
      if (response.status === 200) {
        const body = (await response.json().catch(() => null)) as { available?: boolean } | null;
        if (body?.available === false) unavailable = true;
      }
    })
    .catch(() => {});
}

function leave() {
  present = false;
  if (unavailable || !tabId) return;
  try {
    const body = JSON.stringify({ id: tabId, leave: true });
    if (!navigator.sendBeacon?.(ENDPOINT, body)) {
      void fetch(ENDPOINT, { method: "POST", body, keepalive: true, credentials: "omit" }).catch(() => {});
    }
  } catch {
    // Best-effort: the TTL removes the tab anyway.
  }
}

function onActivity() {
  const wasIdle = Date.now() - lastActivity >= IDLE_MS;
  lastActivity = Date.now();
  if (wasIdle) beat();
}

/** Starts heartbeats once per page load; later calls just update the path. */
export function presenceNavigate(pathname: string): void {
  if (typeof window === "undefined") return;
  currentPath = pathname;
  if (!started) {
    started = true;
    tabId = randomId();
    setInterval(beat, BEAT_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") beat();
      else if (present) leave();
    });
    window.addEventListener("pagehide", () => present && leave());
    for (const type of ["pointerdown", "keydown", "scroll", "touchstart"] as const) {
      window.addEventListener(type, onActivity, { passive: true, capture: true });
    }
  }
  lastActivity = Date.now();
  beat();
}
