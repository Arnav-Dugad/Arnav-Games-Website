import type { ReactNode } from "react";

/** One choosable value inside a facet. */
export interface FacetOption {
  value: string;
  label: string;
  /** Compact form for the facet button, e.g. "90+" for "90+ essential". */
  short?: string;
  /** Only shown when the data genuinely provides it — never estimated. */
  count?: number;
  icon?: ReactNode;
}

/**
 * A single filter dimension, described as data so the same definition can
 * render as a facet button + popover, a bottom sheet, and a section of the
 * "All filters" sheet without three hand-written copies drifting apart.
 *
 * State is owned by the caller. The URL-driven catalogue pages and the
 * in-memory library pages both describe their facets this way; the toolbar
 * never needs to know where the selection lives.
 */
export interface FacetDef {
  id: string;
  /** Singular noun shown on the button, e.g. "Genre". */
  label: string;
  icon?: ReactNode;
  /** Multi facets toggle values; single facets pick one (or none). */
  mode: "multi" | "single";
  options: FacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Long lists get a search field. Defaults to more than ten options. */
  searchable?: boolean;
  /**
   * Label for the "no filter" row single facets show at the top, e.g.
   * "Any score". Picking it clears the facet.
   */
  anyLabel?: string;
}

export function isSearchable(facet: FacetDef): boolean {
  return facet.searchable ?? facet.options.length > 10;
}

/** "RPG" for one value, "2" for several, null when nothing is chosen. */
export function facetSummary(facet: FacetDef): string | null {
  if (facet.selected.length === 0) return null;
  if (facet.selected.length === 1) {
    const option = facet.options.find((item) => item.value === facet.selected[0]);
    return option?.short ?? option?.label ?? facet.selected[0];
  }
  return String(facet.selected.length);
}

/** Longer description for section headers: every chosen label, comma-joined. */
export function facetDescription(facet: FacetDef): string {
  if (facet.selected.length === 0) return facet.anyLabel ?? "Any";
  return facet.selected
    .map((value) => facet.options.find((item) => item.value === value)?.label ?? value)
    .join(", ");
}

/** Toggles a value in a facet's selection, respecting its mode. */
export function toggleFacetValue(facet: FacetDef, value: string): string[] {
  if (facet.mode === "single") {
    // Re-picking the current value (or the "Any" row) clears the facet.
    return value === "" || facet.selected[0] === value ? [] : [value];
  }
  return facet.selected.includes(value)
    ? facet.selected.filter((item) => item !== value)
    : [...facet.selected, value];
}
