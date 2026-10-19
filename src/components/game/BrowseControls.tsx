"use client";

/**
 * Filter and sort controls for the catalogue pages (/browse, /upcoming).
 *
 * State lives entirely in the URL — filters are shareable, survive a refresh
 * and give the back button real meaning. Nothing is mirrored into component
 * state, which removes the usual class of desync bugs between the two.
 *
 * Presentation is the shared collapsed toolbar: a result count and sort menu,
 * then one pill per facet that opens a popover (desktop) or sheet (touch),
 * plus an "All filters" sheet. The previous design showed every genre and
 * platform as an always-expanded wall of chips on desktop, which pushed the
 * actual results below the fold before anyone had chosen anything.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { CalendarDays, Gamepad2, Gauge, Shapes } from "lucide-react";
import { FilterToolbar, SortMenu, type ActiveFilterPill, type FacetDef } from "@/components/filters";
import type { Ref, SortKey } from "@/lib/games/types";

export interface SortOption {
  value: SortKey;
  label: string;
}

export const BROWSE_SORTS: SortOption[] = [
  { value: "-added", label: "Most popular" },
  { value: "-reviews", label: "Most discussed" },
  { value: "-released", label: "Newest first" },
  { value: "released", label: "Oldest first" },
  { value: "-metacritic", label: "Best critic score" },
  { value: "metacritic", label: "Lowest critic score" },
  { value: "-rating", label: "Best user score" },
  { value: "rating", label: "Lowest user score" },
  { value: "-hypes", label: "Most anticipated" },
  { value: "name", label: "A–Z" },
  { value: "-name", label: "Z–A" },
];

/** A calendar wants "soonest" as its default, not "most popular". */
export const UPCOMING_SORTS: SortOption[] = [
  { value: "released", label: "Soonest first" },
  { value: "-released", label: "Furthest out" },
  { value: "-hypes", label: "Most anticipated" },
  { value: "-reviews", label: "Largest audience" },
  { value: "-metacritic", label: "Highest rated" },
  { value: "name", label: "A–Z" },
  { value: "-name", label: "Z–A" },
];

const SCORE_PRESETS = [
  { value: "90,100", label: "90+ essential", short: "90+" },
  { value: "80,100", label: "80+ acclaimed", short: "80+" },
  { value: "70,100", label: "70+ recommended", short: "70+" },
];

const YEAR = new Date().getUTCFullYear();
const DATE_PRESETS = [
  { value: `${YEAR}-01-01,${YEAR}-12-31`, label: `${YEAR} releases`, short: String(YEAR) },
  { value: `2020-01-01,${YEAR - 1}-12-31`, label: `2020–${YEAR - 1}`, short: `2020–${String(YEAR - 1).slice(2)}` },
  { value: "2010-01-01,2019-12-31", label: "2010s" },
  { value: "2000-01-01,2009-12-31", label: "2000s" },
  { value: "1970-01-01,1999-12-31", label: "Classics (pre-2000)", short: "Classics" },
];

/** The params this control owns. Everything else in the URL is left alone. */
const FILTER_KEYS = ["genres", "platforms", "metacritic", "dates"] as const;

interface BrowseControlsProps {
  genres: Ref[];
  platforms: Ref[];
  totalCount: number;
  sorts?: SortOption[];
  /** The sort that applies when `ordering` is absent from the URL. */
  defaultSort?: SortKey;
  /** Noun used in the result count, e.g. "release". */
  noun?: string;
  showDatePresets?: boolean;
  /**
   * The critic-score facet. Off where the page can't honour it — unreleased
   * games have no reviews, so on /upcoming it would be a control that does
   * nothing.
   */
  showScore?: boolean;
  /** Off where the list order is fixed by the view (calendar week/month grids). */
  showSort?: boolean;
}

export function BrowseControls({
  genres,
  platforms,
  totalCount,
  sorts = BROWSE_SORTS,
  defaultSort = "-added",
  noun = "game",
  showDatePresets = true,
  showScore = true,
  showSort = true,
}: BrowseControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const urlParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  /*
   * Optimistic query string.
   *
   * Every change is a navigation that takes a server render to land. Reading
   * `useSearchParams()` alone meant two quick toggles in an open facet both
   * started from the same stale URL, so the second silently undid the first,
   * and checkmarks lagged the tap by the length of the render. Changes are
   * applied to this copy immediately; it's dropped as soon as the real URL
   * catches up (adjusted during render, so nothing paints the stale state).
   */
  const urlQs = urlParams.toString();
  const [optimisticQs, setOptimisticQs] = useState<string | null>(null);
  const [lastUrlQs, setLastUrlQs] = useState(urlQs);
  if (urlQs !== lastUrlQs) {
    setLastUrlQs(urlQs);
    setOptimisticQs(null);
  }
  const params = useMemo(() => new URLSearchParams(optimisticQs ?? urlQs), [optimisticQs, urlQs]);

  const activeSort = (params.get("ordering") as SortKey | null) ?? defaultSort;
  const search = params.get("search") ?? "";

  const push = useCallback(
    (next: URLSearchParams) => {
      // Any filter change invalidates the current page offset.
      next.delete("page");
      const qs = next.toString();
      setOptimisticQs(qs);
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [router, pathname],
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      push(next);
    },
    [params, push],
  );

  const setSort = useCallback(
    (value: SortKey) => {
      // The default lives implicitly in the absence of the param, so URLs stay
      // clean and "reset" has exactly one meaning.
      setParam("ordering", value === defaultSort ? null : value);
    },
    [setParam, defaultSort],
  );

  const clearAll = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    // Only filters go. A search term is the user's own words, and page-level
    // params (the /upcoming horizon, the sort) aren't filters — wiping them
    // made "Clear all" on the calendar silently jump back to the default
    // window.
    for (const key of FILTER_KEYS) next.delete(key);
    push(next);
  }, [params, push]);

  const facets = useMemo<FacetDef[]>(() => {
    const listParam = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
    const multi = (key: string) => (values: string[]) =>
      setParam(key, values.length > 0 ? values.join(",") : null);
    const single = (key: string) => (values: string[]) => setParam(key, values[0] ?? null);

    const list: FacetDef[] = [];
    if (genres.length > 0) {
      list.push({
        id: "genres",
        label: "Genre",
        icon: <Shapes size={15} />,
        mode: "multi",
        options: genres.map((genre) => ({ value: genre.slug, label: genre.name })),
        selected: listParam("genres"),
        onChange: multi("genres"),
      });
    }
    if (platforms.length > 0) {
      list.push({
        id: "platforms",
        label: "Platform",
        icon: <Gamepad2 size={15} />,
        mode: "multi",
        options: platforms.map((platform) => ({ value: platform.slug, label: platform.name })),
        selected: listParam("platforms"),
        onChange: multi("platforms"),
      });
    }
    if (showScore) {
      const score = params.get("metacritic");
      list.push({
        id: "metacritic",
        label: "Critic score",
        icon: <Gauge size={15} />,
        mode: "single",
        anyLabel: "Any score",
        // A hand-written URL with a custom range still shows as selected.
        options: score && !SCORE_PRESETS.some((item) => item.value === score)
          ? [...SCORE_PRESETS, { value: score, label: `Score ${score.replace(",", "–")}` }]
          : SCORE_PRESETS,
        selected: score ? [score] : [],
        onChange: single("metacritic"),
      });
    }
    if (showDatePresets) {
      const dates = params.get("dates");
      list.push({
        id: "dates",
        label: "Release era",
        icon: <CalendarDays size={15} />,
        mode: "single",
        anyLabel: "Any year",
        options: dates && !DATE_PRESETS.some((item) => item.value === dates)
          ? [...DATE_PRESETS, { value: dates, label: "Custom release window", short: "Custom" }]
          : DATE_PRESETS,
        selected: dates ? [dates] : [],
        onChange: single("dates"),
      });
    }
    return list;
  }, [genres, platforms, params, setParam, showScore, showDatePresets]);

  const extraPills: ActiveFilterPill[] = search
    ? [{ key: "search", label: `“${search}”`, onRemove: () => setParam("search", null) }]
    : [];

  const plural = totalCount === 1 ? noun : `${noun}s`;
  const formatted = totalCount.toLocaleString("en-US");

  return (
    <FilterToolbar
      pending={pending}
      summary={
        // nowrap: at 320px "309,186 games" broke onto two lines beside the sort menu.
        <p className="whitespace-nowrap">
          <span className="font-semibold tabular-nums text-text">{formatted}</span> {plural}
        </p>
      }
      actions={showSort &&
        <SortMenu
          options={sorts}
          value={activeSort}
          onChange={setSort}
          label={`Sort ${noun}s`}
          className="max-w-[11.5rem] sm:max-w-none"
        />
      }
      facets={facets}
      extraPills={extraPills}
      onClearAll={clearAll}
      resultLabel={`Show ${formatted} ${plural}`}
      sheetDescription={`${formatted} ${plural} match`}
    />
  );
}
