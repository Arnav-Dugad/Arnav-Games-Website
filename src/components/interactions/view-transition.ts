/// <reference types="react/canary" />
/*
 * The triple-slash reference above pulls in React's canary typings, which is
 * where `ViewTransition` and `addTransitionType` are declared. The App Router
 * runs on Next's vendored canary React, so the runtime export exists; only the
 * stable `@types/react` entry point lacks it.
 */

/**
 * Shared-element ("hero") transitions between a game card's cover and the
 * cover on the game page.
 *
 * Built on React's `<ViewTransition>`, which Next 16 drives automatically for
 * every App Router navigation (see `next/dist/docs/01-app/02-guides/
 * view-transitions.md`). Two elements with the same `name` on the outgoing and
 * incoming page are morphed by the browser's View Transitions API.
 *
 * The catch is uniqueness. A `view-transition-name` must be unique in the
 * document at snapshot time or the browser aborts the whole transition — and
 * the same game routinely appears twice on one page (in "Landing soon" *and*
 * "Trending", say). So cards do not carry the name permanently: the one card
 * the reader actually activated *claims* the name for its slug just before the
 * navigation starts, and every other copy stays anonymous.
 *
 * Degrades on its own: browsers without the API (or with reduced motion, see
 * the CSS in globals.css) navigate exactly as before.
 */

/** A valid CSS <custom-ident> for a game's cover, shared by card and page. */
export function coverTransitionName(slug: string): string {
  // Slugs are already URL-safe, but `view-transition-name` is stricter than a
  // URL segment (no dots, no leading digit after the prefix is fine).
  return `cover-${slug.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * The game's logo, for the search-result → game-page logo morph. Same
 * uniqueness rule as covers: only the activated result carries it.
 */
export function logoTransitionName(slug: string): string {
  return `logo-${slug.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/** `view-transition-class` applied to the morph pair; styled in globals.css. */
export const COVER_MORPH_CLASS = "cover-morph";

interface CoverClaim {
  slug: string;
  /** Identifies the claiming component instance (a `useId` value). */
  key: string;
  /** The poster URL, so a loading screen can show the same art immediately. */
  image: string | null;
}

let claim: CoverClaim | null = null;
const listeners = new Set<() => void>();

/**
 * Marks one cover instance as the shared element for its slug. Call it in the
 * click handler, before navigation — React flushes the resulting update
 * synchronously at the end of the discrete event, so the name is committed
 * before the navigation transition renders.
 */
export function claimCover(slug: string, key: string, image: string | null = null): void {
  if (claim?.slug === slug && claim.key === key) return;
  claim = { slug, key, image };
  for (const listener of listeners) listener();
}

export function subscribeCoverClaim(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCoverClaim(): CoverClaim | null {
  return claim;
}
