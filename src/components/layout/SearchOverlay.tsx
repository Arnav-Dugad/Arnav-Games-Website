"use client";

/**
 * Global search: Spotlight on desktop, the iOS search screen on phones.
 *
 * Desktop (lg+) is a floating panel: results on the left, a live preview of
 * the highlighted result on the right. Phones get a full-screen sheet with a
 * rounded field and a text Cancel, and the top hit as a large card (the
 * preview pane's job, folded into the list).
 *
 * Keyboard-first throughout: ↑/↓ move through every row in reading order
 * (empty state included), ↵ opens, ⌘/Ctrl+↵ opens the full results page,
 * Esc closes. Focus stays in the field; the highlight is visual and
 * announced through a polite live region instead of moving focus.
 *
 * Empty field: recent searches (this device only), what's trending (IGDB's
 * live signal via /search/suggest), example queries and quick links.
 * No results: the same suggestions plus two honest ways to look further.
 * Typo tolerance lives server-side (`/api/search`). Popular games are also
 * matched on the device as you type (`instant.ts`), so the obvious answer is
 * up before the server replies — and stays up if it can't. A failed search
 * retries once, then says so; it never pretends to be "no results".
 *
 * Opening a game hands off to the game page instead of closing first: the
 * panel stays up until the navigation commits and is removed in that same
 * commit (no exit animation), which is what lets the result's name and
 * thumbnail morph into the page's logo and cover (`LogoMorph`). A panel
 * that fades out on its own timeline would already be gone — or not yet
 * gone — when the browser takes its snapshots.
 */

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  CornerDownLeft,
  Loader2,
  Search,
  SearchX,
  RotateCw,
  TrendingUp,
  WifiOff,
  X,
} from "lucide-react";
import { OwnershipPicker } from "@/components/game/OwnershipPicker";
import { WatchButton } from "@/components/game/WatchButton";
import { LogoMorph, useResultMorph } from "@/components/search/LogoMorph";
import { SearchHitVisual } from "@/components/search/SearchHitVisual";
import { SpotlightPreview } from "@/components/search/SpotlightPreview";
import { hitAsGame } from "@/components/search/hit-game";
import { buildSections, SEARCH_PROMPTS, type SearchSection } from "@/components/search/model";
import { useRecentSearches } from "@/components/search/recent";
import { loadInstantIndex, matchInstant } from "@/components/search/instant";
import type { SearchIndexEntry } from "@/lib/games/providers/igdb";
import { readLocalCache, writeLocalCache } from "@/lib/utils/local-cache";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { useDebouncedValue, useDialogFocus, useLockBodyScroll, useMediaQuery } from "@/hooks";
import { cn } from "@/lib/utils/cn";
import { SEARCH_KIND_LABELS, hrefForSearchHit, type SearchHit } from "@/lib/games/search";

const EMPTY_RESULTS: SearchHit[] = [];

const QUICK_LINKS = [
  { label: "Upcoming", href: "/upcoming" },
  { label: "Top rated", href: "/browse?ordering=-metacritic" },
  { label: "Genres", href: "/genres" },
  { label: "Platforms", href: "/platforms" },
  { label: "Studios", href: "/studios" },
  { label: "Franchises", href: "/franchises" },
];

/** Rows per kind in the overlay; the full page shows everything. */
const LIMITS = { game: 6, franchise: 3, company: 3, character: 3, taxonomy: 4 };

/** One keyboard-navigable row, in reading order. */
type NavItem =
  | { type: "hit"; key: string; hit: SearchHit }
  | { type: "recent"; key: string; term: string }
  | { type: "all"; key: string };

/** The suggestions change on the order of hours; matches the route's cache window. */
const TRENDING_TTL_MS = 15 * 60_000;

/**
 * Trending suggestions, fetched at most once per page load and kept on the
 * device for 15 minutes, so opening search on every page doesn't cost a
 * Worker request each time.
 */
let trendingRequest: Promise<SearchHit[]> | null = null;
function loadTrending(): Promise<SearchHit[]> {
  const cached = readLocalCache<SearchHit[]>("search-trending", TRENDING_TTL_MS);
  if (cached && !trendingRequest) trendingRequest = Promise.resolve(cached);
  trendingRequest ??= fetch("/search/suggest")
    .then((res) => (res.ok ? res.json() : { trending: [] }))
    .then((data: { trending?: SearchHit[] }) => {
      const trending = data.trending ?? [];
      if (trending.length > 0) writeLocalCache("search-trending", trending);
      return trending;
    })
    .catch(() => {
      trendingRequest = null;
      return [];
    });
  return trendingRequest;
}

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState<{ term: string; results: SearchHit[]; failed?: boolean }>({ term: "", results: [] });
  /** Bumped by Retry to re-run the same query. */
  const [attempt, setAttempt] = useState(0);
  const [instantIndex, setInstantIndex] = useState<SearchIndexEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [trending, setTrending] = useState<SearchHit[]>([]);
  /** A game result was opened; the panel waits for the page (see header). */
  const [handoff, setHandoff] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const calm = useCalmMotion();
  const { recent, remember, forget, clear } = useRecentSearches();

  const debounced = useDebouncedValue(query, 180);
  const term = debounced.trim();
  const typed = query.trim();
  const searchable = term.length >= 2;
  const fresh = searchable && settled.term === term;
  const failed = fresh && Boolean(settled.failed);
  const serverHits = fresh && !failed && settled.results.length > 0;
  // Matched on every keystroke, ahead of the debounce.
  const instant = useMemo(() => matchInstant(instantIndex, typed), [instantIndex, typed]);
  const instantShown = !serverHits && typed.length >= 2 && instant.length > 0;
  // Server answers win. Until one lands (or if it can't), the instant
  // matches stand in; failing those, the previous results stay up (dimmed)
  // rather than the list flashing empty on every keystroke.
  const results = useMemo(() => {
    if (serverHits) return settled.results;
    if (instantShown) return instant;
    if (fresh) return settled.results;
    return searchable && settled.term.length >= 2 && !settled.failed ? settled.results : EMPTY_RESULTS;
  }, [serverHits, instantShown, instant, fresh, searchable, settled]);
  const resultsTerm = instantShown ? typed : settled.term;
  const loading = typed.length >= 2 && (!fresh || term !== typed);
  const sections = useMemo(() => buildSections(results, resultsTerm, LIMITS), [results, resultsTerm]);

  const showResults = typed.length >= 2 && results.length > 0;
  const noResults = typed.length >= 2 && fresh && !failed && term === typed && results.length === 0;
  const offline = typed.length >= 2 && failed && term === typed && results.length === 0;
  const retry = useCallback(() => {
    setSettled((current) => ({ ...current, term: "" }));
    setAttempt((n) => n + 1);
  }, []);

  const items = useMemo<NavItem[]>(() => {
    if (showResults) {
      return [
        ...sections.flatMap((section) =>
          section.hits.map((hit): NavItem => ({ type: "hit", key: `${section.id}-${hit.kind}-${hit.id}`, hit })),
        ),
        { type: "all", key: "all" },
      ];
    }
    if (typed.length < 2 || noResults || offline) {
      return [
        ...(noResults || offline ? [] : recent.map((entry): NavItem => ({ type: "recent", key: `recent-${entry}`, term: entry }))),
        ...trending.map((hit): NavItem => ({ type: "hit", key: `trending-${hit.id}`, hit })),
      ];
    }
    return [];
  }, [showResults, sections, typed, noResults, offline, recent, trending]);

  const activeIndex = items.length > 0 ? Math.min(cursor, items.length - 1) : -1;
  const active = activeIndex >= 0 ? items[activeIndex] : null;
  const previewHit = active?.type === "hit" ? active.hit : showResults ? (sections[0]?.hits[0] ?? null) : null;

  useLockBodyScroll(open);
  useDialogFocus(open, panelRef, inputRef);

  useEffect(() => {
    if (!open) {
      const id = setTimeout(() => {
        setQuery("");
        setSettled({ term: "", results: [] });
        setCursor(0);
      }, 200);
      return () => clearTimeout(id);
    }
    let cancelled = false;
    void loadTrending().then((hits) => {
      if (!cancelled) setTrending(hits);
    });
    void loadInstantIndex().then((games) => {
      if (!cancelled) setInstantIndex(games);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    // Lower-cased so "GTA" and "gta" share one cached answer server-side.
    const url = `/api/search?q=${encodeURIComponent(term.toLowerCase())}`;
    const run = (retries: number): Promise<SearchHit[]> =>
      fetch(url, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`search ${res.status}`);
          return res.json() as Promise<{ hits?: SearchHit[]; error?: boolean }>;
        })
        .then((data) => {
          if (data.error) throw new Error("search unavailable");
          return data.hits ?? [];
        })
        .catch((err: unknown) => {
          // One quiet retry rides out a cold start or a dropped connection.
          if (controller.signal.aborted || retries <= 0) throw err;
          return new Promise((resolve) => setTimeout(resolve, 700)).then(() => run(retries - 1));
        });
    run(1)
      .then((hits) => {
        setSettled({ term, results: hits });
        setCursor(0);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[search] failed", err);
        setSettled({ term, results: [], failed: true });
      });
    return () => controller.abort();
  }, [term, attempt]);

  const openFullSearch = useCallback(
    (raw?: string) => {
      const clean = (raw ?? query).trim();
      if (!clean) return;
      remember(clean);
      router.push(`/search?q=${encodeURIComponent(clean)}`);
      onClose();
    },
    [query, remember, router, onClose],
  );

  const runRecent = useCallback((entry: string) => {
    setQuery(entry);
    setCursor(0);
    inputRef.current?.focus();
  }, []);

  /** Following a result: remember what was typed (if anything) and close. */
  const followed = useCallback(() => {
    if (typed.length >= 2) remember(typed);
    onClose();
  }, [typed, remember, onClose]);

  /** Opening a game: remember, then hand off rather than close. */
  const openGame = useCallback(
    (href: string) => {
      if (typed.length >= 2) remember(typed);
      // Already on that page: nothing will navigate, so just close.
      if (new URL(href, window.location.href).pathname === window.location.pathname) {
        onClose();
        return;
      }
      setHandoff(true);
    },
    [typed, remember, onClose],
  );

  useEffect(() => {
    if (!handoff) return;
    if (!open) {
      // The navigation closed us (SiteChrome ties `open` to the route).
      const frame = requestAnimationFrame(() => setHandoff(false));
      return () => cancelAnimationFrame(frame);
    }
    // A navigation that never lands (offline, an error) mustn't strand the panel.
    const timer = setTimeout(() => {
      setHandoff(false);
      onClose();
    }, 4000);
    return () => clearTimeout(timer);
  }, [handoff, open, onClose]);

  const activate = useCallback(
    (item: NavItem | null) => {
      if (!item) {
        openFullSearch();
        return;
      }
      if (item.type === "recent") return runRecent(item.term);
      if (item.type === "all") return openFullSearch();
      // Enter on a result is a click on its row: the row claims its morph
      // names and the link navigates, exactly as a pointer would.
      const row = panelRef.current?.querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`);
      if (row instanceof HTMLAnchorElement) {
        row.click();
        return;
      }
      router.push(hrefForSearchHit(item.hit));
      followed();
    },
    [openFullSearch, runRecent, router, followed, activeIndex],
  );

  const moveCursor = (next: number) => {
    setCursor(next);
    // Keyboard only: the list follows the highlight. (Hover never scrolls —
    // that would chain row to row under a still pointer.)
    requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>(`[data-search-index="${next}"]`)?.scrollIntoView({ block: "nearest" }),
    );
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length > 0) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      moveCursor((Math.max(activeIndex, 0) + step + items.length) % items.length);
      return;
    }
    if (event.key === "Enter" && event.target === inputRef.current) {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey || loading) openFullSearch();
      else activate(showResults || typed.length < 2 ? active : null);
    }
  };

  /** Props shared by every navigable row. */
  const rowProps = (index: number): RowProps => ({
    "data-search-index": index,
    "data-active": index === activeIndex ? ("true" as const) : undefined,
    onPointerMove: () => {
      if (index !== activeIndex) setCursor(index);
    },
  });

  // Row → position in `items`. Looked up by key rather than counted while
  // rendering: sections render as child components, after this render.
  const indexOf = new Map(items.map((item, i) => [item.key, i]));

  // Removed in the navigation's own commit — see the header.
  if (handoff && !open) return null;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-(--z-search) flex items-start justify-center sm:p-6 sm:pt-[8vh]">
          <motion.div
            className="absolute inset-0 bg-bg/70 backdrop-blur-md light:bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Search all of Arnav Games"
            data-track-src="search:overlay"
            className={cn(
              "material relative z-10 flex h-dvh-safe w-full flex-col overflow-hidden outline-none",
              "sm:h-auto sm:max-h-[min(760px,86vh)] sm:max-w-3xl sm:rounded-[28px] lg:max-w-[1040px]",
              "sm:shadow-[inset_0_1px_0_#ffffff21,0_40px_140px_-45px_rgba(0,0,0,0.9)]",
            )}
            initial={calm ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={calm ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
            transition={calm ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 34 }}
            onKeyDown={onKeyDown}
          >
            {/* ------------------------------------------------------ Field */}
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 safe-t sm:px-4 sm:py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full bg-fg/[0.08] pl-3.5 pr-1 sm:rounded-2xl sm:bg-transparent sm:pl-2.5">
                {loading || handoff ? (
                  <Loader2 size={18} aria-hidden className="shrink-0 animate-spin text-brand-soft" />
                ) : (
                  <Search size={18} aria-hidden className="shrink-0 text-muted sm:text-brand-soft" />
                )}
                <label htmlFor="global-search" className="sr-only">Search games, franchises, studios and more</label>
                <input
                  id="global-search"
                  ref={inputRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setCursor(0);
                  }}
                  placeholder="Games, franchises, studios, characters…"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  className="h-11 min-w-0 flex-1 bg-transparent text-[17px] font-medium outline-none placeholder:text-faint sm:h-12 sm:text-[20px] sm:tracking-[-0.01em]"
                />
                {/* iOS's clear glyph: one tap back to an empty field, focus kept. */}
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setCursor(0);
                      inputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="press grid h-10 w-10 shrink-0 place-items-center rounded-full text-faint transition-colors hover:text-text"
                  >
                    <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-fg/25 text-bg">
                      <X size={12} strokeWidth={3} />
                    </span>
                  </button>
                )}
              </div>
              {/* Touch keeps the text Cancel at every width (a landscape phone is
                  past `sm`); the tiny "esc" key cap is for keyboards. */}
              <button type="button" onClick={onClose} className="press min-h-11 shrink-0 px-1.5 text-[17px] text-brand-soft sm:fine:hidden">
                Cancel
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close search"
                className="press hidden h-9 shrink-0 items-center rounded-lg border border-line px-2 text-[11px] font-semibold text-faint transition-colors hover:text-text sm:fine:flex"
              >
                esc
              </button>
            </div>

            {/* ---------------------------------------------------- Results */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain safe-b">
              {showResults ? (
                <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
                  <div className={cn("min-w-0 p-2 transition-opacity duration-200 sm:p-3", loading && !instantShown && "opacity-60")}>
                    {failed && instantShown && (
                      <div role="status" className="mx-1 mb-2 mt-1 flex items-center gap-3 rounded-2xl bg-fg/[0.06] px-3.5 py-2.5 text-[13px] text-muted">
                        <WifiOff size={15} aria-hidden className="shrink-0 text-faint" />
                        <span className="min-w-0 flex-1">Showing popular matches while full search reconnects.</span>
                        <button type="button" onClick={retry} className="press shrink-0 rounded-full bg-fg/[0.08] px-3 py-1.5 text-[13px] font-semibold text-text">
                          Retry
                        </button>
                      </div>
                    )}
                    {sections.map((section) => (
                      <ResultSection
                        key={section.id}
                        section={section}
                        query={resultsTerm}
                        renderRow={(hit) => {
                          const i = indexOf.get(`${section.id}-${hit.kind}-${hit.id}`) ?? -1;
                          return section.id === "top" ? (
                            <TopHit key={`top-${hit.kind}-${hit.id}`} hit={hit} active={i === activeIndex} rowProps={rowProps(i)} onFollow={followed} onOpenGame={openGame} />
                          ) : (
                            <HitRow key={`${hit.kind}-${hit.id}`} hit={hit} active={i === activeIndex} rowProps={rowProps(i)} onFollow={followed} onOpenGame={openGame} />
                          );
                        }}
                        onShowAll={() => openFullSearch(resultsTerm)}
                      />
                    ))}
                    {(() => {
                      const i = indexOf.get("all") ?? -1;
                      return (
                        <button
                          type="button"
                          {...rowProps(i)}
                          onClick={() => openFullSearch()}
                          className={cn(
                            "mt-1 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium text-brand-soft transition-colors",
                            i === activeIndex ? "bg-fg/[0.08]" : "fine:hover:bg-fg/[0.05]",
                          )}
                        >
                          <Search size={16} aria-hidden />
                          <span className="min-w-0 flex-1 truncate">Show all results for “{typed}”</span>
                          <ArrowRight size={15} aria-hidden />
                        </button>
                      );
                    })()}
                  </div>

                  {/* Spotlight: a live preview of the highlighted result.
                      Sticky inside the scroll area so it stays in view. */}
                  <aside aria-label="Result preview" className="hidden border-l border-line p-3 lg:block">
                    <div className="sticky top-3 h-[min(32rem,calc(86vh-9rem))]">
                      <SpotlightPreview hit={previewHit} onNavigate={followed} onOpenGame={openGame} />
                    </div>
                  </aside>
                </div>
              ) : typed.length >= 2 && !noResults && !offline ? (
                <ResultsSkeleton />
              ) : (
                <EmptyStart
                  query={noResults || offline ? typed : null}
                  failed={offline}
                  onRetry={retry}
                  recent={noResults || offline ? [] : recent}
                  trending={trending}
                  activeIndex={activeIndex}
                  rowProps={rowProps}
                  onRecent={runRecent}
                  onForget={forget}
                  onClear={clear}
                  onFollow={followed}
                  onOpenGame={openGame}
                  onPrompt={runRecent}
                  onFullSearch={() => openFullSearch()}
                  onNavigate={onClose}
                />
              )}
            </div>

            <div className="hidden items-center gap-4 border-t border-line px-5 py-2.5 text-[11px] text-faint fine:sm:flex">
              <span className="flex items-center gap-1.5"><Key>↑</Key><Key>↓</Key> to move</span>
              <span className="flex items-center gap-1.5"><Key>↵</Key> to open</span>
              <span className="flex items-center gap-1.5"><Key>⌘</Key><Key>↵</Key> for all results</span>
              <span className="ml-auto flex items-center gap-1.5"><Key>esc</Key> to close</span>
            </div>

            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {offline
                ? "Search couldn't reach the server."
                : noResults
                ? `No results for ${typed}`
                : showResults && !loading
                  ? // Count only: each row is a real link, so screen readers read
                    // names as focus moves; repeating them here doubles up.
                    `${results.length} ${results.length === 1 ? "result" : "results"}. Use the arrow keys to move through them.`
                  : ""}
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* -------------------------------------------------------------------------- */

type RowProps = {
  "data-search-index": number;
  "data-active": "true" | undefined;
  onPointerMove: () => void;
};

function ResultSection({
  section,
  query,
  renderRow,
  onShowAll,
}: {
  section: SearchSection;
  query: string;
  renderRow: (hit: SearchHit) => React.ReactNode;
  onShowAll: () => void;
}) {
  return (
    <section aria-label={section.label} data-track-src={`search:overlay-${section.id}`} className="mb-1.5 last:mb-0">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{section.label}</h3>
        {section.more > 0 && (
          <button
            type="button"
            tabIndex={-1}
            onClick={onShowAll}
            className="text-[12px] font-medium text-brand-soft hover:underline"
            aria-label={`Show all ${section.total} ${section.label.toLowerCase()} for ${query}`}
          >
            Show all {section.total}
          </button>
        )}
      </div>
      <ul className="space-y-0.5">{section.hits.map((hit) => renderRow(hit))}</ul>
    </section>
  );
}

function HitRow({
  hit,
  active,
  rowProps,
  onFollow,
  onOpenGame,
  label,
}: {
  hit: SearchHit;
  active: boolean;
  rowProps: RowProps;
  onFollow: () => void;
  onOpenGame: (href: string) => void;
  /** Overrides the subtitle, e.g. for trending suggestions. */
  label?: string;
}) {
  const game = hit.kind === "game" ? hitAsGame(hit) : null;
  const href = hrefForSearchHit(hit);
  const morph = useResultMorph(hit.slug, hit.image);
  return (
    <li className="group relative">
      <Link
        href={href}
        onClick={() => {
          if (!game) return onFollow();
          morph.claim();
          onOpenGame(href);
        }}
        {...rowProps}
        className={cn(
          "flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-xl px-2 py-1.5 transition-colors duration-150",
          game && "pr-14 fine:pr-24",
          active ? "bg-fg/[0.08]" : "fine:hover:bg-fg/[0.05]",
        )}
      >
        <SearchHitVisual hit={hit} coverActive={morph.coverActive} />
        <span className="min-w-0 flex-1">
          <LogoMorph slug={hit.slug} active={game !== null && morph.logoActive} className="block">
            <span className="block max-w-full truncate text-[15px] font-semibold tracking-[-0.01em]">{hit.name}</span>
          </LogoMorph>
          {(label ?? hit.subtitle) && <span className="mt-0.5 block truncate text-[13px] text-muted">{label ?? hit.subtitle}</span>}
        </span>
        {active && !game && <CornerDownLeft size={14} aria-hidden className="hidden shrink-0 text-faint fine:block" />}
      </Link>
      {game && (
        // Siblings of the link, not children: a button inside a link is
        // invalid and its clicks would navigate.
        <span
          className={cn(
            "absolute right-2 top-1/2 flex -translate-y-1/2 gap-1 transition-opacity duration-150",
            "fine:opacity-0 fine:group-hover:opacity-100 fine:group-focus-within:opacity-100",
            active && "fine:opacity-100",
          )}
        >
          <WatchButton game={game} />
          {/* Phones keep one action per row, as in the App Store's list;
              ownership is a long-press or a tap into the game away. */}
          <span className="hidden fine:block">
            <OwnershipPicker game={game} variant="icon" />
          </span>
        </span>
      )}
    </li>
  );
}

/**
 * The top hit. On phones (no preview pane) it is a large card, as in the
 * iOS search screen; from lg up the preview pane carries the detail, so it
 * stays a row with a little more presence.
 */
function TopHit({
  hit,
  active,
  rowProps,
  onFollow,
  onOpenGame,
}: {
  hit: SearchHit;
  active: boolean;
  rowProps: RowProps;
  onFollow: () => void;
  onOpenGame: (href: string) => void;
}) {
  const game = hit.kind === "game" ? hitAsGame(hit) : null;
  const kind = SEARCH_KIND_LABELS[hit.kind].replace(/s$/, "");
  const href = hrefForSearchHit(hit);
  const morph = useResultMorph(hit.slug, hit.image);
  // Two sizes of thumbnail render and CSS hides one; only the visible one may
  // carry the cover name, or there would be two elements with it.
  const wide = useMediaQuery("(min-width: 1024px)");
  return (
    <li className="group relative">
      <Link
        href={href}
        onClick={() => {
          if (!game) return onFollow();
          morph.claim();
          onOpenGame(href);
        }}
        {...rowProps}
        className={cn(
          "flex min-w-0 items-center gap-4 overflow-hidden rounded-2xl p-3 transition-colors duration-150 lg:gap-3 lg:rounded-xl lg:px-2 lg:py-1.5",
          active ? "bg-fg/[0.08]" : "bg-fg/[0.04] fine:hover:bg-fg/[0.06] lg:bg-transparent",
          game && "lg:pr-24",
        )}
      >
        <span className="flex shrink-0 lg:hidden">
          <SearchHitVisual hit={hit} size="card" coverActive={morph.coverActive && !wide} />
        </span>
        <span className="hidden shrink-0 lg:flex">
          <SearchHitVisual hit={hit} coverActive={morph.coverActive && wide} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-soft lg:hidden">{kind}</span>
          <LogoMorph slug={hit.slug} active={game !== null && morph.logoActive} className="block">
            <span className="mt-1 line-clamp-2 break-words text-[19px] font-bold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere] lg:mt-0 lg:line-clamp-1 lg:text-[15px] lg:font-semibold lg:tracking-[-0.01em]">
              {hit.name}
            </span>
          </LogoMorph>
          {hit.subtitle && <span className="mt-1 block truncate text-[13px] text-muted lg:mt-0.5">{hit.subtitle}</span>}
          {game && (
            <span className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-full bg-fg px-3.5 text-[13px] font-semibold text-bg lg:hidden">
              View game <ArrowRight size={13} aria-hidden />
            </span>
          )}
        </span>
      </Link>
      {game && (
        <span className="absolute right-3 top-3 flex gap-1 lg:right-2 lg:top-1/2 lg:-translate-y-1/2 fine:lg:opacity-0 fine:lg:group-hover:opacity-100 fine:lg:group-focus-within:opacity-100">
          <WatchButton game={game} />
          <span className="hidden lg:block"><OwnershipPicker game={game} variant="icon" /></span>
        </span>
      )}
    </li>
  );
}

function EmptyStart({
  query,
  failed = false,
  onRetry,
  recent,
  trending,
  activeIndex,
  rowProps,
  onRecent,
  onForget,
  onClear,
  onFollow,
  onOpenGame,
  onPrompt,
  onFullSearch,
  onNavigate,
}: {
  /** Set when the field holds a query that found nothing. */
  query: string | null;
  /** The query couldn't be answered at all (as opposed to answered with nothing). */
  failed?: boolean;
  onRetry?: () => void;
  recent: string[];
  trending: SearchHit[];
  activeIndex: number;
  rowProps: (index: number) => RowProps;
  onRecent: (term: string) => void;
  onForget: (term: string) => void;
  onClear: () => void;
  onFollow: () => void;
  onOpenGame: (href: string) => void;
  onPrompt: (term: string) => void;
  onFullSearch: () => void;
  onNavigate: () => void;
}) {
  let index = -1;
  return (
    <div className="px-2 pb-6 pt-2 sm:px-3">
      {query && (
        <div className="px-3 pb-6 pt-8 text-center sm:pt-10">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-fg/[0.06] text-faint">
            {failed ? <WifiOff size={22} aria-hidden /> : <SearchX size={22} aria-hidden />}
          </span>
          <p className="mx-auto mt-4 max-w-md break-words text-[19px] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">
            {failed ? "Search didn’t answer" : <>No results for “{query}”</>}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[15px] text-muted">
            {failed ? "It’s usually back in a moment." : "Check the spelling, try fewer words, or search game titles only."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {failed && onRetry && (
              <button type="button" onClick={onRetry} className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand px-4 text-[14px] font-semibold text-white">
                <RotateCw size={14} aria-hidden /> Try again
              </button>
            )}
            <button type="button" onClick={onFullSearch} className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-fg px-4 text-[14px] font-semibold text-bg">
              Open full search <ArrowRight size={14} aria-hidden />
            </button>
            <Link
              href={`/browse?search=${encodeURIComponent(query)}`}
              onClick={onNavigate}
              className="press inline-flex min-h-11 items-center rounded-full bg-fg/[0.08] px-4 text-[14px] font-semibold text-text"
            >
              Search game titles
            </Link>
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <section aria-label="Recent searches" className="mb-3">
          <div className="flex items-center justify-between px-3 pb-1 pt-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Recent</h3>
            <button type="button" onClick={onClear} className="min-h-8 px-1 text-[12px] font-medium text-brand-soft hover:underline">
              Clear
            </button>
          </div>
          <ul className="space-y-0.5">
            {recent.map((term) => {
              const i = ++index;
              return (
                <li key={term} className="group relative">
                  <button
                    type="button"
                    {...rowProps(i)}
                    onClick={() => onRecent(term)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 pr-12 text-left text-[15px] transition-colors",
                      i === activeIndex ? "bg-fg/[0.08]" : "fine:hover:bg-fg/[0.05]",
                    )}
                  >
                    <Clock size={16} aria-hidden className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate">{term}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onForget(term)}
                    aria-label={`Remove “${term}” from recent searches`}
                    className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:text-text fine:opacity-0 fine:group-hover:opacity-100 fine:focus-visible:opacity-100"
                  >
                    <X size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {trending.length > 0 && (
        <section aria-label="Trending now" data-track-src="search:overlay-trending" className="mb-3">
          <div className="px-3 pb-1 pt-3">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
              <TrendingUp size={12} aria-hidden /> Trending now
            </h3>
          </div>
          <ul className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 sm:gap-x-2">
            {trending.map((hit, n) => {
              const i = ++index;
              return (
                <HitRow
                  key={hit.id}
                  hit={hit}
                  active={i === activeIndex}
                  rowProps={rowProps(i)}
                  onFollow={onFollow}
                  onOpenGame={onOpenGame}
                  label={`#${n + 1} playing now${hit.subtitle ? ` · ${hit.subtitle}` : ""}`}
                />
              );
            })}
          </ul>
        </section>
      )}

      <section aria-label="Suggestions" className="px-3 pt-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Try</h3>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {SEARCH_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onPrompt(prompt)}
              className="press min-h-10 rounded-full bg-fg/[0.07] px-3.5 text-[14px] text-text transition-colors fine:hover:bg-fg/[0.11] coarse:min-h-11"
            >
              {prompt}
            </button>
          ))}
        </div>
        <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Go to</h3>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              className="press inline-flex min-h-10 items-center gap-1 rounded-full border border-line px-3.5 text-[14px] text-muted transition-colors fine:hover:border-line-strong fine:hover:text-text coarse:min-h-11"
            >
              {link.label}
              <ArrowUpRight size={13} aria-hidden className="text-faint" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-1 p-3" role="status" aria-label="Searching">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-1.5">
          <div className="skeleton-glass h-14 w-11 rounded-xl" />
          <div className="flex-1">
            <div className="skeleton-glass h-3.5 rounded-full" style={{ width: `${70 - i * 8}%` }} />
            <div className="skeleton-glass mt-2 h-3 w-1/3 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-line bg-fg/[0.05] px-1 font-sans text-[10px] text-muted">
      {children}
    </kbd>
  );
}
