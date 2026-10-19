"use client";

/**
 * The "Games" view of /search: every matching game as a poster grid, with
 * the site's standard filter toolbar.
 *
 * Filtering is local — the full match list (up to 120) is already on the
 * page — so every facet change is instant and costs no request. Facet
 * options and their counts come from the matches themselves, so a count is
 * always exactly how many results the option leaves (never an estimate), and
 * an option that would leave nothing is never offered.
 */

import { useMemo, useState } from "react";
import { SearchX } from "lucide-react";
import { FilterToolbar, SortMenu, type FacetDef, type SortMenuOption } from "@/components/filters";
import { GameGrid } from "@/components/game/GameGrid";
import { EmptyState } from "@/components/ui/EmptyState";
import { releaseState } from "@/lib/games/release-state";
import type { GameSummary } from "@/lib/games/types";

type SortValue = "relevance" | "newest" | "oldest" | "score" | "name";
type Status = "released" | "upcoming" | "tba";

const SORTS: SortMenuOption<SortValue>[] = [
  { value: "relevance", label: "Best match" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "score", label: "Critic score" },
  { value: "name", label: "Name A–Z" },
];

const STATUS_LABELS: Record<Status, string> = {
  released: "Out now",
  upcoming: "Upcoming",
  tba: "Date to be announced",
};

function statusOf(game: GameSummary, now: Date): Status {
  const state = releaseState(game, now);
  if (state === "upcoming") return "upcoming";
  if (state === "released") return "released";
  return "tba";
}

/** Options from the data itself, most common first, with honest counts. */
function optionsFrom(games: GameSummary[], pick: (game: GameSummary) => { value: string; label: string }[]) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const game of games) {
    for (const { value, label } of pick(game)) {
      const entry = counts.get(value) ?? { label, count: 0 };
      entry.count += 1;
      counts.set(value, entry);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
    .map(([value, { label, count }]) => ({ value, label, count }));
}

export function SearchGameResults({ games, query }: { games: GameSummary[]; query: string }) {
  const [sort, setSort] = useState<SortValue>("relevance");
  const [genres, setGenres] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  // Fixed for the life of the view so status buckets can't shift mid-session.
  const [now] = useState(() => new Date());

  const genreOf = (game: GameSummary) => game.genres.map((genre) => ({ value: genre.slug, label: genre.name }));
  const platformOf = (game: GameSummary) =>
    (game.parentPlatforms.length ? game.parentPlatforms : game.platforms).map((platform) => ({ value: platform.slug, label: platform.name }));

  const filtered = useMemo(() => {
    const list = games.filter((game) => {
      if (genres.length && !game.genres.some((genre) => genres.includes(genre.slug))) return false;
      if (platforms.length && !platformOf(game).some((platform) => platforms.includes(platform.value))) return false;
      if (status.length && !status.includes(statusOf(game, now))) return false;
      return true;
    });
    const byDate = (game: GameSummary) => game.released ?? "";
    switch (sort) {
      case "newest":
        return [...list].sort((a, b) => byDate(b).localeCompare(byDate(a)));
      case "oldest":
        return [...list].sort((a, b) => (byDate(a) || "9999").localeCompare(byDate(b) || "9999"));
      case "score":
        return [...list].sort((a, b) => (b.metacritic ?? -1) - (a.metacritic ?? -1));
      case "name":
        return [...list].sort((a, b) => a.name.localeCompare(b.name));
      default:
        return list;
    }
  }, [games, genres, platforms, status, sort, now]);

  const facets: FacetDef[] = [
    {
      id: "genre",
      label: "Genre",
      mode: "multi",
      options: optionsFrom(games, genreOf),
      selected: genres,
      onChange: setGenres,
    },
    {
      id: "platform",
      label: "Platform",
      mode: "multi",
      options: optionsFrom(games, platformOf),
      selected: platforms,
      onChange: setPlatforms,
    },
    {
      id: "status",
      label: "Release",
      mode: "single",
      anyLabel: "Any release status",
      options: optionsFrom(games, (game) => {
        const value = statusOf(game, now);
        return [{ value, label: STATUS_LABELS[value] }];
      }),
      selected: status,
      onChange: setStatus,
    },
  ].filter((facet) => facet.options.length > 1) as FacetDef[];

  const count = filtered.length;
  const noun = count === 1 ? "game" : "games";
  const clearAll = () => {
    setGenres([]);
    setPlatforms([]);
    setStatus([]);
  };

  return (
    <div>
      <FilterToolbar
        summary={
          <p>
            <span className="font-semibold tabular-nums text-text">{count}</span> {noun} matching “{query}”
          </p>
        }
        actions={<SortMenu options={SORTS} value={sort} onChange={setSort} label="Sort games" />}
        facets={facets}
        onClearAll={clearAll}
        resultLabel={`Show ${count} ${noun}`}
        sheetDescription={`${count} ${noun} match`}
      />
      <div className="mt-6">
        {count > 0 ? (
          <GameGrid games={filtered} priorityCount={4} />
        ) : (
          <EmptyState
            icon={<SearchX size={24} />}
            title="No games match these filters"
            body="Loosen a filter to see more of the matches."
            action={{ onClick: clearAll, label: "Clear filters" }}
          />
        )}
      </div>
    </div>
  );
}
