"use client";

/**
 * The reader's owned-games collection.
 *
 * Laid out the way Apple Music treats a library: one headline (how big it
 * is, how much is finished, how many hours are waiting), then smart groups
 * that answer the questions people actually open a library with — what am I
 * playing, what's next, what's sitting unplayed on which system — and only
 * then the full, filterable collection, as a grid, a list, or a shelf of
 * covers you can pick up and throw.
 *
 * Everything works against the already-loaded watchlist snapshot: no
 * network for browsing, no pagination, instant feedback on every control.
 * The one fetch is IGDB time-to-beat for the backlog-hours figure, shared
 * with /stats so both pages quote the same number.
 *
 * A game can be owned on several storefronts at once. Store filters show
 * every copy that matches rather than collapsing to one, because owning the
 * same title twice is normal and hiding it would misreport the collection.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Boxes, Check, LayoutGrid, PackageOpen, PencilLine, Rows3 } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { GameCover } from "@/components/game/GameCover";
import { ScorePill } from "@/components/ui/ScoreRing";
import { EmptyState } from "@/components/ui/EmptyState";
import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { FilterToolbar, SearchField, SegmentedControl, SortMenu, type FacetDef } from "@/components/filters";
import { Reveal } from "@/components/motion/Reveal";
import { CountUp } from "@/components/motion/text";
import { PosterTile } from "@/components/game/PosterTile";
import { OwnershipPicker } from "@/components/game/OwnershipPicker";
import { entryAsGameSummary } from "@/components/interactions/game-menu-targets";
import { useTimeToBeat } from "@/components/stats/useTimeToBeat";
import { BatchEditPanel } from "./BatchEditPanel";
import { SteamImportButton } from "./SteamImportButton";
import { BacklogRoulette } from "./BacklogRoulette";
import { RailTabs, SmartRail } from "./SmartRail";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { usePreferences } from "@/lib/preferences/PreferencesProvider";
import { OWNERSHIP_PLATFORMS, ownershipPlatform } from "@/lib/games/stores-catalog";
import { buildPersonalAnalytics, type TimeToBeatLike } from "@/lib/games/stats";
import { backlogForecast, type BacklogForecast } from "@/lib/games/forecast";
import { usePersonal } from "@/lib/personal/store";
import { LiquidRing } from "@/components/stats/charts/LiquidRing";
import { ForecastNote } from "@/components/stats/ForecastNote";
import { fuzzyMatches } from "@/lib/games/fuzzy-search";
import { releaseState, type ReleaseState } from "@/lib/games/release-state";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import type { WatchlistEntry, WatchStatus } from "@/lib/firebase/db";
import type { GamePassMatches } from "@/lib/games/types";

/*
 * The shelf is a physics toy: heavy, rarely opened, and meaningless without
 * a browser. It never ships in the server bundle or the first paint.
 */
const PhysicsShelf = dynamic(() => import("@/components/shelf/PhysicsShelf"), {
  ssr: false,
  loading: () => <Skeleton className="h-[480px] rounded-3xl" />,
});

/*
 * Network-backed shelves (cloud/Game Pass matches, device recommendations): they
 * only mean anything for a signed-in reader's own data, so they never render
 * on the server and stay out of the first chunk.
 */
const CloudPlay = dynamic(() => import("./CloudPlay"), { ssr: false });
const DeviceRecommendations = dynamic(() => import("./DeviceRecommendations"), { ssr: false });

type SortKey = "added" | "name" | "score" | "released";
type ReleaseFilter = ReleaseState | "all";
type ViewMode = "grid" | "list" | "shelf";

const VIEW_KEY = "arnav-games:library-view";
const SHELF_LIMIT = 60;

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

const STATUS_LABELS: Record<WatchStatus, string> = {
  none: "No status",
  want: "Want to play",
  playing: "Playing",
  played: "Played",
};

const hoursOf = (ttb: TimeToBeatLike | undefined) => ttb?.normally ?? ttb?.hastily ?? null;
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en")} ${count === 1 ? one : many}`;

export function LibraryView({
  previewEntries,
  previewHours,
  previewGamePass,
}: {
  /** Dev-only sample data for `/library/preview`; bypasses auth. */
  previewEntries?: WatchlistEntry[];
  previewHours?: Record<number, TimeToBeatLike>;
  previewGamePass?: GamePassMatches;
} = {}) {
  const live = useWatchlist();
  const entries = previewEntries ?? live.entries;
  const loading = previewEntries ? false : live.loading;

  /** Only games the reader has actually marked as owned somewhere. */
  const owned = useMemo(() => entries.filter((entry) => (entry.ownedOn ?? []).length > 0), [entries]);
  const ttb = useTimeToBeat(owned, { enabled: !loading, preview: previewHours });

  const [store, setStore] = useState<string | "all">("all");
  const [status, setStatus] = useState<WatchStatus | "all">("all");
  const [release, setRelease] = useState<ReleaseFilter>("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [query, setQuery] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { posterSizes, setPosterSize } = usePreferences();
  const storedView = posterSizes[VIEW_KEY];
  const view: ViewMode = storedView === "list" || storedView === "shelf" ? storedView : "grid";
  const collectionRef = useRef<HTMLElement>(null);

  /** Stores that actually appear in this collection, with counts. */
  const stores = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of owned) for (const slug of new Set(entry.ownedOn ?? [])) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    return [...counts.entries()]
      .map(([slug, count]) => ({ slug, count, name: ownershipPlatform(slug)?.name ?? slug, icon: ownershipPlatform(slug)?.icon ?? null }))
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

  const analytics = useMemo(
    () => buildPersonalAnalytics(owned, { timeToBeat: ttb.status === "ready" ? ttb.data : null }),
    [owned, ttb.status, ttb.data],
  );

  const { playtime } = usePersonal();
  const forecast = useMemo(
    () => (ttb.status === "ready" && ttb.data ? backlogForecast(owned, ttb.data, playtime) : null),
    [owned, ttb.status, ttb.data, playtime],
  );

  const groups = useMemo(() => smartGroups(owned), [owned]);

  const clearFilters = () => {
    setStore("all");
    setStatus("all");
    setRelease("all");
    setQuery("");
  };

  /** "See all" on a smart group: the same filter, applied to the full collection below. */
  const showStatus = (next: WatchStatus) => {
    clearFilters();
    setStatus(next);
    haptic("selection");
    collectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) return <LibrarySkeleton />;

  if (owned.length === 0) {
    return (
      <Container className="py-8">
        <EmptyState
          icon={<PackageOpen size={24} />}
          title="Your library is empty"
          body="Open any game and use “I own this” to record where you have it — Steam, PlayStation, a physical copy, anywhere."
          action={{ href: "/browse", label: "Find your games" }}
          secondaryAction={{ href: "/watchlist", label: "Open your watchlist" }}
        />
        <div className="mt-5 flex flex-col items-center gap-2 text-center">
          <p className="text-[14px] text-muted">Play on PC? Bring your whole Steam library across in one go.</p>
          <SteamImportButton variant="primary" />
        </div>
      </Container>
    );
  }

  return (
    <div className="pb-8 lg:pb-12">
      <Container>
        <LibraryHero owned={owned} analytics={analytics} hoursStatus={ttb.status} storeCount={stores.length} forecast={forecast} />
      </Container>

      <div className="mt-10 space-y-10 sm:mt-14 sm:space-y-14">
        {groups.playing.length > 0 && (
          <SmartRail title="Playing now" count={groups.playing.length} onSeeAll={() => showStatus("playing")}>
            {groups.playing.map((entry) => (
              <PosterTile key={entry.gameId} entry={entry} size="large" badge={playedOn(entry)} />
            ))}
          </SmartRail>
        )}
        {groups.upNext.length > 0 && (
          <SmartRail title="Up next" count={groups.upNext.length} onSeeAll={() => showStatus("want")}>
            {groups.upNext.map((entry) => (
              <PosterTile key={entry.gameId} entry={entry} badge={hoursBadge(ttb.data?.[entry.gameId])} />
            ))}
          </SmartRail>
        )}
        <CloudPlay entries={entries} hours={ttb.data} preview={previewGamePass} />
        {groups.backlog.length > 0 && <BacklogByPlatform platforms={groups.backlog} hours={ttb.data} />}
        {groups.finished.length > 0 && (
          <SmartRail title="Recently finished" count={groups.finished.length} onSeeAll={() => showStatus("played")}>
            {groups.finished.map((entry) => (
              <PosterTile key={entry.gameId} entry={entry} badge={finishedLabel(entry)} />
            ))}
          </SmartRail>
        )}

        <Container>
          <BacklogRoulette preview={previewEntries ? { entries: previewEntries, hours: previewHours } : undefined} />
        </Container>

        <DeviceRecommendations entries={entries} />
      </div>

      <Container>
        <section ref={collectionRef} aria-labelledby="library-all" className="mt-12 scroll-mt-24 sm:mt-16">
          <div className="flex items-end gap-1 sm:gap-2">
            <h2 id="library-all" className="whitespace-nowrap font-display text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">All games</h2>
            <span className="ml-auto" />
            <SteamImportButton variant="custom" className="press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[15px] font-medium text-brand-soft fine:hover:bg-brand/10">
              <BrandIcon name="steam" size={15} title={null} />
              <span className="max-sm:hidden">Import from Steam</span>
              <span className="sm:hidden max-[359px]:sr-only">Import</span>
            </SteamImportButton>
            {view !== "shelf" && (
              <button
                type="button"
                onClick={() => {
                  setBatchMode((value) => !value);
                  setSelected(new Set());
                }}
                aria-pressed={batchMode}
                className={cn(
                  "press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[15px] font-medium transition-colors",
                  batchMode ? "bg-brand/15 text-text" : "text-brand-soft fine:hover:bg-brand/10",
                )}
              >
                <PencilLine size={15} aria-hidden />
                {batchMode ? "Done" : "Select"}
              </button>
            )}
          </div>

          {batchMode && (
            <div className="mt-4">
              <BatchEditPanel
                gameIds={[...selected]}
                onDone={() => setSelected(new Set())}
                onClose={() => {
                  setBatchMode(false);
                  setSelected(new Set());
                }}
              />
            </div>
          )}

          {/*
            Controls, collapsed. Status is the axis people switch most, so it
            gets a segmented control; store and release state fold into facet
            pills; the view switch sits at the end of the rail.
          */}
          <div className="mt-5 space-y-3">
            <SearchField value={query} onChange={setQuery} placeholder="Search your library" label="Search your library" className="sm:max-w-md" />
            <SegmentedControl
              label="Play status"
              value={status}
              onChange={setStatus}
              fill={false}
              className="max-w-full sm:w-fit"
              segments={STATUS_FILTERS.map((option) => ({ value: option.value, label: option.label, count: statusCounts[option.value] }))}
            />
            <FilterToolbar
              summary={
                <p>
                  {activeFilters > 0 ? (
                    <><span className="font-semibold tabular-nums text-text">{visible.length}</span> of {owned.length} games</>
                  ) : (
                    <><span className="font-semibold tabular-nums text-text">{owned.length}</span> {owned.length === 1 ? "game" : "games"}</>
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
              railTrailing={
                <ViewSwitch
                  value={view}
                  onChange={(next) => {
                    setPosterSize(VIEW_KEY, next);
                    if (next === "shelf") {
                      setBatchMode(false);
                      setSelected(new Set());
                    }
                  }}
                />
              }
            />

            {batchMode && (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-fg/[0.04] px-4 py-2 text-[13px]">
                <button type="button" onClick={() => setSelected(new Set(visible.map((entry) => entry.gameId)))} className="min-h-11 font-semibold text-brand-soft fine:hover:text-text">
                  Select all {visible.length}
                </button>
                <button type="button" onClick={() => setSelected(new Set())} className="min-h-11 font-semibold text-muted fine:hover:text-text">
                  Clear
                </button>
                <span className="ml-auto tabular-nums text-muted">{selected.size} selected</span>
              </div>
            )}
          </div>

          <div className="mt-6">
            {visible.length === 0 ? (
              <EmptyState
                icon={<PackageOpen size={22} />}
                title="Nothing matches those filters"
                body="Try another status or store, or clear the search."
                action={{ onClick: clearFilters, label: "Clear filters" }}
              />
            ) : view === "shelf" ? (
              <>
                <PhysicsShelf entries={visible.slice(0, SHELF_LIMIT)} />
                {visible.length > SHELF_LIMIT && (
                  <p className="mt-1 px-1 text-[13px] text-faint">
                    The shelf holds {SHELF_LIMIT} at a time — showing the first {SHELF_LIMIT} of {visible.length}. Filter or sort to change which.
                  </p>
                )}
              </>
            ) : view === "list" ? (
              <ul className="overflow-hidden rounded-2xl border border-line bg-panel/55 light:bg-panel">
                {visible.map((entry, index) => (
                  <li key={entry.gameId} className={cn("relative", index > 0 && "border-t border-line")}>
                    {batchMode && <SelectionToggle selected={selected.has(entry.gameId)} name={entry.name} onToggle={() => setSelected(toggleSelected(selected, entry.gameId))} />}
                    <LibraryRow entry={entry} hours={hoursOf(ttb.data?.[entry.gameId])} />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
                {visible.map((entry, index) => (
                  <li key={entry.gameId} className="relative">
                    {batchMode && <SelectionToggle selected={selected.has(entry.gameId)} name={entry.name} onToggle={() => setSelected(toggleSelected(selected, entry.gameId))} />}
                    {/* Mount-based: filtering re-mounts these while the reader is already scrolled in. */}
                    <Reveal delay={Math.min(index, 10) * 0.025} blur={false} onMount>
                      <PosterTile entry={entry} badge={STATUS_LABELS[entry.status]} />
                    </Reveal>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </Container>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

function LibraryHero({
  owned,
  analytics,
  hoursStatus,
  storeCount,
  forecast,
}: {
  owned: WatchlistEntry[];
  analytics: ReturnType<typeof buildPersonalAnalytics>;
  hoursStatus: "loading" | "ready" | "unavailable";
  storeCount: number;
  forecast: BacklogForecast | null;
}) {
  const { finish, funnel, hours } = analytics;
  const upcoming = owned.filter((entry) => releaseState(entry) === "upcoming").length;
  const hoursReady = hoursStatus === "ready" && hours.available && hours.backlog > 0;
  const recent = [...owned].sort((a, b) => b.addedAt - a.addedAt).slice(0, 5);
  const unfinished = Math.max(0, finish.base - finish.finished);

  return (
    <section aria-labelledby="library-hero" className="glass relative isolate overflow-hidden rounded-3xl p-5 sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 -z-10 h-72 w-72 rounded-full bg-brand/20 blur-3xl" />
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h2 id="library-hero" className="text-[13px] font-semibold text-muted">Your collection</h2>
          <p className="mt-1 flex items-baseline gap-2.5">
            <CountUp value={owned.length} className="font-display text-[56px] font-bold leading-none tracking-[-0.04em] tabular-nums sm:text-[72px]" />
            <span className="text-[17px] text-muted">{owned.length === 1 ? "game" : "games"}</span>
          </p>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted sm:text-[17px]">
            {headline(finish.finished, funnel.playing, unfinished, hoursReady ? hours.backlog : null)}
          </p>
        </div>
        <CoverFan entries={recent} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-2 sm:mt-8 sm:grid-cols-4">
        <HeroTile label="Copies" value={analytics.ownedCopies} note={`across ${plural(storeCount, "store")}`} />
        <HeroTile
          label="Finished"
          value={finish.finished}
          note={finish.rate !== null ? `${Math.round(finish.rate * 100)}% of released games` : "none released yet"}
        />
        {hoursStatus === "loading" ? (
          <div className="rounded-2xl bg-fg/[0.04] p-3.5" aria-label="Loading backlog hours">
            <Skeleton className="h-3 w-16 rounded" />
            <Skeleton className="mt-2.5 h-7 w-14 rounded" />
          </div>
        ) : hoursReady ? (
          <HeroTile label="Backlog" value={hours.backlog} suffix="h" note={`to finish ${plural(hours.backlogGames, "game")}`} />
        ) : (
          <HeroTile label="Unfinished" value={unfinished} note="owned and released" />
        )}
        {upcoming > 0 ? (
          <HeroTile label="Not out yet" value={upcoming} note="pre-ordered or owned early" />
        ) : (
          <HeroTile label="Playing" value={funnel.playing} note={funnel.playing ? "on the go right now" : "nothing in progress"} />
        )}
      </dl>
      {/* Progress you can watch fill: finish rate, hours played, and when the backlog clears at this pace. */}
      {(finish.rate !== null || forecast) && (
        <div className="mt-4 grid items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex items-center justify-center gap-4 sm:justify-start">
            {finish.rate !== null && <LiquidRing value={finish.rate} label="finished" className="h-24 w-24 sm:h-28 sm:w-28" />}
            {hoursReady && hours.finished + hours.inProgress > 0 && (
              <LiquidRing
                value={(hours.finished + hours.inProgress) / (hours.finished + hours.inProgress + hours.backlog)}
                label="hours played"
                tone="var(--color-brand)"
                className="h-24 w-24 sm:h-28 sm:w-28"
              />
            )}
          </div>
          {forecast && <ForecastNote forecast={forecast} />}
        </div>
      )}
      {hoursReady && hours.withData < hours.eligible && (
        <p className="mt-3 text-[12px] text-faint">
          Backlog hours: IGDB estimates for {hours.withData} of {plural(hours.eligible, "game")}.
        </p>
      )}
    </section>
  );
}

function headline(finished: number, playing: number, unfinished: number, backlogHours: number | null): string {
  const parts: string[] = [];
  parts.push(finished ? `${plural(finished, "game")} finished` : "Nothing marked finished yet");
  if (playing) parts.push(`${playing} on the go`);
  const lead = parts.join(", ");
  if (backlogHours) return `${lead}. About ${Math.round(backlogHours).toLocaleString("en")} hours of backlog left to play.`;
  if (unfinished) return `${lead}. ${plural(unfinished, "game")} still waiting to be played.`;
  return `${lead}. Your backlog is clear.`;
}

function HeroTile({ label, value, note, suffix = "" }: { label: string; value: number; note: string; suffix?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-fg/[0.045] p-3.5">
      <dt className="truncate text-[12px] font-medium text-muted">{label}</dt>
      <dd className="mt-1">
        <CountUp value={Math.round(value)} suffix={suffix} className="font-display text-[26px] font-bold leading-none tabular-nums" />
        <span className="mt-1 block truncate text-[11px] text-faint">{note}</span>
      </dd>
    </div>
  );
}

/** The five most recently added covers, fanned like a hand of cards. */
function CoverFan({ entries }: { entries: WatchlistEntry[] }) {
  if (entries.length === 0) return null;
  const middle = (entries.length - 1) / 2;
  return (
    <div aria-hidden className="relative hidden h-44 sm:block" style={{ width: 96 + (entries.length - 1) * 46 }}>
      {entries.map((entry, index) => (
        <span
          key={entry.gameId}
          className="absolute bottom-0 h-[128px] w-24 overflow-hidden rounded-xl shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85)] ring-1 ring-inset ring-fg/15 light:shadow-[0_14px_30px_-16px_rgba(0,0,0,0.35)]"
          style={{
            left: index * 46,
            transform: `rotate(${(index - middle) * 5}deg) translateY(${Math.abs(index - middle) * 8}px)`,
            zIndex: entries.length - Math.abs(Math.round(index - middle)),
          }}
        >
          <GameCover name={entry.name} slug={entry.slug} image={entry.image} imageFallback={entry.imageFallback} width={200} sizes="96px" />
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Smart groups                                                               */
/* -------------------------------------------------------------------------- */

interface PlatformBacklog {
  slug: string;
  name: string;
  icon: string | null;
  entries: WatchlistEntry[];
}

function smartGroups(owned: WatchlistEntry[]) {
  const released = (entry: WatchlistEntry) => releaseState(entry) !== "upcoming";
  const playing = owned.filter((entry) => entry.status === "playing").sort((a, b) => (b.startedAt ?? b.addedAt) - (a.startedAt ?? a.addedAt));
  const upNext = owned.filter((entry) => entry.status === "want" && released(entry)).sort((a, b) => b.addedAt - a.addedAt);
  const finished = owned.filter((entry) => entry.status === "played").sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  const untouched = owned.filter((entry) => entry.status === "none" && released(entry));
  const byPlatform = new Map<string, WatchlistEntry[]>();
  for (const entry of untouched) {
    for (const slug of new Set(entry.ownedOn ?? [])) byPlatform.set(slug, [...(byPlatform.get(slug) ?? []), entry]);
  }
  const backlog: PlatformBacklog[] = [...byPlatform.entries()]
    .map(([slug, list]) => ({ slug, name: ownershipPlatform(slug)?.name ?? slug, icon: ownershipPlatform(slug)?.icon ?? null, entries: list }))
    .sort((a, b) => b.entries.length - a.entries.length);
  return { playing, upNext, finished: finished.slice(0, 20), backlog };
}

function BacklogByPlatform({ platforms, hours }: { platforms: PlatformBacklog[]; hours: Record<number, TimeToBeatLike> | null }) {
  const [active, setActive] = useState(platforms[0].slug);
  const current = platforms.find((platform) => platform.slug === active) ?? platforms[0];
  const total = new Set(platforms.flatMap((platform) => platform.entries.map((entry) => entry.gameId))).size;

  return (
    <SmartRail
      title="Backlog"
      count={total}
      header={
        platforms.length > 1 ? (
          <RailTabs
            label="Backlog platform"
            value={current.slug}
            onChange={(slug) => {
              haptic("selection");
              setActive(slug);
            }}
            options={platforms.map((platform) => ({
              value: platform.slug,
              label: platform.name,
              count: platform.entries.length,
              icon: platform.icon ? <BrandIcon name={platform.icon} size={13} title={null} /> : undefined,
            }))}
          />
        ) : undefined
      }
    >
      {current.entries.map((entry) => (
        <PosterTile key={`${current.slug}-${entry.gameId}`} entry={entry} badge={hoursBadge(hours?.[entry.gameId])} />
      ))}
    </SmartRail>
  );
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

function finishedLabel(entry: WatchlistEntry): string | undefined {
  return entry.finishedAt ? `Finished ${MONTH_YEAR.format(new Date(entry.finishedAt))}` : undefined;
}

function hoursBadge(ttb: TimeToBeatLike | undefined): string | undefined {
  const hours = hoursOf(ttb);
  return hours ? `About ${Math.round(hours)} h` : undefined;
}

function playedOn(entry: WatchlistEntry): string | undefined {
  const platform = entry.platform ? OWNERSHIP_PLATFORMS.find((item) => item.slug === entry.platform) : null;
  return platform ? `On ${platform.name}` : undefined;
}

/* -------------------------------------------------------------------------- */
/* Collection pieces                                                          */
/* -------------------------------------------------------------------------- */

const VIEWS: { value: ViewMode; label: string; icon: typeof Rows3 }[] = [
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "list", label: "List", icon: Rows3 },
  { value: "shelf", label: "Shelf", icon: Boxes },
];

function ViewSwitch({ value, onChange }: { value: ViewMode; onChange: (value: ViewMode) => void }) {
  return (
    <div role="group" aria-label="Library view" className="flex items-center gap-0.5 rounded-full border border-fg/[0.08] bg-fg/[0.06] p-0.5">
      {VIEWS.map((option) => {
        const Icon = option.icon;
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            aria-label={`${option.label} view`}
            title={`${option.label} view`}
            onClick={() => {
              haptic("selection");
              onChange(option.value);
            }}
            className={cn(
              "press grid h-8 w-8 place-items-center rounded-full transition-colors coarse:h-10 coarse:w-10",
              on ? "bg-fg/[0.16] text-text shadow-[0_3px_10px_-2px_#00000080] light:bg-panel light:shadow-[0_2px_8px_-2px_#00000029]" : "text-faint fine:hover:text-text",
            )}
          >
            <Icon size={15} aria-hidden />
          </button>
        );
      })}
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
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`${selected ? "Deselect" : "Select"} ${name}`}
      aria-pressed={selected}
      className={cn("absolute inset-0 z-30 rounded-2xl p-2 text-left transition-shadow", selected && "ring-2 ring-inset ring-brand")}
    >
      <span className={cn("grid h-8 w-8 place-items-center rounded-full border shadow-xl backdrop-blur-xl transition-colors", selected ? "border-brand/60 bg-brand text-white" : "border-white/30 bg-black/55 text-white")}>
        <Check size={15} className={cn(!selected && "opacity-0")} />
      </span>
    </button>
  );
}

function LibraryRow({ entry, hours }: { entry: WatchlistEntry; hours: number | null }) {
  const owned = entry.ownedOn ?? [];
  const game = useMemo(() => entryAsGameSummary(entry), [entry]);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 transition-colors fine:hover:bg-fg/[0.035] sm:gap-4">
      <Link prefetch={false} href={`/game/${entry.slug}`} tabIndex={-1} aria-hidden className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-inset ring-fg/10">
        <GameCover name={entry.name} slug={entry.slug} image={entry.image} imageFallback={entry.imageFallback} width={160} sizes="48px" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link prefetch={false} href={`/game/${entry.slug}`} className="block truncate text-[15px] font-semibold fine:hover:text-brand-soft">{entry.name}</Link>
        <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] text-muted">
          <span className="shrink-0">{STATUS_LABELS[entry.status]}</span>
          {entry.released && <span className="shrink-0 tabular-nums text-faint">{entry.released.slice(0, 4)}</span>}
          {hours && <span className="shrink-0 tabular-nums text-faint">≈ {Math.round(hours)} h</span>}
        </p>
        <span className="mt-1 flex items-center gap-1.5">
          {owned.slice(0, 5).map((slug) => {
            const platform = OWNERSHIP_PLATFORMS.find((p) => p.slug === slug);
            return platform?.icon ? (
              <BrandIcon key={slug} name={platform.icon} size={12} title={platform.name} />
            ) : (
              <span key={slug} className="text-[11px] text-faint">{platform?.name ?? slug}</span>
            );
          })}
        </span>
      </div>
      <ScorePill score={entry.metacritic} className="hidden sm:inline-flex" />
      <OwnershipPicker game={game} variant="icon" />
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <Container className="pb-12">
      <Skeleton className="h-[300px] rounded-3xl" />
      <Skeleton className="mt-12 h-7 w-40 rounded-lg" />
      <div className="mt-4 flex gap-3 overflow-hidden">
        {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="aspect-[3/4] w-[156px] shrink-0 rounded-xl" />)}
      </div>
    </Container>
  );
}
