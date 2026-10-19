"use client";

/**
 * The reader's owned-games collection, as a first-class browsable page.
 *
 * A collection is a fundamentally different thing to browse than a catalogue:
 * it is small enough to hold in your head, so the useful operations are
 * "narrow it down" and "reorder it", not "search 300,000 records". Everything
 * here works against the already-loaded watchlist snapshot — no network, no
 * pagination, instant feedback on every control.
 *
 * A game can be owned on several storefronts at once. Filtering by store shows
 * every copy that matches rather than collapsing to one, because owning the
 * same title twice is normal and hiding it would misreport the collection.
 */

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { CalendarClock, Check, Layers3, Library, PackageOpen, PencilLine, Trophy } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { GameCover } from "@/components/game/GameCover";
import { ScorePill } from "@/components/ui/ScoreRing";
import { Button } from "@/components/ui/Button";
import { FilterToolbar, SearchField, SegmentedControl, SortMenu, type FacetDef } from "@/components/filters";
import { Reveal } from "@/components/motion/Reveal";
import {
  PosterSizeToggle,
  posterGridClass,
  usePosterSize,
} from "@/components/ui/PosterSizeToggle";
import { PosterTile } from "@/components/game/PosterTile";
import { OwnershipPicker } from "@/components/game/OwnershipPicker";
import { BatchEditPanel } from "./BatchEditPanel";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { OWNERSHIP_PLATFORMS, ownershipPlatform } from "@/lib/games/stores-catalog";
import { cn } from "@/lib/utils/cn";
import { fuzzyMatches } from "@/lib/games/fuzzy-search";
import { releaseState, type ReleaseState } from "@/lib/games/release-state";
import type { WatchlistEntry, WatchStatus } from "@/lib/firebase/db";
import type { GameSummary } from "@/lib/games/types";

type SortKey = "added" | "name" | "score" | "released";
type ReleaseFilter = ReleaseState | "all";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "added", label: "Recently added" },
  { value: "name", label: "A–Z" },
  { value: "score", label: "Highest rated" },
  { value: "released", label: "Newest release" },
];

// Ordered the way a backlog flows, with the unsorted pile last.
const STATUS_FILTERS: { value: WatchStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "want", label: "Want to play" },
  { value: "playing", label: "Playing" },
  { value: "played", label: "Played" },
  { value: "none", label: "No status" },
];

const RELEASE_OPTIONS: { value: ReleaseState; label: string; short?: string }[] = [
  { value: "released", label: "Released" },
  { value: "upcoming", label: "Not released yet", short: "Upcoming" },
  { value: "unknown", label: "Date unknown" },
];

export function LibraryView({
  previewEntries,
}: {
  /** Dev-only sample data for `/library/preview`; bypasses auth. */
  previewEntries?: WatchlistEntry[];
} = {}) {
  const { user: authUser } = useAuth();
  const live = useWatchlist();
  const entries = previewEntries ?? live.entries;
  const loading = previewEntries ? false : live.loading;
  const user = previewEntries ? true : authUser;

  const [store, setStore] = useState<string | "all">("all");
  const [status, setStatus] = useState<WatchStatus | "all">("all");
  const [release, setRelease] = useState<ReleaseFilter>("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [query, setQuery] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { size: posterSize, setSize: setPosterSize } = usePosterSize("arnav-games:library-size");

  /** Only games the reader has actually marked as owned somewhere. */
  const owned = useMemo(
    () => entries.filter((entry) => (entry.ownedOn ?? []).length > 0),
    [entries],
  );

  /** Stores that actually appear in this collection, with counts. */
  const stores = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of owned) {
      for (const slug of entry.ownedOn ?? []) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([slug, count]) => ({
        slug,
        count,
        name: ownershipPlatform(slug)?.name ?? slug,
        icon: ownershipPlatform(slug)?.icon ?? null,
      }))
      .sort((a, b) => b.count - a.count);
  }, [owned]);

  const visible = useMemo(() => {
    const term = query.trim();

    const filtered = owned.filter((entry) => {
      if (store !== "all" && !(entry.ownedOn ?? []).includes(store)) return false;
      if (status !== "all" && entry.status !== status) return false;
      if (release !== "all" && releaseState(entry) !== release) return false;
      if (term && !fuzzyMatches(entry.name, term)) return false;
      return true;
    });

    const sorted = [...filtered];
    switch (sort) {
      case "name":
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case "score":
        return sorted.sort((a, b) => (b.metacritic ?? -1) - (a.metacritic ?? -1));
      case "released":
        // Undated titles sort last rather than being treated as ancient.
        return sorted.sort((a, b) => (b.released ?? "").localeCompare(a.released ?? ""));
      default:
        return sorted.sort((a, b) => b.addedAt - a.addedAt);
    }
  }, [owned, store, status, release, query, sort]);

  const activeFilters = (store !== "all" ? 1 : 0) + (status !== "all" ? 1 : 0) + (release !== "all" ? 1 : 0) + (query ? 1 : 0);
  const statusCounts = useMemo(() => {
    const counts: Record<WatchStatus | "all", number> = { all: owned.length, none: 0, want: 0, playing: 0, played: 0 };
    for (const entry of owned) counts[entry.status]++;
    return counts;
  }, [owned]);

  const releaseCounts = useMemo(() => {
    const counts: Record<ReleaseState, number> = { released: 0, upcoming: 0, unknown: 0 };
    for (const entry of owned) counts[releaseState(entry)]++;
    return counts;
  }, [owned]);

  const facets = useMemo<FacetDef[]>(() => [
    {
      id: "store",
      label: "Store",
      mode: "single",
      anyLabel: "All stores",
      options: stores.map((option) => ({
        value: option.slug,
        label: option.name,
        count: option.count,
        icon: option.icon ? <BrandIcon name={option.icon} size={14} title={null} /> : undefined,
      })),
      selected: store === "all" ? [] : [store],
      onChange: (next) => setStore(next[0] ?? "all"),
    },
    {
      id: "release",
      label: "Release",
      mode: "single",
      anyLabel: "Any release state",
      options: RELEASE_OPTIONS.map((option) => ({ ...option, count: releaseCounts[option.value] })),
      selected: release === "all" ? [] : [release],
      onChange: (next) => setRelease((next[0] as ReleaseState | undefined) ?? "all"),
    },
  ], [stores, store, release, releaseCounts]);

  const collection = useMemo(() => ({
    copies: owned.reduce((sum, entry) => sum + new Set(entry.ownedOn ?? []).size, 0),
    completed: owned.filter((entry) => entry.status === "played").length,
    upcoming: owned.filter((entry) => releaseState(entry) === "upcoming").length,
  }), [owned]);

  if (!user) {
    return (
      <EmptyState
        title="Sign in to see your library"
        body="Your collection is tied to your account, so it follows you to any device."
        action={{ href: "/login", label: "Sign in" }}
      />
    );
  }

  if (loading) {
    return (
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="shimmer-bg h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (owned.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        body="Open any game and use “I own this” to record where you bought it — Steam, PlayStation, a physical copy, wherever."
        action={{ href: "/browse", label: "Find your games" }}
      />
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-muted">Manage unique games while preserving every owned copy.</p>
        <button type="button" onClick={() => { setBatchMode((value) => !value); setSelected(new Set()); }} aria-pressed={batchMode} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors", batchMode ? "border-brand/45 bg-brand/15 text-text" : "border-fg/10 bg-fg/[0.06] text-text fine:hover:bg-fg/[0.1]")}><PencilLine size={15} />{batchMode ? "Exit batch edit" : "Batch edit"}</button>
      </div>

      {batchMode && (
        <BatchEditPanel
          gameIds={[...selected]}
          onDone={() => setSelected(new Set())}
          onClose={() => { setBatchMode(false); setSelected(new Set()); }}
        />
      )}

      {/* One game stays one game even when several owned copies exist. */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <LibraryMetric icon={<Library size={16} />} label="Unique games" value={owned.length} tone="mint" />
        <LibraryMetric icon={<Layers3 size={16} />} label="Owned copies" value={collection.copies} />
        <LibraryMetric icon={<Trophy size={16} />} label="Completed" value={collection.completed} tone="gold" />
        <LibraryMetric icon={<CalendarClock size={16} />} label="Not released yet" value={collection.upcoming} tone="brand" />
      </div>

      {/*
        Controls, collapsed. Status is the axis people switch most, so it gets
        a segmented control; store and release state fold into facet pills.
      */}
      <div className="space-y-3">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search your library"
          label="Search your library"
          className="sm:max-w-md"
        />

        <SegmentedControl
          label="Play status"
          value={status}
          onChange={setStatus}
          fill={false}
          className="max-w-full sm:w-fit"
          segments={STATUS_FILTERS.map((option) => ({
            value: option.value,
            label: option.label,
            count: statusCounts[option.value],
          }))}
        />

        <FilterToolbar
          summary={
            <p>
              {activeFilters > 0 ? (
                <>
                  <span className="font-semibold tabular-nums text-text">{visible.length}</span> of {owned.length} games
                </>
              ) : (
                <>
                  <span className="font-semibold tabular-nums text-text">{owned.length}</span> {owned.length === 1 ? "game" : "games"}
                </>
              )}
            </p>
          }
          actions={<SortMenu options={SORTS} value={sort} onChange={setSort} label="Sort library" />}
          facets={facets}
          onClearAll={() => {
            setStore("all");
            setRelease("all");
          }}
          resultLabel={`Show ${visible.length} ${visible.length === 1 ? "game" : "games"}`}
          railLabel="Library filters"
          railTrailing={<PosterSizeToggle size={posterSize} onChange={setPosterSize} />}
        />

        {batchMode && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-fg/[0.03] px-4 py-3 text-xs">
            <button type="button" onClick={() => setSelected(new Set(visible.map((entry) => entry.gameId)))} className="min-h-9 font-semibold text-brand-soft hover:text-text">Select all {visible.length} visible</button>
            <button type="button" onClick={() => setSelected(new Set())} className="min-h-9 font-semibold text-faint hover:text-text">Clear selection</button>
            <span className="ml-auto tabular-nums text-muted">{selected.size} selected</span>
          </div>
        )}
      </div>

      {/* Results */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed border-line py-16 text-center">
          <PackageOpen size={22} className="text-faint" />
          <p className="mt-3 text-sm text-muted">Nothing in your library matches those filters.</p>
          <button
            type="button"
            onClick={() => {
              setStore("all");
              setStatus("all");
              setRelease("all");
              setQuery("");
            }}
            className="mt-4 text-xs font-medium text-brand-soft underline underline-offset-2"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul className={cn("grid gap-3", posterGridClass(posterSize))}>
          {visible.map((entry, index) => (
            <li key={entry.gameId} className="relative">
              {batchMode && <SelectionToggle selected={selected.has(entry.gameId)} name={entry.name} onToggle={() => setSelected(toggleSelected(selected, entry.gameId))} />}
              {/* Mount-based: filtering re-mounts these while the reader is
                  already scrolled into the results. */}
              <Reveal delay={Math.min(index, 10) * 0.025} blur={false} onMount>
                {posterSize === "list" ? (
                  <LibraryRow entry={entry} />
                ) : (
                  <PosterTile
                    entry={entry}
                    size={posterSize === "large" ? "large" : "compact"}
                    badge={STATUS_LABELS[entry.status]}
                  />
                )}
              </Reveal>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function toggleSelected(selected: Set<number>, gameId: number): Set<number> {
  const next = new Set(selected);
  if (next.has(gameId)) next.delete(gameId);
  else next.add(gameId);
  return next;
}

function SelectionToggle({ selected, name, onToggle }: { selected: boolean; name: string; onToggle: () => void }) {
  return <button type="button" onClick={onToggle} aria-label={`${selected ? "Deselect" : "Select"} ${name}`} aria-pressed={selected} className={cn("absolute inset-0 z-30 rounded-2xl p-2 text-left transition-shadow", selected && "ring-2 ring-inset ring-brand")}><span className={cn("grid h-10 w-10 place-items-center rounded-full border shadow-xl backdrop-blur-xl transition-colors", selected ? "border-brand/60 bg-brand text-white" : "border-white/20 bg-black/75 text-white hover:bg-black")}><Check size={16} className={cn(!selected && "opacity-0")} /></span></button>;
}

/* -------------------------------------------------------------------------- */

const STATUS_LABELS: Record<WatchStatus, string> = {
  none: "No status",
  want: "Want to play",
  playing: "Playing",
  played: "Played",
};

function LibraryRow({ entry }: { entry: WatchlistEntry }) {
  const owned = entry.ownedOn ?? [];
  const game = entryAsGame(entry);

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel/50 p-3 transition-all duration-300 fine:hover:border-line-strong fine:hover:bg-panel sm:gap-3.5">
      <Link href={`/game/${entry.slug}`} className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg">
        <GameCover
          name={entry.name}
          slug={entry.slug}
          image={entry.image}
          imageFallback={entry.imageFallback}
          width={160}
          sizes="48px"
        />
      </Link>

      <span className="min-w-0 flex-1">
        <Link href={`/game/${entry.slug}`} className="block truncate text-sm font-semibold hover:text-brand-soft">{entry.name}</Link>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] uppercase tracking-[0.08em] text-faint">
            {STATUS_LABELS[entry.status]}
          </span>
          {entry.released && (
            <span className="text-[11px] text-muted tabular-nums">
              {entry.released.slice(0, 4)}
            </span>
          )}
        </span>
        <span className="mt-1.5 flex items-center gap-1.5">
          {owned.slice(0, 5).map((slug) => {
            const platform = OWNERSHIP_PLATFORMS.find((p) => p.slug === slug);
            return platform?.icon ? (
              <BrandIcon key={slug} name={platform.icon} size={12} title={platform.name} />
            ) : (
              <span key={slug} className="text-[10px] text-faint">
                {platform?.name ?? slug}
              </span>
            );
          })}
        </span>
      </span>

      <ScorePill score={entry.metacritic} className="hidden sm:inline-flex" />
      <OwnershipPicker game={game} variant="icon" />
    </div>
  );
}

function entryAsGame(entry: WatchlistEntry): GameSummary {
  return {
    id: entry.gameId,
    slug: entry.slug,
    name: entry.name,
    released: entry.released,
    releaseWindow: entry.releaseWindow,
    tba: entry.tba,
    image: entry.image,
    imageFallback: entry.imageFallback,
    rating: 0,
    ratingsCount: 0,
    metacritic: entry.metacritic,
    platforms: [],
    parentPlatforms: (entry.platformSlugs ?? []).map((slug, index) => ({ id: -(index + 1), slug, name: slug })),
    genres: entry.genres ?? [],
    screenshots: [],
    esrb: null,
    popScore: null,
    heroTrailer: null,
    playtime: entry.playtime ?? 0,
    added: 0,
  };
}

function LibraryMetric({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "brand" | "mint" | "gold";
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-panel/45 p-3.5 sm:p-4">
      <div className={cn(
        "mb-3 grid h-8 w-8 place-items-center rounded-xl bg-fg/[0.05] text-muted",
        tone === "brand" && "bg-brand/15 text-brand-soft",
        tone === "mint" && "bg-mint/10 text-mint",
        tone === "gold" && "bg-amber-400/10 text-amber-300",
      )}>{icon}</div>
      <p className="font-display text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-0.5 truncate text-[11px] uppercase tracking-[0.06em] text-faint">{label}</p>
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: { href: string; label: string };
}) {
  return (
    <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-line py-16 text-center">
      <PackageOpen size={22} className="text-faint" />
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-muted">{body}</p>
      <Button href={action.href} variant="secondary" size="sm" className="mt-5">
        {action.label}
      </Button>
    </div>
  );
}
