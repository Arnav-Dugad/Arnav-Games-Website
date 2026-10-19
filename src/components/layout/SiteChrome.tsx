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

import { useCallback, useEffect, useState } from "react";
import { Header } from "./Header";
import { MobileTabBar } from "./MobileTabBar";
import { SearchOverlay } from "./SearchOverlay";
import { ScrollProgress } from "@/components/motion/ScrollProgress";
import { ContextMenuHost } from "@/components/interactions/ContextMenu";
import { LiquidGlassFilter } from "@/components/interactions/LiquidGlassFilter";
import { PullToRefresh } from "@/components/interactions/PullToRefresh";

export function SiteChrome() {
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
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
          setSearchOpen(true);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <ScrollProgress />
      <Header onOpenSearch={openSearch} />
      <MobileTabBar onOpenSearch={openSearch} />
      <SearchOverlay open={searchOpen} onClose={closeSearch} />
      <ContextMenuHost />
      <PullToRefresh />
      <LiquidGlassFilter />
    </>
  );
}
