"use client";

/**
 * Filter and sort controls.
 *
 * State lives entirely in the URL — filters are shareable, survive a refresh
 * and give the back button real meaning. Nothing is mirrored into component
 * state, which removes the usual class of desync bugs between the two.
 *
 * Presentation splits by pointer type: desktop shows every control inline,
 * touch collapses them behind a single Filters button that opens a bottom
 * sheet, because a wrapped row of forty chips is unusable on a phone.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { ArrowUpDown, CalendarDays, Check, Gauge, Loader2, SlidersHorizontal, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Chip } from "@/components/ui/Badge";
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
  { value: "90,100", label: "90+ essential" },
  { value: "80,100", label: "80+ acclaimed" },
  { value: "70,100", label: "70+ recommended" },
];

const YEAR = new Date().getUTCFullYear();
const DATE_PRESETS = [
  { value: `${YEAR}-01-01,${YEAR}-12-31`, label: `${YEAR} releases` },
  { value: "2020-01-01,2025-12-31", label: "2020–2025" },
  { value: "2010-01-01,2019-12-31", label: "2010s" },
  { value: "2000-01-01,2009-12-31", label: "2000s" },
  { value: "1970-01-01,1999-12-31", label: "Classics" },
];

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
}

export function BrowseControls({
  genres,
  platforms,
  totalCount,
  sorts = BROWSE_SORTS,
  defaultSort = "-added",
  noun = "game",
  showDatePresets = true,
}: BrowseControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeGenres = useMemo(
    () => new Set((params.get("genres") ?? "").split(",").filter(Boolean)),
    [params],
  );
  const activePlatforms = useMemo(
    () => new Set((params.get("platforms") ?? "").split(",").filter(Boolean)),
    [params],
  );
  const activeSort = (params.get("ordering") as SortKey | null) ?? defaultSort;
  const search = params.get("search") ?? "";
  const score = params.get("metacritic") ?? "";
  const dates = showDatePresets ? params.get("dates") ?? "" : "";

  const filterCount = activeGenres.size + activePlatforms.size + (search ? 1 : 0) + (score ? 1 : 0) + (dates ? 1 : 0);

  const push = useCallback(
    (next: URLSearchParams) => {
      // Any filter change invalidates the current page offset.
      next.delete("page");
      const qs = next.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [router, pathname],
  );

  const toggleMulti = useCallback(
    (key: "genres" | "platforms", slug: string) => {
      const next = new URLSearchParams(params.toString());
      const current = new Set((next.get(key) ?? "").split(",").filter(Boolean));
      if (current.has(slug)) current.delete(slug);
      else current.add(slug);

      if (current.size > 0) next.set(key, [...current].join(","));
      else next.delete(key);
      push(next);
    },
    [params, push],
  );

  const setSort = useCallback(
    (value: SortKey) => {
      const next = new URLSearchParams(params.toString());
      // The default lives implicitly in the absence of the param, so URLs stay
      // clean and "reset" has exactly one meaning.
      if (value === defaultSort) next.delete("ordering");
      else next.set("ordering", value);
      push(next);
    },
    [params, push, defaultSort],
  );

  const setSingle = useCallback(
    (key: "metacritic" | "dates", value: string) => {
      const next = new URLSearchParams(params.toString());
      if (next.get(key) === value) next.delete(key);
      else next.set(key, value);
      push(next);
    },
    [params, push],
  );

  const clearAll = useCallback(() => {
    const next = new URLSearchParams();
    // A search term is the user's own words — never silently discard it.
    if (search) next.set("search", search);
    push(next);
  }, [search, push]);

  const filterPanel = (
    <div className="space-y-7">
      <FilterGroup
        title="Genres"
        items={genres}
        active={activeGenres}
        onToggle={(slug) => toggleMulti("genres", slug)}
      />
      <div className="grid gap-6 border-t border-line pt-6 lg:grid-cols-2">
        <PresetGroup title="Critic threshold" icon={<Gauge size={14} />} items={SCORE_PRESETS} active={score} onChoose={(value) => setSingle("metacritic", value)} />
        {showDatePresets && <PresetGroup title="Release era" icon={<CalendarDays size={14} />} items={DATE_PRESETS} active={dates} onChoose={(value) => setSingle("dates", value)} />}
      </div>
      <FilterGroup
        title="Platforms"
        items={platforms}
        active={activePlatforms}
        onToggle={(slug) => toggleMulti("platforms", slug)}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Summary row — identical on both targets. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className="font-semibold text-text tabular-nums">
            {totalCount.toLocaleString("en-US")}
          </span>
          {totalCount === 1 ? noun : `${noun}s`}
          {pending && <Loader2 size={13} className="animate-spin text-faint" />}
        </p>

        <div className="flex w-full min-w-0 items-center gap-2 min-[380px]:w-auto">
          {/* Touch: one button, sheet behind it. */}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={cn(
              "press inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors fine:hidden min-[380px]:flex-none min-[380px]:px-4",
              filterCount > 0
                ? "border-brand/50 bg-brand/15 text-white"
                : "border-white/[0.09] bg-white/[0.06] text-text",
            )}
          >
            <SlidersHorizontal size={15} />
            Filters
            {filterCount > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-white tabular-nums">
                {filterCount}
              </span>
            )}
          </button>

          <SortSelect value={activeSort} onChange={setSort} options={sorts} />
        </div>
      </div>

      {/* Active filter pills, both targets. */}
      {filterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {search && (
            <ActivePill label={`“${search}”`} onRemove={() => {
              const next = new URLSearchParams(params.toString());
              next.delete("search");
              push(next);
            }} />
          )}
          {[...activeGenres].map((slug) => (
            <ActivePill
              key={`g-${slug}`}
              label={genres.find((g) => g.slug === slug)?.name ?? slug}
              onRemove={() => toggleMulti("genres", slug)}
            />
          ))}
          {[...activePlatforms].map((slug) => (
            <ActivePill
              key={`p-${slug}`}
              label={platforms.find((p) => p.slug === slug)?.name ?? slug}
              onRemove={() => toggleMulti("platforms", slug)}
            />
          ))}
          {score && <ActivePill label={SCORE_PRESETS.find((item) => item.value === score)?.label ?? `Score ${score}`} onRemove={() => setSingle("metacritic", score)} />}
          {dates && <ActivePill label={DATE_PRESETS.find((item) => item.value === dates)?.label ?? "Release window"} onRemove={() => setSingle("dates", dates)} />}
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-medium text-faint underline underline-offset-2 transition-colors hover:text-text"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Desktop: filters inline, always visible. */}
      <div className="glass hidden rounded-3xl p-6 fine:block">
        {filterPanel}
      </div>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filters"
        description={`${totalCount.toLocaleString("en-US")} games match`}
      >
        {filterPanel}
        <div className="mt-7 flex gap-3">
          <button
            type="button"
            onClick={clearAll}
            className="press min-h-12 flex-1 rounded-full bg-white/[0.08] text-[15px] font-medium text-text"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            className="press min-h-12 flex-[2] rounded-full bg-brand text-[15px] font-semibold text-white shadow-[inset_0_1px_0_#ffffff40]"
          >
            Show results
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function FilterGroup({
  title,
  items,
  active,
  onToggle,
}: {
  title: string;
  items: Ref[];
  active: Set<string>;
  onToggle: (slug: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Chip
            key={item.id}
            active={active.has(item.slug)}
            onClick={() => onToggle(item.slug)}
          >
            {item.name}
            {active.has(item.slug) && <Check size={12} />}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function PresetGroup({
  title,
  icon,
  items,
  active,
  onChoose,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{ value: string; label: string }>;
  active: string;
  onChoose: (value: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{icon}{title}</h3>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onChoose(item.value)}
            aria-pressed={active === item.value}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
              active === item.value
                ? "border-brand/50 bg-brand/25 text-white"
                : "border-white/[0.09] bg-white/[0.06] text-muted hover:bg-white/[0.1] hover:text-text",
            )}
          >
            {item.label}{active === item.value && <Check size={11} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActivePill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/15 py-1.5 pl-3 pr-1.5 text-xs text-white">
      <span className="max-w-[160px] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="grid h-5 w-5 place-items-center rounded-full transition-colors hover:bg-white/20"
      >
        <X size={11} />
      </button>
    </span>
  );
}

function SortSelect({
  value,
  onChange,
  options,
}: {
  value: SortKey;
  onChange: (value: SortKey) => void;
  options: SortOption[];
}) {
  return (
    <div className="relative min-w-0 flex-1 min-[380px]:flex-none">
      <ArrowUpDown
        size={14}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
      />
      {/* A native select is the right control here: it gets the platform's own
          picker on iOS and Android, which beats any custom dropdown on touch. */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        aria-label="Sort games"
        className="min-h-11 w-full min-w-0 appearance-none rounded-full border border-white/[0.09] bg-white/[0.06] py-2 pl-9 pr-8 text-sm text-text outline-none transition-colors hover:bg-white/[0.1] focus-visible:border-brand min-[380px]:w-auto min-[380px]:pr-9"
      >
        {options.map((sort) => (
          <option key={sort.value} value={sort.value} className="bg-panel text-text">
            {sort.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint min-[380px]:right-4"
      >
        ▾
      </span>
    </div>
  );
}
