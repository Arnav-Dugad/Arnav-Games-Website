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
 * Typo tolerance lives server-side (`/api/search`); nothing here guesses.
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
  TrendingUp,
  X,
} from "lucide-react";
import { OwnershipPicker } from "@/components/game/OwnershipPicker";
import { WatchButton } from "@/components/game/WatchButton";
import { SearchHitVisual } from "@/components/search/SearchHitVisual";
import { SpotlightPreview } from "@/components/search/SpotlightPreview";
import { hitAsGame } from "@/components/search/hit-game";
import { buildSections, SEARCH_PROMPTS, type SearchSection } from "@/components/search/model";
import { useRecentSearches } from "@/components/search/recent";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { useDebouncedValue, useDialogFocus, useLockBodyScroll } from "@/hooks";
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

/** Trending suggestions, fetched once per page load and shared. */
let trendingRequest: Promise<SearchHit[]> | null = null;
function loadTrending(): Promise<SearchHit[]> {
  trendingRequest ??= fetch("/search/suggest")
    .then((res) => (res.ok ? res.json() : { trending: [] }))
    .then((data: { trending?: SearchHit[] }) => data.trending ?? [])
    .catch(() => {
      trendingRequest = null;
      return [];
    });
  return trendingRequest;
}

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState<{ term: string; results: SearchHit[] }>({ term: "", results: [] });
  const [cursor, setCursor] = useState(0);
  const [trending, setTrending] = useState<SearchHit[]>([]);
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
  // While a new query is in flight the previous results stay up (dimmed),
  // rather than the list flashing empty on every keystroke.
  const results = useMemo(
    () => (fresh ? settled.results : searchable && settled.term.length >= 2 ? settled.results : EMPTY_RESULTS),
    [fresh, searchable, settled],
  );
  const loading = typed.length >= 2 && (!fresh || term !== typed);
  const sections = useMemo(() => buildSections(results, settled.term, LIMITS), [results, settled.term]);

  const showResults = typed.length >= 2 && results.length > 0;
  const noResults = typed.length >= 2 && fresh && term === typed && results.length === 0;

  const items = useMemo<NavItem[]>(() => {
    if (showResults) {
      return [
        ...sections.flatMap((section) =>
          section.hits.map((hit): NavItem => ({ type: "hit", key: `${section.id}-${hit.kind}-${hit.id}`, hit })),
        ),
        { type: "all", key: "all" },
      ];
    }
    if (typed.length < 2 || noResults) {
      return [
        ...(noResults ? [] : recent.map((entry): NavItem => ({ type: "recent", key: `recent-${entry}`, term: entry }))),
        ...trending.map((hit): NavItem => ({ type: "hit", key: `trending-${hit.id}`, hit })),
      ];
    }
    return [];
  }, [showResults, sections, typed, noResults, recent, trending]);

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
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { hits: [] }))
      .then((data: { hits?: SearchHit[] }) => {
        setSettled({ term, results: data.hits ?? [] });
        setCursor(0);
      })
      .catch((err) => {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("[search] failed", err);
          setSettled({ term, results: [] });
        }
      });
    return () => controller.abort();
  }, [term]);

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

  const activate = useCallback(
    (item: NavItem | null) => {
      if (!item) {
        openFullSearch();
        return;
      }
      if (item.type === "recent") return runRecent(item.term);
      if (item.type === "all") return openFullSearch();
      router.push(hrefForSearchHit(item.hit));
      followed();
    },
    [openFullSearch, runRecent, router, followed],
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

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[250] flex items-start justify-center sm:p-6 sm:pt-[8vh]">
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
                {loading ? (
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
              <button type="button" onClick={onClose} className="press min-h-11 shrink-0 px-1.5 text-[17px] text-brand-soft sm:hidden">
                Cancel
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close search"
                className="press hidden h-9 shrink-0 items-center rounded-lg border border-line px-2 text-[11px] font-semibold text-faint transition-colors hover:text-text sm:flex"
              >
                esc
              </button>
            </div>

            {/* ---------------------------------------------------- Results */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain safe-b">
              {showResults ? (
                <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
                  <div className={cn("min-w-0 p-2 transition-opacity duration-200 sm:p-3", loading && "opacity-60")}>
                    {sections.map((section) => (
                      <ResultSection
                        key={section.id}
                        section={section}
                        query={settled.term}
                        renderRow={(hit) => {
                          const i = indexOf.get(`${section.id}-${hit.kind}-${hit.id}`) ?? -1;
                          return section.id === "top" ? (
                            <TopHit key={`top-${hit.kind}-${hit.id}`} hit={hit} active={i === activeIndex} rowProps={rowProps(i)} onFollow={followed} />
                          ) : (
                            <HitRow key={`${hit.kind}-${hit.id}`} hit={hit} active={i === activeIndex} rowProps={rowProps(i)} onFollow={followed} />
                          );
                        }}
                        onShowAll={() => openFullSearch(settled.term)}
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
                      <SpotlightPreview hit={previewHit} onNavigate={followed} />
                    </div>
                  </aside>
                </div>
              ) : typed.length >= 2 && !noResults ? (
                <ResultsSkeleton />
              ) : (
                <EmptyStart
                  query={noResults ? typed : null}
                  recent={noResults ? [] : recent}
                  trending={trending}
                  activeIndex={activeIndex}
                  rowProps={rowProps}
                  onRecent={runRecent}
                  onForget={forget}
                  onClear={clear}
                  onFollow={followed}
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
              {noResults
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
  label,
}: {
  hit: SearchHit;
  active: boolean;
  rowProps: RowProps;
  onFollow: () => void;
  /** Overrides the subtitle, e.g. for trending suggestions. */
  label?: string;
}) {
  const game = hit.kind === "game" ? hitAsGame(hit) : null;
  return (
    <li className="group relative">
      <Link
        href={hrefForSearchHit(hit)}
        onClick={onFollow}
        {...rowProps}
        className={cn(
          "flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-xl px-2 py-1.5 transition-colors duration-150",
          game && "pr-14 fine:pr-24",
          active ? "bg-fg/[0.08]" : "fine:hover:bg-fg/[0.05]",
        )}
      >
        <SearchHitVisual hit={hit} />
        <span className="min-w-0 flex-1">
          <span className="block max-w-full truncate text-[15px] font-semibold tracking-[-0.01em]">{hit.name}</span>
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
function TopHit({ hit, active, rowProps, onFollow }: { hit: SearchHit; active: boolean; rowProps: RowProps; onFollow: () => void }) {
  const game = hit.kind === "game" ? hitAsGame(hit) : null;
  const kind = SEARCH_KIND_LABELS[hit.kind].replace(/s$/, "");
  return (
    <li className="group relative">
      <Link
        href={hrefForSearchHit(hit)}
        onClick={onFollow}
        {...rowProps}
        className={cn(
          "flex min-w-0 items-center gap-4 overflow-hidden rounded-2xl p-3 transition-colors duration-150 lg:gap-3 lg:rounded-xl lg:px-2 lg:py-1.5",
          active ? "bg-fg/[0.08]" : "bg-fg/[0.04] fine:hover:bg-fg/[0.06] lg:bg-transparent",
          game && "lg:pr-24",
        )}
      >
        <span className="flex shrink-0 lg:hidden">
          <SearchHitVisual hit={hit} size="card" />
        </span>
        <span className="hidden shrink-0 lg:flex">
          <SearchHitVisual hit={hit} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-soft lg:hidden">{kind}</span>
          <span className="mt-1 line-clamp-2 break-words text-[19px] font-bold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere] lg:mt-0 lg:line-clamp-1 lg:text-[15px] lg:font-semibold lg:tracking-[-0.01em]">
            {hit.name}
          </span>
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
  recent,
  trending,
  activeIndex,
  rowProps,
  onRecent,
  onForget,
  onClear,
  onFollow,
  onPrompt,
  onFullSearch,
  onNavigate,
}: {
  /** Set when the field holds a query that found nothing. */
  query: string | null;
  recent: string[];
  trending: SearchHit[];
  activeIndex: number;
  rowProps: (index: number) => RowProps;
  onRecent: (term: string) => void;
  onForget: (term: string) => void;
  onClear: () => void;
  onFollow: () => void;
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
            <SearchX size={22} aria-hidden />
          </span>
          <p className="mx-auto mt-4 max-w-md break-words text-[19px] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">
            No results for “{query}”
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[15px] text-muted">
            Check the spelling, try fewer words, or search game titles only.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
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
