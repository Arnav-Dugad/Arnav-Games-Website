"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { GameGrid } from "./GameGrid";
import { EmptyState } from "@/components/ui/EmptyState";
import type { GameSummary } from "@/lib/games/types";
import { fuzzyMatches } from "@/lib/games/fuzzy-search";
import { SearchField, SortMenu, type SortMenuOption } from "@/components/filters";

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
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search"
          label="Search these games"
          className="flex-1 sm:max-w-md"
        />
        <SortMenu options={SORT_OPTIONS} value={sort} onChange={setSort} label="Sort games" className="shrink-0" />
      </div>

      {normalised && (
        <p aria-live="polite" className="px-1 text-[13px] text-muted">
          <span className="font-semibold tabular-nums text-text">{filtered.length}</span>{" "}
          {filtered.length === 1 ? "match" : "matches"}
        </p>
      )}

      {filtered.length > 0 ? (
        <>
          <GameGrid games={visible} priorityCount={5} />
          {visible.length < filtered.length && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_STEP)}
                className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-fg/[0.07] px-5 text-[15px] font-semibold text-text transition-colors fine:hover:bg-fg/[0.12]"
              >
                Show more
                <span className="tabular-nums text-muted">{(filtered.length - visible.length).toLocaleString("en-US")}</span>
                <ChevronDown size={16} aria-hidden />
              </button>
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
