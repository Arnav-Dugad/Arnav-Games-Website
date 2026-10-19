"use client";

/**
 * A collapsed filter: one glass pill that names the dimension and its current
 * state ("Genre · 2", "Score · 90+") without spelling out every option.
 *
 * Active facets take the brand tint so the set of applied filters reads at a
 * glance across the whole rail, even before anyone opens one.
 */

import { forwardRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export const FacetButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    icon?: ReactNode;
    /** Current selection in compact form; null when the facet is unset. */
    summary?: string | null;
    open?: boolean;
    onClick: () => void;
    /** Overrides the chevron, e.g. a count badge on "All filters". */
    trailing?: ReactNode;
    /** Treat as active even without a summary, e.g. a boolean toggle. */
    active?: boolean;
    /** Plain toggles have no popup; they flip state directly. */
    toggle?: boolean;
    className?: string;
  }
>(function FacetButton(
  { label, icon, summary, open = false, onClick, trailing, active, toggle = false, className },
  ref,
) {
  const isActive = active ?? Boolean(summary);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-haspopup={toggle ? undefined : "dialog"}
      aria-expanded={toggle ? undefined : open}
      aria-pressed={toggle ? isActive : undefined}
      className={cn(
        "press inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-200 coarse:min-h-11 coarse:px-4 coarse:text-[14px]",
        isActive
          ? "border-brand/45 bg-brand/[0.18] text-text shadow-[inset_0_1px_0_#ffffff1f]"
          : open
            ? "border-fg/20 bg-fg/[0.12] text-text"
            : "border-fg/10 bg-fg/[0.06] text-text fine:hover:border-fg/15 fine:hover:bg-fg/[0.1]",
        className,
      )}
    >
      {icon && <span className={cn("shrink-0", isActive ? "text-brand-soft" : "text-muted")}>{icon}</span>}
      <span>{label}</span>
      {summary && (
        <>
          <span aria-hidden className="opacity-45">·</span>
          <span className="max-w-[9rem] truncate font-semibold">{summary}</span>
        </>
      )}
      {trailing ??
        (!toggle && (
          <ChevronDown
            aria-hidden
            size={14}
            className={cn(
              "-mr-0.5 shrink-0 transition-transform duration-300 ease-[var(--ease-apple)]",
              isActive ? "text-brand-soft" : "text-faint",
              open && "rotate-180",
            )}
          />
        ))}
    </button>
  );
});
