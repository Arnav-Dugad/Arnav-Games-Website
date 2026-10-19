"use client";

/**
 * Wraps a cover so it can morph into (or out of) the game page's cover.
 *
 * Two roles:
 *  - `source` (cards, cover-flow): anonymous until `useSharedCover().claim()`
 *    is called for this instance, so duplicate copies of a game on one page
 *    never fight over the name.
 *  - `target` (the game page hero): always named — there is only ever one.
 *
 * The wrapper element is load-bearing. `<ViewTransition>` names its nearest
 * DOM children, and `GameCover` renders more than one (placeholder + image);
 * naming each separately would give the old and new page different snapshot
 * sets. One absolutely-filling span gives exactly one snapshot per side, and
 * `overflow-hidden` + inherited radius keeps a hover-zoomed image from
 * spilling out of the snapshot mid-flight.
 */

import { ViewTransition, useCallback, useId, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import {
  COVER_MORPH_CLASS,
  claimCover,
  coverTransitionName,
  getCoverClaim,
  subscribeCoverClaim,
} from "./view-transition";

/**
 * Lets one cover instance claim the shared-element name for its slug.
 * Returns whether this instance currently holds it, and the claim function.
 */
export function useSharedCover(slug: string, image: string | null = null) {
  const key = useId();
  const active = useSyncExternalStore(
    subscribeCoverClaim,
    () => {
      const current = getCoverClaim();
      return current?.slug === slug && current.key === key;
    },
    () => false,
  );
  const claim = useCallback(() => claimCover(slug, key, image), [slug, key, image]);
  return { active, claim };
}

export function CoverTransition({
  slug,
  active = true,
  role = "source",
  className,
  children,
}: {
  slug: string;
  /** Sources only: whether this instance holds the claim. Targets ignore it. */
  active?: boolean;
  role?: "source" | "target";
  className?: string;
  children: ReactNode;
}) {
  const named = role === "target" || active;
  return (
    <ViewTransition
      name={named ? coverTransitionName(slug) : undefined}
      share={COVER_MORPH_CLASS}
      // When the destination suspended first (no pair could form), the page
      // cover arrives with a soft reveal instead of popping in.
      enter={role === "target" ? "cover-reveal" : "none"}
      exit="none"
      update="none"
      default="none"
    >
      <span className={cn("absolute inset-0 block overflow-hidden rounded-[inherit]", className)}>
        {children}
      </span>
    </ViewTransition>
  );
}
