"use client";

/**
 * The default page-to-page transition: the outgoing page fades away quickly
 * and the incoming one rises in, while the header and tab bar (outside this
 * boundary) stay perfectly still as spatial anchors.
 *
 * Keyed by pathname on purpose, so navigations are enter/exit pairs rather
 * than an "update" of one long-lived boundary:
 *  - An update morphs the boundary from its old box to its new one. Scrolled
 *    2000px down a page, that box moves 2000px when the router resets scroll —
 *    which reads as the whole page sliding. Exit snapshots instead stay where
 *    they were on screen, and enter snapshots start where they land.
 *  - Search-param changes (filters, pagination, `router.refresh()`) keep the
 *    same key, so they update in place with no animation — the controls the
 *    reader is touching never flash.
 *
 * Every page segment already remounts on a pathname change, so the key costs
 * nothing extra. Without View Transitions support this is a plain wrapper.
 */

import { ViewTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import "./view-transition";

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter="page-enter" exit="page-exit" update="none" default="none">
      {/* One host element, so the page snapshots as a single layer instead
          of one per top-level section. */}
      <div>{children}</div>
    </ViewTransition>
  );
}
