/// <reference types="react/canary" />
"use client";

/**
 * Search result → game page logo morph.
 *
 * When a game result is opened, its name (or logo) becomes the shared element
 * `logoTransitionName(slug)` and the browser morphs it into the game page's
 * hero logo, which carries the same name. Same rules as the cover morph (see
 * `CoverTransition` and `view-transition.ts`):
 *
 *  - Names must be unique at snapshot time, and the same game can appear more
 *    than once in a list, so a result is anonymous until it is *activated*:
 *    `claim()` runs in the click handler (or on Enter) and marks exactly one
 *    instance. React flushes that update at the end of the discrete event, so
 *    the name is committed before the navigation transition starts.
 *  - It degrades on its own: no View Transitions API, reduced motion (the
 *    global CSS zeroes durations) or a destination that streams in late
 *    simply navigates without the morph.
 *
 * Kept apart from the cover claim so a result can carry both at once — its
 * thumbnail morphs into the cover while its name morphs into the logo.
 */

import { ViewTransition, useCallback, useId, useSyncExternalStore, type ReactNode } from "react";
import { useSharedCover } from "@/components/interactions/CoverTransition";
import { logoTransitionName } from "@/components/interactions/view-transition";

/** `view-transition-class` for the pair, so the page can style the morph. */
export const LOGO_MORPH_CLASS = "logo-morph";

let claimed: { slug: string; key: string } | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Marks one instance (by its `useId` key) as the shared logo for its slug. */
function claimLogo(slug: string, key: string): void {
  if (claimed?.slug === slug && claimed.key === key) return;
  claimed = { slug, key };
  for (const listener of listeners) listener();
}

export function useSharedLogo(slug: string) {
  const key = useId();
  const active = useSyncExternalStore(
    subscribe,
    () => claimed?.slug === slug && claimed.key === key,
    () => false,
  );
  const claim = useCallback(() => claimLogo(slug, key), [slug, key]);
  return { active, claim };
}

/**
 * Wraps a result's name or logo. One wrapper element, so each side of the
 * pair is exactly one snapshot; `inline-block` by default so the snapshot hugs
 * the mark rather than spanning the row (`className` replaces it).
 */
export function LogoMorph({
  slug,
  active,
  className,
  children,
}: {
  slug: string;
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ViewTransition
      name={active ? logoTransitionName(slug) : undefined}
      share={LOGO_MORPH_CLASS}
      enter="none"
      exit="none"
      update="none"
      default="none"
    >
      <span className={className ?? "inline-block max-w-full align-top"}>{children}</span>
    </ViewTransition>
  );
}

/**
 * Both claims for one game result: its name/logo morphs into the page logo
 * and its thumbnail into the page cover. Call `claim` as the result opens.
 */
export function useResultMorph(slug: string, image: string | null) {
  const logo = useSharedLogo(slug);
  const cover = useSharedCover(slug, image);
  const { claim: claimName } = logo;
  const { claim: claimCover } = cover;
  const claim = useCallback(() => {
    claimName();
    claimCover();
  }, [claimName, claimCover]);
  return { logoActive: logo.active, coverActive: cover.active, claim };
}
