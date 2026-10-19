"use client";

/**
 * A facet button together with the panel it opens.
 *
 * Multi facets stay open while toggling — picking three genres shouldn't
 * take three round trips through a closed menu. Single facets behave like a
 * menu and close on pick, because the choice is the whole interaction.
 */

import { useCallback, useRef, useState } from "react";
import { FacetButton } from "./FacetButton";
import { FilterSurface, SheetFooterButtons, SurfaceTextButton } from "./FilterSurface";
import { OptionList } from "./OptionList";
import { facetDescription, facetSummary, isSearchable, toggleFacetValue, type FacetDef } from "./types";
import { useFilterPresentation } from "./usePresentation";

export function FacetControl({ facet }: { facet: FacetDef }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const presentation = useFilterPresentation();
  const close = useCallback(() => setOpen(false), []);

  const onToggle = (value: string) => {
    facet.onChange(toggleFacetValue(facet, value));
    if (facet.mode === "single") close();
  };

  const searchable = isSearchable(facet);
  const hasSelection = facet.selected.length > 0;

  return (
    <>
      <FacetButton
        ref={anchorRef}
        label={facet.label}
        // Icons label the sections in the "All filters" sheet; on the rail
        // they'd only make every pill wider without making it clearer.
        summary={facetSummary(facet)}
        open={open}
        onClick={() => setOpen((value) => !value)}
      />
      <FilterSurface
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        presentation={presentation}
        title={facet.label}
        description={facetDescription(facet)}
        width={searchable ? 320 : 272}
        headerAction={
          hasSelection && facet.mode === "multi" ? (
            <SurfaceTextButton onClick={() => facet.onChange([])}>Clear</SurfaceTextButton>
          ) : undefined
        }
        footer={
          facet.mode === "multi" ? (
            <SheetFooterButtons
              secondary="Clear"
              onSecondary={() => facet.onChange([])}
              secondaryDisabled={!hasSelection}
              primary="Done"
              onPrimary={close}
            />
          ) : undefined
        }
      >
        <OptionList
          options={facet.options}
          selected={facet.selected}
          mode={facet.mode}
          onToggle={onToggle}
          label={facet.label}
          searchable={searchable}
          anyLabel={facet.anyLabel}
          autoFocus={presentation === "popover"}
          listClassName={
            presentation === "popover"
              ? "max-h-[min(340px,55vh)] overflow-y-auto overscroll-contain p-0.5"
              : undefined
          }
        />
      </FilterSurface>
    </>
  );
}
