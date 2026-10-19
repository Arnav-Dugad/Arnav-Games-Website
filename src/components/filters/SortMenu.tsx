"use client";

/**
 * Sort picker: a checkmarked glass menu on desktop, a sheet list on touch.
 *
 * This replaces a native `<select>`. The native picker was right on phones
 * but rendered as an unstyled OS dropdown on desktop that matched nothing
 * else on the page; a sheet keeps the thumb-reachable list on touch while the
 * desktop menu finally looks like the rest of the glass chrome.
 */

import { useCallback, useRef, useState } from "react";
import { ArrowUpDown, ChevronDown } from "lucide-react";
import { FilterSurface } from "./FilterSurface";
import { OptionList } from "./OptionList";
import { useFilterPresentation } from "./usePresentation";
import { cn } from "@/lib/utils/cn";

export interface SortMenuOption<T extends string> {
  value: T;
  label: string;
}

export function SortMenu<T extends string>({
  options,
  value,
  onChange,
  label = "Sort",
  className,
}: {
  options: SortMenuOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name, e.g. "Sort games". */
  label?: string;
  className?: string;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const presentation = useFilterPresentation();
  const close = useCallback(() => setOpen(false), []);
  const current = options.find((option) => option.value === value) ?? options[0];

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((state) => !state)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ""}`}
        className={cn(
          "press inline-flex min-h-9 min-w-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-200 coarse:min-h-11 coarse:px-4 coarse:text-[14px]",
          open
            ? "border-fg/20 bg-fg/[0.12] text-text"
            : "border-fg/10 bg-fg/[0.06] text-text fine:hover:border-fg/15 fine:hover:bg-fg/[0.1]",
          className,
        )}
      >
        <ArrowUpDown aria-hidden size={14} className="shrink-0 text-muted" />
        <span className="min-w-0 truncate">{current?.label}</span>
        <ChevronDown
          aria-hidden
          size={14}
          className={cn(
            "-mr-0.5 shrink-0 text-faint transition-transform duration-300 ease-[var(--ease-apple)]",
            open && "rotate-180",
          )}
        />
      </button>

      <FilterSurface
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        presentation={presentation}
        title="Sort by"
        width={248}
        align="end"
      >
        <OptionList
          options={options}
          selected={[value]}
          mode="single"
          label="Sort order"
          autoFocus={presentation === "popover"}
          onToggle={(next) => {
            if (next && next !== value) onChange(next as T);
            close();
          }}
        />
      </FilterSurface>
    </>
  );
}
