"use client";

/**
 * Owns everything that frames the page: header, touch tab bar, search overlay
 * and scroll progress.
 *
 * Search-open state lives here because three separate surfaces trigger it — the
 * header button, the mobile Search tab, and the ⌘K shortcut.
 *
 * It also hosts the app-wide interaction layer, each mounted exactly once: the
 * game context menu (one set of document listeners for every card), touch
 * pull-to-refresh, and the inline SVG filter behind the liquid-glass lenses.
 */

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Header } from "./Header";
import { MobileTabBar } from "./MobileTabBar";
import { SearchOverlay } from "./SearchOverlay";
import { ScrollProgress } from "@/components/motion/ScrollProgress";
import { ScrollArrows } from "@/components/interactions/ScrollArrows";
import { ContextMenuHost } from "@/components/interactions/ContextMenu";
import { LiquidGlassFilter } from "@/components/interactions/LiquidGlassFilter";
import { PullToRefresh } from "@/components/interactions/PullToRefresh";

export function SiteChrome() {
  const pathname = usePathname();
  // Search is open *on a route*. Any navigation — the Back button above all,
  // which never went through onClose — leaves it closed, and with it the
  // body scroll lock it holds. A plain boolean kept the full-screen overlay
  // up over the previous page after Back on Android.
  const [searchOn, setSearchOn] = useState<string | null>(null);
  const searchOpen = searchOn !== null && searchOn === pathname;
  const openSearch = useCallback(() => setSearchOn(pathname), [pathname]);
  const closeSearch = useCallback(() => setSearchOn(null), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOn((open) => (open === pathname ? null : pathname));
        return;
      }
      // Bare "/" opens search, but not while the user is typing somewhere else.
      if (event.key === "/" && !event.metaKey && !event.ctrlKey) {
        const target = event.target as HTMLElement | null;
        const typing =
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.isContentEditable;
        if (!typing) {
          event.preventDefault();
          setSearchOn(pathname);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pathname]);

  return (
    <>
      <ScrollProgress />
      <Header onOpenSearch={openSearch} />
      <MobileTabBar onOpenSearch={openSearch} />
      <SearchOverlay open={searchOpen} onClose={closeSearch} />
      <ContextMenuHost />
      <PullToRefresh />
      <LiquidGlassFilter />
      <ScrollArrows />
    </>
  );
}
