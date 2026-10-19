"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CornerDownLeft,
  Loader2,
  Search,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { OwnershipPicker } from "@/components/game/OwnershipPicker";
import { WatchButton } from "@/components/game/WatchButton";
import { SearchHitVisual, SearchKindIcon } from "@/components/search/SearchHitVisual";
import { SpotlightPreview } from "@/components/search/SpotlightPreview";
import { hitAsGame } from "@/components/search/hit-game";
import { useDebouncedValue, useDialogFocus, useLockBodyScroll } from "@/hooks";
import { cn } from "@/lib/utils/cn";
import {
  SEARCH_KIND_LABELS,
  SEARCH_KIND_ORDER,
  groupSearchHits,
  hrefForSearchHit,
  type SearchHit,
} from "@/lib/games/search";

const EMPTY_RESULTS: SearchHit[] = [];

const QUICK_LINKS = [
  { label: "Upcoming releases", detail: "The complete calendar", href: "/upcoming" },
  { label: "Personal stats", detail: "Your library, beautifully measured", href: "/stats" },
  { label: "Top rated", detail: "Critics’ highest scores", href: "/browse?ordering=-metacritic" },
  { label: "Studios", detail: "Developers and publishers", href: "/studios" },
  { label: "Franchises", detail: "Complete connected universes", href: "/franchises" },
  { label: "Every genre", detail: "Find your next obsession", href: "/genres" },
];

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState<{ term: string; results: SearchHit[] }>({
    term: "",
    results: [],
  });
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const debounced = useDebouncedValue(query, 280);
  const term = debounced.trim();
  const searchable = term.length >= 2;
  const results = useMemo(
    () => (searchable && settled.term === term ? settled.results : EMPTY_RESULTS),
    [searchable, settled, term],
  );
  const groups = useMemo(() => groupSearchHits(results), [results]);
  const loading = searchable && settled.term !== term;
  const activeIndex = results.length > 0 ? Math.min(cursor, results.length - 1) : 0;

  useLockBodyScroll(open);
  useDialogFocus(open, panelRef, inputRef);

  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => {
      setQuery("");
      setSettled({ term: "", results: [] });
      setCursor(0);
    }, 200);
    return () => clearTimeout(id);
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

  const openFullSearch = useCallback(() => {
    const clean = query.trim();
    if (!clean) return;
    router.push(`/search?q=${encodeURIComponent(clean)}`);
    onClose();
  }, [query, router, onClose]);

  const submit = useCallback(
    (target?: SearchHit) => {
      const hit = target ?? results[activeIndex];
      if (hit) router.push(hrefForSearchHit(hit));
      else openFullSearch();
      onClose();
    },
    [results, activeIndex, router, openFullSearch, onClose],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") onClose();
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (activeIndex + step + results.length) % results.length;
      setCursor(next);
      // Keyboard only: arrowing past the visible rows carries the list with
      // the highlight. (Hover never scrolls — that would chain row to row.)
      requestAnimationFrame(() =>
        panelRef.current
          ?.querySelector<HTMLElement>(`[data-search-index="${next}"]`)
          ?.scrollIntoView({ block: "nearest" }),
      );
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[250] flex items-start justify-center p-0 sm:p-6 sm:pt-[8vh]">
          <motion.div
            className="absolute inset-0 bg-black/80 backdrop-blur-xl"
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
            className="material relative z-10 flex h-dvh-safe w-full flex-col overflow-hidden sm:h-auto sm:max-h-[84vh] sm:max-w-4xl sm:rounded-[2rem] lg:max-w-5xl sm:shadow-[inset_0_1px_0_#ffffff21,0_40px_140px_-45px_rgba(0,0,0,0.9)]"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 400, damping: 34 }}
            onKeyDown={onKeyDown}
          >
            {/* Phones get iOS's own pattern — a rounded field and a text
                Cancel — while desktop keeps the roomier command-bar layout. */}
            <div className="relative flex items-center gap-3 border-b border-line px-3 py-3 safe-t sm:px-6 sm:py-5">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full bg-fg/[0.09] pl-3.5 pr-1.5 sm:gap-3 sm:rounded-none sm:bg-transparent sm:px-0">
                <span className="grid shrink-0 place-items-center text-muted sm:h-10 sm:w-10 sm:rounded-2xl sm:bg-brand/12 sm:text-brand-soft">
                  <Search size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <label htmlFor="global-search" className="sr-only">Search games and the entire database</label>
                  <input
                    id="global-search"
                    ref={inputRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Games, franchises, studios…"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    className="h-11 w-full bg-transparent text-[16px] font-medium outline-none placeholder:text-faint sm:h-auto sm:text-lg"
                  />
                  <p className="mt-0.5 hidden text-[11px] text-faint sm:block">One search across the complete game universe</p>
                </div>
                {loading && <Loader2 size={17} className="shrink-0 animate-spin text-brand-soft" />}
                {/* iOS's clear glyph: one tap back to an empty field, focus kept. */}
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="press grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:text-text sm:h-10 sm:w-10"
                  >
                    <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-fg/25 text-bg">
                      <X size={12} strokeWidth={3} />
                    </span>
                  </button>
                )}
              </div>
              <button type="button" onClick={onClose} className="press min-h-11 shrink-0 px-1 text-[16px] font-medium text-brand-soft sm:hidden">
                Cancel
              </button>
              <button type="button" onClick={onClose} aria-label="Close search" className="press hidden h-10 w-10 shrink-0 place-items-center rounded-full bg-fg/[0.07] text-faint transition-colors hover:bg-fg/[0.12] hover:text-text sm:grid">
                <X size={17} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain safe-b">
              {!searchable ? (
                <DiscoveryStart onClose={onClose} />
              ) : results.length === 0 && !loading ? (
                <div className="px-6 py-16 text-center sm:py-20">
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-line bg-white/[0.04] text-faint"><Search size={22} /></span>
                  <p className="mt-5 max-w-full break-words font-display text-lg font-bold [overflow-wrap:anywhere]">No direct matches for “{query.trim()}”</p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">Try a shorter spelling, or search the complete games catalogue for looser title matches.</p>
                  <button type="button" onClick={openFullSearch} className="press mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-bg">
                    Open full search <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
                  <div className="p-2 sm:p-3 lg:border-r lg:border-line">
                    {SEARCH_KIND_ORDER.map((kind) => {
                      const hits = groups.get(kind) ?? [];
                      if (hits.length === 0) return null;
                      return (
                        <section key={kind} aria-label={SEARCH_KIND_LABELS[kind]} className="mb-2 last:mb-0">
                          <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
                            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-faint"><SearchKindIcon kind={kind} size={13} /> {SEARCH_KIND_LABELS[kind]}</p>
                            <span className="text-[10px] tabular-nums text-faint">{hits.length}</span>
                          </div>
                          <ul className="space-y-1">
                            {hits.map((hit) => {
                              const index = results.findIndex((entry) => entry.kind === hit.kind && entry.id === hit.id);
                              return (
                                <li key={`${hit.kind}-${hit.id}`} className="relative">
                                  <Link
                                    href={hrefForSearchHit(hit)}
                                    onClick={onClose}
                                    onPointerEnter={() => setCursor(index)}
                                    data-search-index={index}
                                    className={cn("flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl p-2 pr-24 transition-[background-color,transform] active:scale-[0.99]", index === activeIndex ? "bg-fg/[0.09]" : "hover:bg-fg/[0.05]")}
                                  >
                                    <SearchHitVisual hit={hit} />
                                    <span className="min-w-0 flex-1">
                                      <span className="block max-w-full truncate text-sm font-semibold">{hit.name}</span>
                                      {hit.subtitle && <span className="mt-1 block truncate text-xs text-faint">{hit.subtitle}</span>}
                                    </span>
                                    {index === activeIndex && <CornerDownLeft size={14} className="hidden shrink-0 text-faint fine:block" />}
                                  </Link>
                                  {hit.kind === "game" && <span className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1"><WatchButton game={hitAsGame(hit)} /><OwnershipPicker game={hitAsGame(hit)} variant="icon" /></span>}
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      );
                    })}
                  </div>

                  {/* Spotlight: a live preview of the highlighted result. Sticky
                      inside the scroll area so it stays in view while the list
                      scrolls beneath the cursor. */}
                  <aside aria-label="Result preview" className="hidden p-3 lg:block">
                    <div className="sticky top-3 flex h-[min(34rem,calc(84vh-11rem))] flex-col gap-2">
                      <div className="min-h-0 flex-1">
                        <SpotlightPreview hit={results[activeIndex] ?? null} onNavigate={onClose} />
                      </div>
                      <button type="button" onClick={openFullSearch} className="group flex w-full shrink-0 items-center justify-between rounded-2xl border border-brand/25 bg-brand/10 px-4 py-3 text-left transition-colors hover:bg-brand/15">
                        <span className="text-sm font-semibold text-text">View every result</span>
                        <ArrowRight size={16} className="text-brand-soft transition-transform group-hover:translate-x-1" />
                      </button>
                    </div>
                  </aside>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 text-[11px] text-faint sm:px-6">
              <span className="hidden items-center gap-2 fine:flex"><Key>↑</Key><Key>↓</Key> navigate <Key>↵</Key> open</span>
              <button type="button" onClick={openFullSearch} disabled={!query.trim()} className="ml-auto inline-flex items-center gap-2 font-semibold text-muted transition-colors hover:text-text disabled:pointer-events-none disabled:opacity-35">
                Full search <ArrowRight size={13} />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function DiscoveryStart({ onClose }: { onClose: () => void }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex items-center gap-2">
        <Sparkles size={15} className="text-brand-soft" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-faint">Explore Arnav Games</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_LINKS.map((link, index) => (
          <Link key={link.href} href={link.href} onClick={onClose} className="group rounded-2xl border border-line bg-white/[0.025] p-4 transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-line-strong hover:bg-white/[0.05]">
            <span className="flex items-center justify-between"><TrendingUp size={15} className={index % 2 ? "text-neon" : "text-brand-soft"} /><ArrowRight size={14} className="text-faint transition-transform group-hover:translate-x-1" /></span>
            <span className="mt-4 block text-sm font-bold">{link.label}</span>
            <span className="mt-1 block text-xs text-faint">{link.detail}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-grid h-5 min-w-5 place-items-center rounded border border-line bg-white/5 px-1 font-sans text-[10px] text-muted">{children}</kbd>;
}
