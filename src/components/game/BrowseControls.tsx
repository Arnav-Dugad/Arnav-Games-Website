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
 * plus an "All filters" sheet. /browse adds a search field and a rail of
 * curated shortcuts above it — the App Store pattern of "type, or start
 * from a suggestion".
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
  type TransitionStartFunction,
} from "react";
import {
  CalendarDays,
  Gamepad2,
  Gauge,
  Gem,
  Joystick,
  Shapes,
  Sparkles,
  Star,
  Swords,
  Trophy,
} from "lucide-react";
import { FilterToolbar, SearchField, SortMenu, type FacetDef } from "@/components/filters";
import { SYSTEM_NAMES } from "@/components/filters/platform-systems";
import { cn } from "@/lib/utils/cn";
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
const THIS_YEAR = `${YEAR}-01-01,${YEAR}-12-31`;
const RETRO = "1970-01-01,1999-12-31";
const DATE_PRESETS = [
  { value: THIS_YEAR, label: `${YEAR} releases`, short: String(YEAR) },
  { value: `2020-01-01,${YEAR - 1}-12-31`, label: `2020–${YEAR - 1}`, short: `2020–${String(YEAR - 1).slice(2)}` },
  { value: "2010-01-01,2019-12-31", label: "2010s" },
  { value: "2000-01-01,2009-12-31", label: "2000s" },
  { value: RETRO, label: "Classics (pre-2000)", short: "Classics" },
];

/**
 * Curated starting points for /browse.
 *
 * Every one is an ordinary combination of the filters below — tapping it sets
 * those params, tapping again removes them — so it can never promise
 * something the catalogue can't filter on. ("Free to play" and "couch co-op"
 * would need price and multiplayer-mode filters the provider doesn't expose,
 * so they're deliberately absent rather than approximated.)
 */
const QUICK_FILTERS: { id: string; label: string; icon: ReactNode; params: Record<string, string> }[] = [
  { id: "rated", label: "Highly rated", icon: <Star size={14} />, params: { metacritic: "80,100" } },
  { id: "year", label: `${YEAR} releases`, icon: <Sparkles size={14} />, params: { dates: THIS_YEAR } },
  { id: "greats", label: "All-time greats", icon: <Trophy size={14} />, params: { metacritic: "90,100", ordering: "-metacritic" } },
  { id: "indie", label: "Indie gems", icon: <Gem size={14} />, params: { genres: "indie", metacritic: "80,100" } },
  { id: "rpg", label: "Role-playing", icon: <Swords size={14} />, params: { genres: "role-playing-rpg" } },
  { id: "retro", label: "Retro classics", icon: <Joystick size={14} />, params: { dates: RETRO, metacritic: "80,100" } },
  { id: "switch2", label: "On Switch 2", icon: <Gamepad2 size={14} />, params: { platforms: "switch-2" } },
];

/** The params this control owns. Everything else in the URL is left alone. */
const FILTER_KEYS = ["genres", "platforms", "metacritic", "dates"] as const;

/* -------------------------------------------------------------------------- */
/* Shared pending state                                                       */
/* -------------------------------------------------------------------------- */

/*
 * Every change here is a navigation that waits on a provider query, and the
 * results grid is server-rendered — outside this component. Sharing the
 * transition lets the grid dim while the next page is on its way, instead of
 * sitting there looking current. Optional: without the provider (as on
 * /upcoming) the controls keep their own transition and nothing changes.
 */
const PendingContext = createContext<{ pending: boolean; start: TransitionStartFunction } | null>(null);

export function BrowsePendingProvider({ children }: { children: ReactNode }) {
  const [pending, start] = useTransition();
  const value = useMemo(() => ({ pending, start }), [pending, start]);
  return <PendingContext value={value}>{children}</PendingContext>;
}

/** Dims (but never blocks) the results while a filter change is loading. */
export function BrowsePendingRegion({ children }: { children: ReactNode }) {
  const pending = useContext(PendingContext)?.pending ?? false;
  return (
    <div
      aria-busy={pending}
      className={cn(
        "transition-opacity duration-300",
        // A short delay so a fast, cached answer doesn't flicker.
        pending && "opacity-50 delay-150",
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

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
  /** A search field above the toolbar, writing `search` to the URL. */
  searchable?: boolean;
  /** The curated shortcut rail (/browse). */
  showQuickFilters?: boolean;
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
  searchable = false,
  showQuickFilters = false,
}: BrowseControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const urlParams = useSearchParams();
  const shared = useContext(PendingContext);
  const own = useTransition();
  const [pending, startTransition] = shared ? [shared.pending, shared.start] : own;

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
    (next: URLSearchParams, replace = false) => {
      // Any filter change invalidates the current page offset.
      next.delete("page");
      const qs = next.toString();
      setOptimisticQs(qs);
      startTransition(() => {
        const href = qs ? `${pathname}?${qs}` : pathname;
        if (replace) router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [router, pathname, startTransition],
  );

  const setParam = useCallback(
    (key: string, value: string | null, replace = false) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      push(next, replace);
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
      const selected = listParam("platforms");
      const options = platforms.map((platform) => ({ value: platform.slug, label: platform.name }));
      // A single system chosen from /platforms ("ps5") isn't a family option;
      // give its pill a real name instead of the raw slug.
      for (const slug of selected) {
        const name = SYSTEM_NAMES.get(slug);
        if (name && !options.some((option) => option.value === slug)) options.push({ value: slug, label: name });
      }
      list.push({
        id: "platforms",
        label: "Platform",
        icon: <Gamepad2 size={15} />,
        mode: "multi",
        options,
        selected,
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

  // With a search field on the page the term is already visible and
  // editable; a removable pill repeating it was noise.
  const extraPills = search && !searchable
    ? [{ key: "search", label: `“${search}”`, onRemove: () => setParam("search", null) }]
    : [];

  const plural = totalCount === 1 ? noun : `${noun}s`;
  const formatted = totalCount.toLocaleString("en-US");

  return (
    <div className="space-y-3">
      {searchable && (
        <BrowseSearch
          value={search}
          onCommit={(term, replace) => setParam("search", term || null, replace)}
        />
      )}
      {showQuickFilters && (
        <QuickFilterRail
          params={params}
          onToggle={(filter, on) => {
            const next = new URLSearchParams(params.toString());
            for (const [key, value] of Object.entries(filter.params)) {
              if (on) next.set(key, value);
              else next.delete(key);
            }
            push(next);
          }}
        />
      )}
      <FilterToolbar
        className={cn((searchable || showQuickFilters) && "pt-2")}
        pending={pending}
        summary={
          // nowrap: at 320px "309,186 games" broke onto two lines beside the sort menu.
          <p className="whitespace-nowrap">
            <span className="font-semibold tabular-nums text-text">{formatted}</span>{" "}
            {search && searchable ? (totalCount === 1 ? "result" : "results") : plural}
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
    </div>
  );
}

/**
 * Search within the catalogue. Typing settles for a moment before it
 * navigates (replacing, not pushing, so the back button isn't a keystroke
 * log); Enter commits at once.
 */
function BrowseSearch({ value, onCommit }: { value: string; onCommit: (term: string, replace: boolean) => void }) {
  const [draft, setDraft] = useState(value);
  // Follow the URL (back/forward, a removed pill) without an effect, so the
  // field never paints the stale term.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    // Our own debounced commit lands here too; keep the reader's trailing
    // space mid-word instead of trimming it out from under the cursor.
    if (draft.trim() !== value) setDraft(value);
  }

  useEffect(() => {
    const term = draft.trim();
    if (term === value) return;
    const timer = window.setTimeout(() => onCommit(term, true), 450);
    return () => window.clearTimeout(timer);
  }, [draft, value, onCommit]);

  return (
    <form
      role="search"
      action="/browse"
      className="sm:max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim() !== value) onCommit(draft.trim(), false);
        // Dismiss the phone keyboard so the results are visible.
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <SearchField
        name="search"
        value={draft}
        onChange={setDraft}
        placeholder="Search games"
        label="Search games"
        className="[&_input]:h-12 [&_input]:text-base"
      />
    </form>
  );
}

function QuickFilterRail({
  params,
  onToggle,
}: {
  params: URLSearchParams;
  onToggle: (filter: (typeof QUICK_FILTERS)[number], on: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Suggestions"
      // Bleeds to the screen edge on phones so the rail visibly continues.
      className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-0.5 sm:mx-0 sm:flex-wrap sm:px-0"
    >
      {QUICK_FILTERS.map((filter) => {
        const on = Object.entries(filter.params).every(([key, value]) => params.get(key) === value);
        return (
          <button
            key={filter.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(filter, !on)}
            className={cn(
              "press inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors coarse:min-h-11 coarse:px-4 coarse:text-[14px]",
              on
                ? "bg-text text-bg"
                : "bg-fg/[0.07] text-text fine:hover:bg-fg/[0.12]",
            )}
          >
            <span aria-hidden className={on ? "text-bg" : "text-brand-soft"}>{filter.icon}</span>
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}
