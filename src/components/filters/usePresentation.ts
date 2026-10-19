"use client";

import { useMediaQuery } from "@/hooks";

/**
 * Where a filter surface should open.
 *
 * Touch gets a bottom sheet — a thumb-reachable, full-width list with 44px
 * rows — and a narrow window gets one too, because a 300px popover pinned
 * under a scrolled facet rail on a phone-sized viewport has nowhere good to
 * go. Everything else gets an anchored glass popover, which keeps the page
 * visible behind it on desktop.
 *
 * Matches `Sheet`'s own breakpoint so the sheet always uses its bottom-sheet
 * presentation when this returns "sheet" on a phone.
 */
export function useFilterPresentation(): "sheet" | "popover" {
  const coarse = useMediaQuery("(hover: none) and (pointer: coarse)");
  const narrow = useMediaQuery("(max-width: 767px)");
  return coarse || narrow ? "sheet" : "popover";
}
