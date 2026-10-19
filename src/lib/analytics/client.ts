/**
 * Browser-side analytics.
 *
 * Cookieless and first-party: nothing is stored on the device, no identifier
 * is generated, and every event goes to our own `/api/track`. The only thing
 * describing the visitor is a coarse device class.
 *
 * Every export is fire-and-forget and never throws — a failed beacon must
 * never break the click that caused it.
 */

import type { ClientEvent, ClientEventType, Device } from "./types";

const ENDPOINT = "/api/track";

/**
 * Honour the browser's privacy signals. Do Not Track is deprecated but still
 * an explicit request; Global Privacy Control is its legally-recognised
 * successor in several jurisdictions. Either one means we send nothing.
 */
export function trackingAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const win = window as Window & { doNotTrack?: string };
  if (nav.globalPrivacyControl === true) return false;
  if (nav.doNotTrack === "1" || nav.msDoNotTrack === "1" || win.doNotTrack === "1") return false;
  return true;
}

/**
 * Coarse device class from the viewport and the primary pointer.
 *
 * Width alone misfiles a phone in landscape (844px) as a tablet, so touch
 * devices are split by their *shorter* side instead. A mouse-driven window
 * only counts as mobile when it's genuinely phone-narrow.
 */
export function deviceClass(): Device {
  if (typeof window === "undefined") return "desktop";
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const width = window.innerWidth;
  if (coarse) {
    return Math.min(width, window.innerHeight) < 600 ? "mobile" : "tablet";
  }
  return width < 640 ? "mobile" : "desktop";
}

/** Paths whose traffic would only measure the owner looking at the numbers. */
export function isUntrackedPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/** Sends a batch, preferring `sendBeacon` so it survives the page unloading. */
export function send(events: ClientEvent[]): void {
  if (events.length === 0 || !trackingAllowed()) return;
  try {
    const body = JSON.stringify(events.length === 1 ? events[0] : events);
    // A plain string beacon goes as text/plain — a CORS "simple" request, so
    // no preflight. The route parses either content type.
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, body)) {
      return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    // Analytics is never worth an error.
  }
}

/**
 * Records one event. `path` and `device` are filled in automatically.
 *
 * Intended for product code: `track("follow", { slug, value: 1 })`,
 * `track("own", { slug })`, `track("signup")`.
 */
export function track(
  type: ClientEventType,
  data: Omit<ClientEvent, "type"> = {},
): void {
  if (typeof window === "undefined") return;
  const path = data.path ?? window.location.pathname;
  if (isUntrackedPath(path)) return;
  send([{ type, path, device: data.device ?? deviceClass(), ...withoutUndefined(data) }]);
}

function withoutUndefined(data: Omit<ClientEvent, "type">): Omit<ClientEvent, "type"> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Omit<ClientEvent, "type">;
}

/**
 * The referrer's host when the visitor arrived from another site, else null.
 * Only the host is kept — full referrer URLs can carry search terms, tokens
 * or other personal data in their query strings.
 */
export function externalReferrerHost(): string | null {
  if (typeof document === "undefined" || !document.referrer) return null;
  try {
    const host = new URL(document.referrer).hostname.toLowerCase();
    if (!host || host === window.location.hostname.toLowerCase()) return null;
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}
