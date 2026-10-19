"use client";

/**
 * The signed-in watchlist.
 *
 * Entries carry a play status (want / playing / played) that the user can
 * change inline. Sorting puts imminent releases first, because "what's out
 * next" is the question this page exists to answer — undated and already-played
 * titles sink to the bottom.
 */

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpDown, BellRing, BookmarkX, CalendarClock, Check, CircleHelp, Library, PencilLine, Search, X } from "lucide-react";
import { GameCover } from "./GameCover";
import { CountdownInline } from "./Countdown";
import { PlatformPicker } from "./PlatformPicker";
import { PosterTile } from "./PosterTile";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { useToast } from "@/components/ui/Toast";
import { ScorePill } from "@/components/ui/ScoreRing";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { GameCardSkeleton } from "@/components/ui/Skeleton";
import { Reveal } from "@/components/motion/Reveal";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  PosterSizeToggle,
  posterGridClass,
  usePosterSize,
} from "@/components/ui/PosterSizeToggle";
import { cn } from "@/lib/utils/cn";
import { releaseLabel } from "@/lib/utils/format";
import { fuzzyMatches } from "@/lib/games/fuzzy-search";
import { releaseState, type ReleaseState } from "@/lib/games/release-state";
import type { WatchStatus } from "@/lib/firebase/db";
import { BatchEditPanel } from "@/components/library/BatchEditPanel";

const FILTERS: { value: WatchStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "none", label: "No status" },
  { value: "want", label: "Want to play" },
  { value: "playing", label: "Playing" },
  { value: "played", label: "Played" },
];

const STATUS_LABEL: Record<WatchStatus, string> = {
  none: "No status",
  want: "Want to play",
  playing: "Playing",
  played: "Played",
};

type WatchSort = "upcoming" | "added" | "name" | "score";
type ReleaseFilter = ReleaseState | "all";

const SORTS: { value: WatchSort; label: string }[] = [
  { value: "upcoming", label: "Releasing soonest" },
  { value: "added", label: "Recently added" },
  { value: "name", label: "A–Z" },
  { value: "score", label: "Highest rated" },
];

export function WatchlistView() {
  const { entries, loading, setStatus, remove } = useWatchlist();
  const { toast } = useToast();
  const [filter, setFilter] = useState<WatchStatus | "all">("all");
  const [sort, setSort] = useState<WatchSort>("upcoming");
  const [query, setQuery] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("all");
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { size: posterSize, setSize: setPosterSize } = usePosterSize(
    "arnav-games:watchlist-size",
    "list",
  );

  const saved = useMemo(() => entries.filter((entry) => entry.watchlisted), [entries]);

  const counts = useMemo(() => {
    const base: Record<string, number> = { all: saved.length, none: 0, want: 0, playing: 0, played: 0 };
    for (const entry of saved) base[entry.status] = (base[entry.status] ?? 0) + 1;
    return base;
  }, [saved]);

  const releaseCounts = useMemo(() => {
    const result: Record<ReleaseState, number> = { released: 0, upcoming: 0, unknown: 0 };
    for (const entry of saved) result[releaseState(entry)]++;
    return result;
  }, [saved]);

  const visible = useMemo(() => {
    const term = query.trim();
    const list = saved.filter((entry) => {
      if (filter !== "all" && entry.status !== filter) return false;
      if (releaseFilter !== "all" && releaseState(entry) !== releaseFilter) return false;
      if (ownedOnly && (entry.ownedOn ?? []).length === 0) return false;
      if (term && !fuzzyMatches(entry.name, term)) return false;
      return true;
    });

    const sorted = [...list];

    switch (sort) {
      case "added":
        return sorted.sort((a, b) => b.addedAt - a.addedAt);
      case "name":
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case "score":
        return sorted.sort((a, b) => (b.metacritic ?? -1) - (a.metacritic ?? -1));
      default:
        return sorted.sort((a, b) => {
          // Upcoming, soonest first; then released, newest first; undated last.
          const rank = (entry: typeof a) => {
            const state = releaseState(entry);
            return state === "upcoming" ? 0 : state === "released" ? 1 : 2;
          };
          const [ra, rb] = [rank(a), rank(b)];
          if (ra !== rb) return ra - rb;
          if (ra === 0) return (a.released ?? "").localeCompare(b.released ?? "");
          if (ra === 1) return (b.released ?? "").localeCompare(a.released ?? "");
          return b.addedAt - a.addedAt;
        });
    }
  }, [saved, filter, releaseFilter, sort, query, ownedOnly]);

  if (loading) {
    return (
      <Container className="py-10">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <GameCardSkeleton key={i} />
          ))}
        </div>
      </Container>
    );
  }

  if (saved.length === 0) {
    return (
      <Container className="flex flex-col items-center justify-center py-24 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl border border-line bg-white/[0.04]">
          <BookmarkX size={24} className="text-faint" />
        </span>
        <h2 className="mt-6 font-display text-2xl font-bold">Nothing saved yet</h2>
        <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted">
          Tap the bookmark on any game to start tracking it. Releases you save show up
          here with a live countdown.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button href="/upcoming">See upcoming releases</Button>
          <Button href="/browse" variant="secondary">
            Browse the database
          </Button>
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-8 lg:py-12">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-muted">Saving, alerts, ownership, access, and status remain independent.</p>
        <button type="button" onClick={() => { setBatchMode((value) => !value); setSelected(new Set()); }} aria-pressed={batchMode} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors", batchMode ? "border-brand/45 bg-brand/15 text-white" : "border-line bg-white/[0.035] text-muted hover:text-text")}><PencilLine size={15} />{batchMode ? "Exit batch edit" : "Batch edit"}</button>
      </div>
      {batchMode && <BatchEditPanel gameIds={[...selected]} onDone={() => setSelected(new Set())} onClose={() => { setBatchMode(false); setSelected(new Set()); }} />}
      <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <WatchMetric icon={<Library size={16} />} label="Saved games" value={saved.length} />
        <WatchMetric icon={<CalendarClock size={16} />} label="Coming next" value={releaseCounts.upcoming} tone="brand" />
        <WatchMetric icon={<BellRing size={16} />} label="Alerts on" value={saved.filter((entry) => entry.following).length} tone="mint" />
        <WatchMetric icon={<CircleHelp size={16} />} label="Date unknown" value={releaseCounts.unknown} />
      </div>
      <div className="mb-6 space-y-4 rounded-2xl border border-line bg-panel/40 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your watchlist…"
              aria-label="Search your watchlist"
              className="min-h-11 w-full rounded-full border border-line bg-white/[0.04] pl-10 pr-9 text-sm outline-none transition-colors focus-visible:border-brand"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:bg-white/10 hover:text-text"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="relative">
            <ArrowUpDown
              size={14}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as WatchSort)}
              aria-label="Sort watchlist"
              className="min-h-11 appearance-none rounded-full border border-line bg-white/[0.04] py-2 pl-9 pr-9 text-sm outline-none transition-colors hover:border-line-strong focus-visible:border-brand"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value} className="bg-panel text-text">
                  {option.label}
                </option>
              ))}
            </select>
            <span
              aria-hidden
              className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-faint"
            >
              ▾
            </span>
          </div>

          <PosterSizeToggle size={posterSize} onChange={setPosterSize} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors",
                filter === option.value
                  ? "border-brand/50 bg-brand/20 text-white"
                  : "border-line bg-white/[0.03] text-muted fine:hover:text-text",
              )}
            >
              {option.label}
              <span className="text-[11px] tabular-nums opacity-60">
                {counts[option.value] ?? 0}
              </span>
            </button>
          ))}

          <button
            type="button"
            onClick={() => setOwnedOnly((value) => !value)}
            aria-pressed={ownedOnly}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors",
              ownedOnly
                ? "border-mint/45 bg-mint/15 text-white"
                : "border-line bg-white/[0.03] text-muted fine:hover:text-text",
            )}
          >
            <Library size={13} />
            Owned only
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {([
            ["all", "Any release", saved.length],
            ["upcoming", "Upcoming", releaseCounts.upcoming],
            ["released", "Released", releaseCounts.released],
            ["unknown", "Date unknown", releaseCounts.unknown],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setReleaseFilter(value)}
              aria-pressed={releaseFilter === value}
              className={cn(
                "min-h-9 rounded-full border px-3.5 text-xs font-medium transition-colors",
                releaseFilter === value
                  ? "border-cyan-400/40 bg-cyan-400/10 text-white"
                  : "border-line bg-white/[0.025] text-muted hover:text-text",
              )}
            >
              {label} <span className="ml-1 tabular-nums opacity-60">{count}</span>
            </button>
          ))}
        </div>
        {batchMode && <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4 text-xs"><button type="button" onClick={() => setSelected(new Set(visible.map((entry) => entry.gameId)))} className="font-semibold text-brand-soft hover:text-white">Select all {visible.length} visible</button><button type="button" onClick={() => setSelected(new Set())} className="font-semibold text-faint hover:text-text">Clear selection</button><span className="ml-auto tabular-nums text-muted">{selected.size} selected</span></div>}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<BookmarkX size={22} />}
          title="Nothing matches those filters"
          body="Try a different status, clear the search, or turn off the owned-only filter."
          action={{ href: "/browse", label: "Find more games" }}
        />
      ) : posterSize !== "list" ? (
        /* Poster grid. The inline status and platform controls only fit the
           list layout, so the grid links straight through to the game page —
           which is what someone scanning covers is heading for anyway. */
        <ul className={cn("grid gap-3", posterGridClass(posterSize))}>
          {visible.map((entry, index) => (
            <li key={entry.gameId} className="relative">
              {batchMode && <SelectionToggle selected={selected.has(entry.gameId)} name={entry.name} onToggle={() => setSelected(toggleSelected(selected, entry.gameId))} />}
              <Reveal delay={Math.min(index, 10) * 0.025} blur={false} onMount>
                <PosterTile
                  entry={entry}
                  size={posterSize === "large" ? "large" : "compact"}
                  badge={STATUS_LABEL[entry.status]}
                />
              </Reveal>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2.5">
          <AnimatePresence initial={false}>
            {visible.map((entry) => (
              <motion.li
                key={entry.gameId}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="group relative flex items-center gap-3 rounded-2xl border border-line bg-panel/50 p-2.5 transition-colors fine:hover:border-line-strong sm:gap-4 sm:p-3"
              >
                {batchMode && <SelectionToggle selected={selected.has(entry.gameId)} name={entry.name} onToggle={() => setSelected(toggleSelected(selected, entry.gameId))} />}
                <Link
                  href={`/game/${entry.slug}`}
                  className="relative h-[70px] w-[52px] shrink-0 overflow-hidden rounded-xl sm:h-20 sm:w-16"
                  aria-hidden
                  tabIndex={-1}
                >
                  <GameCover
                    name={entry.name}
                    slug={entry.slug}
                    image={entry.image}
                    imageFallback={entry.imageFallback}
                    width={160}
                    sizes="64px"
                  />
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <Link href={`/game/${entry.slug}`} className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold leading-snug sm:text-[15px]">
                        {entry.name}
                      </h3>
                    </Link>
                    <ScorePill score={entry.metacritic} className="mt-0.5 shrink-0" />
                  </div>

                  <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted sm:text-xs">
                    <span>{releaseLabel(entry)}</span>
                    {entry.released && releaseState(entry) === "upcoming" && (
                      <span className="text-brand-soft">
                        <CountdownInline date={entry.released} />
                      </span>
                    )}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`status-${entry.gameId}`}>
                      Play status for {entry.name}
                    </label>
                    <select
                      id={`status-${entry.gameId}`}
                      value={entry.status}
                      onChange={async (e) => {
                        try {
                          await setStatus(entry.gameId, e.target.value as WatchStatus);
                        } catch {
                          toast("Couldn't update the status.", "error");
                        }
                      }}
                      className="min-h-9 rounded-full border border-line bg-white/[0.04] px-3 text-[12px] text-muted outline-none transition-colors focus-visible:border-brand"
                    >
                      {(Object.keys(STATUS_LABEL) as WatchStatus[]).filter((status) =>
                        releaseState(entry) !== "upcoming" || status === "none" || status === "want",
                      ).map((status) => (
                        <option key={status} value={status} className="bg-panel text-text">
                          {STATUS_LABEL[status]}
                        </option>
                      ))}
                    </select>

                    {/* Only meaningful once they're actually playing it. */}
                    {(entry.status === "playing" || entry.status === "played") && (
                      <PlatformPicker
                        gameId={entry.gameId}
                        gameName={entry.name}
                        value={entry.platform ?? null}
                      />
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await remove(entry.gameId);
                      toast(`${entry.name} removed from your watchlist. Ownership and play history were kept.`, "info");
                    } catch {
                      toast("Couldn't remove that game.", "error");
                    }
                  }}
                  aria-label={`Remove ${entry.name} from watchlist`}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-flare/10 hover:text-flare"
                >
                  <BookmarkX size={16} />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Container>
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

function WatchMetric({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "brand" | "mint";
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-panel/45 p-3.5 sm:p-4">
      <div className={cn(
        "mb-3 grid h-8 w-8 place-items-center rounded-xl bg-white/[0.05] text-muted",
        tone === "brand" && "bg-brand/15 text-brand-soft",
        tone === "mint" && "bg-mint/10 text-mint",
      )}>
        {icon}
      </div>
      <p className="font-display text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-0.5 truncate text-[11px] uppercase tracking-[0.12em] text-faint">{label}</p>
    </div>
  );
}
