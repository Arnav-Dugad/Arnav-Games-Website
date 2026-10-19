"use client";

/**
 * One compact toolbar for every filterable list on the site.
 *
 *   1,234 games ⟳                                   ⇅ Most popular ▾
 *   [⚙ Filters 2] [Genre · 2 ▾] [Platform ▾] [Score · 90+ ▾] [Era ▾]  →
 *   (RPG ×) (Shooter ×) (90+ essential ×)  Clear all
 *
 * Nothing is expanded by default. Each facet is a single pill that says what
 * it is and how it's set; the rail scrolls sideways on a phone instead of
 * wrapping into a wall of chips; and the row of removable pills only exists
 * while something is actually filtered.
 *
 * The toolbar is state-agnostic: catalogue pages drive it from the URL, the
 * library pages from local state. It only ever sees `FacetDef`s.
 */

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Loader2, SlidersHorizontal, X } from "lucide-react";
import { FacetButton } from "./FacetButton";
import { FacetControl } from "./FacetPanel";
import { AllFiltersSheet } from "./AllFiltersSheet";
import { cn } from "@/lib/utils/cn";
import type { FacetDef } from "./types";

export interface ActiveFilterPill {
  key: string;
  label: string;
  onRemove: () => void;
}

export function FilterToolbar({
  summary,
  pending = false,
  actions,
  facets,
  extraPills = [],
  onClearAll,
  resultLabel,
  sheetDescription,
  showAllFilters,
  railLabel = "Filters",
  railTrailing,
  className,
}: {
  /** Left side of the top row — usually the result count. */
  summary?: ReactNode;
  pending?: boolean;
  /** Right side of the top row — sort, view toggles. */
  actions?: ReactNode;
  facets: FacetDef[];
  /** Removable pills for state that isn't a facet, e.g. a search term. */
  extraPills?: ActiveFilterPill[];
  onClearAll: () => void;
  /** "All filters" sheet primary button, e.g. "Show 1,234 games". */
  resultLabel: string;
  sheetDescription?: string;
  /** Defaults to on when there are enough facets to make a sheet worthwhile. */
  showAllFilters?: boolean;
  railLabel?: string;
  /** Pinned to the end of the facet rail, e.g. a view-density toggle. */
  railTrailing?: ReactNode;
  className?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const reduced = useReducedMotion();
  const withSheet = showAllFilters ?? facets.length >= 3;

  const facetCount = facets.reduce((sum, facet) => sum + facet.selected.length, 0);

  const pills: ActiveFilterPill[] = [
    ...extraPills,
    ...facets.flatMap((facet) =>
      facet.selected.map((value) => {
        const option = facet.options.find((item) => item.value === value);
        return {
          key: `${facet.id}:${value}`,
          label: option?.label ?? value,
          onRemove: () => facet.onChange(facet.selected.filter((item) => item !== value)),
        };
      }),
    ),
  ];

  return (
    <div className={cn("space-y-3", className)}>
      {(summary || actions) && (
        <div className="flex items-center justify-between gap-3">
          <div aria-live="polite" className="flex min-w-0 items-center gap-2 text-sm text-muted">
            {summary}
            <Loader2
              aria-hidden
              size={13}
              className={cn("shrink-0 animate-spin text-faint transition-opacity", pending ? "opacity-100" : "opacity-0")}
            />
          </div>
          {actions && <div className="flex min-w-0 shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}

      {/* Bleeds to the screen edge on phones so the rail visibly continues. */}
      <div
        role="group"
        aria-label={railLabel}
        className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 py-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {withSheet && (
          <>
            <FacetButton
              label="Filters"
              icon={<SlidersHorizontal size={14} />}
              open={sheetOpen}
              active={facetCount > 0}
              onClick={() => setSheetOpen(true)}
              trailing={
                facetCount > 0 ? (
                  <span className="-mr-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold tabular-nums text-white">
                    {facetCount}
                  </span>
                ) : (
                  // Opens a sheet, not a menu, so no chevron.
                  false
                )
              }
            />
            <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-fg/10" />
          </>
        )}
        {facets.map((facet) => (
          <FacetControl key={facet.id} facet={facet} />
        ))}
        {railTrailing && <div className="ml-auto shrink-0 pl-2">{railTrailing}</div>}
      </div>

      <AnimatePresence initial={false}>
        {pills.length > 0 && (
          <motion.div
            key="pills"
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {pills.map((pill) => (
                <ActivePill key={pill.key} label={pill.label} onRemove={pill.onRemove} />
              ))}
              {/* Extra pills (a search term) are removed individually — "Clear
                  all" deliberately leaves them, so it's only offered when it
                  has facets to clear. */}
              {facetCount > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="min-h-8 rounded-full px-2.5 text-[13px] font-medium text-brand-soft transition-colors hover:bg-brand/10 hover:text-text coarse:min-h-11"
              >
                Clear all
              </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {withSheet && (
        <AllFiltersSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          facets={facets}
          onClearAll={onClearAll}
          activeCount={facetCount}
          resultLabel={resultLabel}
          description={sheetDescription}
          pending={pending}
        />
      )}
    </div>
  );
}

function ActivePill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-full border border-brand/35 bg-brand/[0.14] pl-3 pr-1 text-[12px] font-medium text-text coarse:h-9">
      <span className="max-w-[11rem] truncate">{label}</span>
      {/* The pill stays compact; the hit area doesn't. */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="relative grid h-6 w-6 place-items-center rounded-full text-muted transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:bg-fg/15 hover:text-text"
      >
        <X size={12} />
      </button>
    </span>
  );
}
