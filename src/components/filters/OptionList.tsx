"use client";

/**
 * The list inside every filter surface — popover, bottom sheet and the
 * "All filters" sections all render this, so keyboard behaviour and
 * semantics are written once.
 *
 * Accessibility follows the WAI-ARIA listbox pattern. Focus never moves onto
 * individual rows; the focused element (the search field when there is one,
 * otherwise the list itself) points at the highlighted row through
 * `aria-activedescendant`. That keeps typing in the search box and arrowing
 * through results one continuous interaction instead of two tab stops.
 */

import { Check, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/cn";
import type { FacetOption } from "./types";

/** Case- and accent-insensitive, so "pokemon" finds "Pokémon". */
const fold = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function OptionList({
  options,
  selected,
  mode,
  onToggle,
  label,
  searchable = false,
  searchPlaceholder,
  anyLabel,
  autoFocus = false,
  listClassName,
}: {
  options: FacetOption[];
  selected: string[];
  mode: "multi" | "single";
  onToggle: (value: string) => void;
  /** Accessible name for the list, e.g. "Genres". */
  label: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Single facets: a leading "no filter" row with this label. */
  anyLabel?: string;
  /** Desktop popovers focus the list on open; sheets don't, so no keyboard pops up. */
  autoFocus?: boolean;
  /** Height cap / scrolling for the row container. */
  listClassName?: string;
}) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);

  const rows = useMemo(() => {
    const term = fold(query.trim());
    const matches = term
      ? options.filter((option) => fold(option.label).includes(term))
      : options;
    // The "Any" row is a reset, not a result — it would be noise in a search.
    return mode === "single" && anyLabel && !term
      ? [{ value: "", label: anyLabel } as FacetOption, ...matches]
      : matches;
  }, [options, query, mode, anyLabel]);

  const isSelected = (value: string) =>
    value === "" ? selected.length === 0 : selected.includes(value);

  const optionId = (index: number) => `${baseId}-opt-${index}`;

  useEffect(() => {
    if (!autoFocus) return;
    // A frame later, once the popover has been measured and made visible —
    // focusing a `visibility: hidden` element silently fails.
    const frame = requestAnimationFrame(() => {
      (searchable ? inputRef.current : listRef.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, searchable]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from a stable id; listing it would only add noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (rows.length === 0) return;
    const last = rows.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => (index >= last ? 0 : index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => (index <= 0 ? last : index - 1));
        break;
      case "Home":
        // In a search field Home/End belong to the caret.
        if (searchable) return;
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        if (searchable) return;
        event.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ": {
        // Space types a space in the search field; only Enter selects there.
        if (event.key === " " && searchable) return;
        const row = rows[active];
        if (!row) return;
        event.preventDefault();
        onToggle(row.value);
        break;
      }
    }
  };

  const activeDescendant = active >= 0 && rows[active] ? optionId(active) : undefined;

  return (
    <div className="flex min-h-0 flex-col">
      {searchable && (
        <div className="relative mb-1.5 px-0.5 pt-0.5">
          <Search
            aria-hidden
            size={15}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeDescendant}
            aria-label={`Search ${label.toLowerCase()}`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(event.target.value.trim() ? 0 : -1);
            }}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}`}
            autoComplete="off"
            spellCheck={false}
            // 16px on touch: anything smaller makes iOS zoom the page on focus.
            className="h-10 w-full rounded-xl border border-transparent bg-fg/[0.07] pl-9 pr-9 text-[14px] text-text outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus:bg-fg/[0.09] coarse:h-11 coarse:text-base"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setActive(-1);
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:bg-fg/10 hover:text-text"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        aria-multiselectable={mode === "multi" || undefined}
        aria-activedescendant={searchable ? undefined : activeDescendant}
        tabIndex={searchable ? -1 : 0}
        onKeyDown={searchable ? undefined : onKeyDown}
        onFocus={() => {
          if (searchable || active >= 0) return;
          // Land on the current choice, the way a native menu opens.
          const current = rows.findIndex((row) => isSelected(row.value));
          setActive(Math.max(0, current));
        }}
        onPointerLeave={() => setActive(-1)}
        className={cn("space-y-0.5 outline-none", listClassName)}
      >
        {rows.map((row, index) => {
          const isOn = isSelected(row.value);
          return (
            <div
              key={row.value || "__any"}
              id={optionId(index)}
              role="option"
              aria-selected={isOn}
              onClick={() => onToggle(row.value)}
              onPointerMove={() => {
                if (active !== index) setActive(index);
              }}
              className={cn(
                "flex min-h-10 cursor-pointer select-none items-center gap-3 rounded-[14px] px-3 text-[14px] transition-colors duration-150 coarse:min-h-12 coarse:text-[15px]",
                index === active ? "bg-fg/[0.09]" : "bg-transparent",
                isOn ? "text-text" : "text-muted",
              )}
            >
              {mode === "multi" && (
                <span
                  aria-hidden
                  className={cn(
                    "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] border transition-colors duration-150",
                    isOn ? "border-brand bg-brand text-white" : "border-fg/25 bg-transparent text-transparent",
                  )}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              {row.icon && <span className="shrink-0 text-faint">{row.icon}</span>}
              <span className={cn("min-w-0 flex-1 truncate", isOn && "font-medium")}>{row.label}</span>
              {row.count !== undefined && (
                <span className="shrink-0 text-[12px] tabular-nums text-faint">{row.count}</span>
              )}
              {mode === "single" && (
                <Check
                  aria-hidden
                  size={16}
                  strokeWidth={2.5}
                  className={cn("shrink-0 text-brand-soft", !isOn && "invisible")}
                />
              )}
            </div>
          );
        })}

        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-[13px] text-faint">
            Nothing matches “{query.trim()}”.
          </p>
        )}
      </div>
    </div>
  );
}
