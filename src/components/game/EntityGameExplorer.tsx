"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { GameGrid } from "./GameGrid";
import { EmptyState } from "@/components/ui/EmptyState";
import type { GameSummary } from "@/lib/games/types";
import { fuzzyMatches } from "@/lib/games/fuzzy-search";
import { SortMenu, type SortMenuOption } from "@/components/filters";

type EntitySort = "featured" | "newest" | "oldest" | "name" | "critic" | "audience" | "anticipated";

const SORT_OPTIONS: SortMenuOption<EntitySort>[] = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "critic", label: "Best critic score" },
  { value: "audience", label: "Largest audience" },
  { value: "anticipated", label: "Most popular" },
  { value: "name", label: "A–Z" },
];

/** How many games one page of the explorer shows, and one "load more" adds. */
const PAGE_STEP = 60;

export function EntityGameExplorer({
  games,
  kind,
}: {
  games: GameSummary[];
  kind: "company" | "character" | "franchise";
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<EntitySort>(
    kind === "franchise" ? "newest" : "featured",
  );
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);
  const normalised = query.trim();

  /*
   * Narrowing the list resets how much of it is shown.
   *
   * Without this, "Load 60 more" stayed in effect across a new search — so a
   * query matching three games still rendered against a 180-item budget, and
   * the "load more" affordance vanished for the next search that needed it.
   *
   * Adjusted during render rather than in an effect: React re-renders with the
   * corrected value before touching the DOM, so there is no flash of the stale
   * count and no second commit.
   */
  const filterKey = `${normalised}|${sort}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setVisibleCount(PAGE_STEP);
  }

  const filtered = useMemo(() => {
    const matches = normalised
      ? games.filter((game) => fuzzyMatches(game.name, normalised))
      : [...games];

    if (sort === "name") return matches.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "newest") {
      return matches.sort((a, b) => (b.released ?? "0000").localeCompare(a.released ?? "0000"));
    }
    if (sort === "oldest") {
      return matches.sort((a, b) => (a.released ?? "9999").localeCompare(b.released ?? "9999"));
    }
    if (sort === "critic") return matches.sort((a, b) => (b.metacritic ?? -1) - (a.metacritic ?? -1));
    if (sort === "audience") return matches.sort((a, b) => b.ratingsCount - a.ratingsCount);
    if (sort === "anticipated") return matches.sort((a, b) => b.added - a.added);
    return matches;
  }, [games, normalised, sort]);
  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="space-y-6">
      <div className="glass flex flex-col gap-2.5 rounded-3xl p-2.5 sm:flex-row sm:items-center sm:gap-3 sm:p-3">
        <label className="relative min-w-0 flex-1">
          <Search aria-hidden size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
          <span className="sr-only">Search this collection</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // Three kinds reach this component; a character page previously
            // read "Search this franchise…".
            placeholder={
              kind === "company"
                ? "Search this studio’s games…"
                : kind === "character"
                  ? "Search this character’s games…"
                  : "Search this franchise…"
            }
            className="h-12 w-full rounded-xl border border-line bg-bg/55 py-2 pl-11 pr-11 text-sm text-text outline-none transition-colors placeholder:text-faint hover:border-line-strong focus:border-brand"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-faint transition-colors hover:bg-fg/[0.06] hover:text-text"
            >
              <X size={15} />
            </button>
          )}
        </label>

        <SortMenu options={SORT_OPTIONS} value={sort} onChange={setSort} label="Sort games" className="shrink-0" />
      </div>

      <p aria-live="polite" className="text-sm text-muted">
        Showing <span className="font-semibold text-text tabular-nums">{visible.length}</span> of{" "}
        <span className="tabular-nums">{filtered.length}</span> matching games
      </p>

      {filtered.length > 0 ? (
        <>
          <GameGrid games={visible} priorityCount={5} />
          {visible.length < filtered.length && (
            <div className="mt-8 flex flex-col items-center gap-3 rounded-3xl border border-line bg-fg/[0.025] p-5 text-center">
              <p className="text-xs text-muted"><span className="font-semibold text-text tabular-nums">{filtered.length - visible.length}</span> more games remain in this complete catalogue.</p>
              <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_STEP)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-5 text-sm font-bold text-brand-soft transition-colors hover:border-brand/50 hover:text-text">Load {PAGE_STEP} more <ChevronDown size={15} /></button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={<Search size={23} />}
          title="No matching games"
          body={`Nothing in this collection matches “${query.trim()}”.`}
          action={{ onClick: () => setQuery(""), label: "Clear search" }}
        />
      )}
    </div>
  );
}
