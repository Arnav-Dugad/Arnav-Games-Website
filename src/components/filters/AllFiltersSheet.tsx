"use client";

/**
 * Every facet in one place, each folded into a section that shows its
 * current selection in the header.
 *
 * Sections start collapsed: the sheet is a table of contents first — "what's
 * filtered, and how" — and an editor second. Opening a section is one tap,
 * whereas scrolling past forty platform rows to reach the score presets was
 * the problem the old always-expanded panel had.
 *
 * Changes apply live, so the primary button is an honest "show what's
 * already filtered" rather than a commit step that could silently discard
 * work if the sheet is swiped away.
 */

import { Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Collapsible } from "@/components/ui/Collapsible";
import { OptionList } from "./OptionList";
import { SHEET_TOOLBAR, SheetFooterButtons } from "./FilterSurface";
import { facetDescription, isSearchable, toggleFacetValue, type FacetDef } from "./types";

export function AllFiltersSheet({
  open,
  onClose,
  facets,
  onClearAll,
  activeCount,
  resultLabel,
  description,
  pending = false,
}: {
  open: boolean;
  onClose: () => void;
  facets: FacetDef[];
  onClearAll: () => void;
  activeCount: number;
  /** e.g. "Show 1,234 games". */
  resultLabel: string;
  description?: string;
  pending?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Filters" description={description}>
      <div className="space-y-2.5">
        {facets.map((facet) => (
          <Collapsible
            key={facet.id}
            title={facet.label}
            subtitle={facetDescription(facet)}
            icon={facet.icon}
            className={facet.selected.length > 0 ? "border-brand/30" : undefined}
          >
            <OptionList
              options={facet.options}
              selected={facet.selected}
              mode={facet.mode}
              label={facet.label}
              searchable={isSearchable(facet)}
              anyLabel={facet.anyLabel}
              onToggle={(value) => facet.onChange(toggleFacetValue(facet, value))}
            />
          </Collapsible>
        ))}
      </div>

      <div className={SHEET_TOOLBAR}>
        <SheetFooterButtons
          secondary="Clear all"
          onSecondary={onClearAll}
          secondaryDisabled={activeCount === 0}
          primary={
            <>
              {pending && <Loader2 aria-hidden size={15} className="animate-spin" />}
              {resultLabel}
            </>
          }
          onPrimary={onClose}
        />
      </div>
    </Sheet>
  );
}
