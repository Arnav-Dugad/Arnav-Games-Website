/**
 * Conversion attribution: which shelf or rail led to a game view, a follow
 * or a sign-up.
 *
 * One capture-phase click listener reads the nearest `[data-track-src]`
 * ancestor of whatever was tapped (UI marks shelves like
 * `data-track-src="home:trending"`), falling back to `<page>:<section
 * heading>` so unmarked sections still show up. A tap on a link to a game
 * page becomes the session's "last source" for 30 minutes.
 *
 * The source lives in sessionStorage — per tab, gone when it closes — and is
 * a label for a piece of UI, not anything about the visitor.
 */

import { SRC_RE } from "./types";

const STORAGE_KEY = "arnav-games:src";
const SESSION_TTL_MS = 30 * 60_000;
/** A tap only explains the navigation/follow that follows it immediately. */
const TAP_TTL_MS = 10_000;

let started = false;
let lastTap: { src: string; explicit: boolean; t: number } | null = null;
let pendingView: { src: string; path: string; t: number } | null = null;

/** Lowercase kebab label safe for `SRC_RE`, or null. */
export function toSrc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9:_.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/(^[-:.]+|[-:.]+$)/g, "")
    .slice(0, 64);
  return SRC_RE.test(cleaned) ? cleaned : null;
}

/** "home" for /, otherwise the first path segment ("game", "browse", …). */
function pageKey(pathname: string): string {
  const first = pathname.split("/").filter(Boolean)[0];
  return toSrc(first) ?? "home";
}

/** The source label for a tapped element, and whether UI marked it explicitly. */
function sourceFor(element: Element): { src: string; explicit: boolean } | null {
  const marked = element.closest("[data-track-src]")?.getAttribute("data-track-src");
  const explicit = toSrc(marked);
  if (explicit) return { src: explicit, explicit: true };

  const page = pageKey(window.location.pathname);
  if (element.closest("header, nav, [role=navigation]")) return { src: `${page}:nav`, explicit: false };
  if (element.closest("footer")) return { src: `${page}:footer`, explicit: false };
  const section = element.closest("section, aside, [role=region]");
  const heading = toSrc(section?.querySelector("h2, h3")?.textContent?.trim().slice(0, 40));
  return { src: heading ? `${page}:${heading}`.slice(0, 64) : page, explicit: false };
}

function onClick(event: MouseEvent) {
  try {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const source = sourceFor(target);
    if (!source) return;
    const now = Date.now();
    lastTap = { ...source, t: now };

    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/game/")) return;
    pendingView = { src: source.src, path: url.pathname.replace(/\/+$/, ""), t: now };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ src: source.src, t: now }));
  } catch {
    // Storage blocked or a malformed href — attribution is best-effort.
  }
}

/** Installs the click listener once per page load. */
export function startAttribution(): void {
  if (started || typeof document === "undefined") return;
  started = true;
  document.addEventListener("click", onClick, { capture: true, passive: true });
}

function sessionSource(): string | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { src?: unknown; t?: unknown };
    if (typeof parsed.t !== "number" || Date.now() - parsed.t > SESSION_TTL_MS) return null;
    return typeof parsed.src === "string" ? toSrc(parsed.src) : null;
  } catch {
    return null;
  }
}

/**
 * Source for a pageview of `pathname`: only when this exact navigation came
 * from a tracked tap moments ago. Typed URLs, back/forward and external
 * entries get none, and show as "no recorded source" on the dashboard.
 */
export function takeViewSource(pathname: string): string | null {
  const pending = pendingView;
  if (!pending || Date.now() - pending.t > TAP_TTL_MS || pending.path !== pathname) return null;
  pendingView = null;
  return pending.src;
}

/**
 * Source for a follow/own/sign-up.
 *
 * On a game page, it's whatever brought the visitor to that game — so a
 * follow counts toward the same shelf as the view before it, and follow rate
 * per source is meaningful. Elsewhere (a follow straight from a card on a
 * shelf) the explicitly-marked shelf just tapped wins.
 */
export function conversionSource(): string | null {
  if (typeof window === "undefined") return null;
  const onGamePage = window.location.pathname.startsWith("/game/");
  const tap = lastTap && Date.now() - lastTap.t <= TAP_TTL_MS ? lastTap : null;
  if (!onGamePage && tap?.explicit) return tap.src;
  return sessionSource() ?? tap?.src ?? null;
}
