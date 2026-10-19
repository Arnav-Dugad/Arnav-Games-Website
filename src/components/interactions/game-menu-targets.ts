"use client";

/**
 * Registry linking card elements to the game they represent, for the
 * long-press / right-click context menu.
 *
 * Cards attach no gesture listeners of their own. A grid of fifty cards with
 * fifty sets of pointer/timer/contextmenu handlers is exactly the per-card
 * cost this app avoids elsewhere; instead `ContextMenuHost` listens once on
 * the document and resolves the pressed card through this map. Registering is
 * a WeakMap write in a ref callback — effectively free — and entries vanish
 * with their elements.
 *
 * Usage on a card:
 *   const menuRef = useGameMenuTarget(game, claim);
 *   <div ref={menuRef} data-game-menu className="press-menu-target">
 *     <a data-menu-preview …>poster</a>
 *   </div>
 *
 * `data-game-menu` marks the hit area; the optional `data-menu-preview`
 * descendant is what lifts out of the page on touch (defaults to the target).
 */

import { useCallback } from "react";
import type { WatchlistEntry } from "@/lib/firebase/db";
import type { GameSummary } from "@/lib/games/types";

/** A recommended card's feedback, offered as menu items ("More like this", "Not interested"). */
export interface RecommendationMenu {
  current: "up" | "down" | "not-interested" | "ignored" | null;
  onFeedback: (kind: "up" | "not-interested") => void;
}

export interface GameMenuTarget {
  game: GameSummary;
  /** Claims the shared-element cover name before an "Open" navigation. */
  claimCover?: () => void;
  recommendation?: RecommendationMenu;
}

const targets = new WeakMap<Element, GameMenuTarget>();

export const GAME_MENU_SELECTOR = "[data-game-menu]";
export const GAME_MENU_PREVIEW_SELECTOR = "[data-menu-preview]";

export function resolveGameMenuTarget(start: EventTarget | null): { element: HTMLElement; target: GameMenuTarget } | null {
  if (!(start instanceof Element)) return null;
  const element = start.closest<HTMLElement>(GAME_MENU_SELECTOR);
  if (!element) return null;
  const target = targets.get(element);
  return target ? { element, target } : null;
}

export function useGameMenuTarget(game: GameSummary, claimCover?: () => void, recommendation?: RecommendationMenu) {
  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      targets.set(element, { game, claimCover, recommendation });
      return () => {
        targets.delete(element);
      };
    },
    [game, claimCover, recommendation],
  );
}

/**
 * Library and watchlist tiles render from the saved Firestore record rather
 * than a catalogue lookup; the menu's actions take a `GameSummary`, which
 * the record carries enough of to satisfy honestly (unknowns stay empty).
 */
export function entryAsGameSummary(entry: WatchlistEntry): GameSummary {
  return {
    id: entry.gameId,
    slug: entry.slug,
    name: entry.name,
    released: entry.released,
    releaseWindow: entry.releaseWindow,
    tba: entry.tba,
    image: entry.image,
    imageFallback: entry.imageFallback,
    rating: 0,
    ratingsCount: 0,
    metacritic: entry.metacritic,
    platforms: [],
    parentPlatforms: (entry.platformSlugs ?? []).map((slug, index) => ({ id: -(index + 1), slug, name: slug })),
    genres: entry.genres ?? [],
    screenshots: [],
    esrb: null,
    popScore: null,
    heroTrailer: null,
    playtime: entry.playtime ?? 0,
    added: 0,
  };
}
