"use client";

/**
 * The container a filter control opens into: an anchored glass popover on
 * desktop, a bottom sheet on touch and narrow windows.
 *
 * Both presentations take the same title, body and footer, so every facet
 * and sort menu gets the right one for free — and so they can't drift into
 * subtly different headers or button orders over time.
 */

import { useCallback, useRef, type ReactNode } from "react";
import { Popover } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/utils/cn";

/**
 * A frosted toolbar pinned to the bottom of a sheet, flush with its edges.
 * Negative margins cancel the sheet body's padding so nothing scrolls visibly
 * underneath it, and the blur keeps rows legible as they pass behind.
 */
export const SHEET_TOOLBAR =
  "sticky bottom-0 z-10 -mx-5 -mb-6 mt-4 border-t border-fg/[0.08] px-5 pb-5 pt-3 backdrop-blur-xl [background:color-mix(in_oklab,var(--color-panel)_78%,transparent)] sm:-mx-6 sm:px-6";

export function FilterSurface({
  open,
  onClose,
  anchorRef,
  presentation,
  title,
  description,
  headerAction,
  footer,
  width = 300,
  align = "start",
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  presentation: "sheet" | "popover";
  title: string;
  /** Sheet only: a line under the title, e.g. the current selection. */
  description?: string;
  /** Popover only: a compact action beside the title, e.g. "Clear". */
  headerAction?: ReactNode;
  /** Sheet only: pinned to the bottom of the sheet. */
  footer?: ReactNode;
  width?: number;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  /*
   * Return focus to the trigger when the popover closes from inside —
   * Escape, or a single-select pick. Skipped when focus is already elsewhere
   * (an outside click on another control), which would otherwise be yanked
   * back. The sheet's dialog focus hook does the same job on its own.
   */
  const closePopover = useCallback(() => {
    const active = document.activeElement;
    const focusWasInside = Boolean(active && contentRef.current?.contains(active));
    onClose();
    if (focusWasInside) anchorRef.current?.focus({ preventScroll: true });
  }, [onClose, anchorRef]);

  if (presentation === "sheet") {
    return (
      <Sheet open={open} onClose={onClose} title={title} description={description}>
        {children}
        {footer && (
          <div className={SHEET_TOOLBAR}>
            {footer}
          </div>
        )}
      </Sheet>
    );
  }

  return (
    <Popover
      open={open}
      onClose={closePopover}
      anchorRef={anchorRef}
      width={width}
      align={align}
      label={title}
    >
      <div ref={contentRef}>
        <div className="flex min-h-9 items-center justify-between gap-3 px-3 pb-1 pt-1.5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{title}</p>
          {headerAction}
        </div>
        {children}
      </div>
    </Popover>
  );
}

/** The compact text action used in popover headers. */
export function SurfaceTextButton({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-1 text-[13px] font-medium text-brand-soft transition-colors hover:bg-brand/10 hover:text-text",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Two-button sheet footer: a quiet secondary action and a filled primary. */
export function SheetFooterButtons({
  secondary,
  onSecondary,
  secondaryDisabled,
  primary,
  onPrimary,
}: {
  secondary: string;
  onSecondary: () => void;
  secondaryDisabled?: boolean;
  primary: ReactNode;
  onPrimary: () => void;
}) {
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onSecondary}
        disabled={secondaryDisabled}
        className="press min-h-12 flex-1 rounded-full bg-fg/[0.08] text-[15px] font-medium text-text transition-opacity disabled:opacity-40"
      >
        {secondary}
      </button>
      <button
        type="button"
        onClick={onPrimary}
        className="press inline-flex min-h-12 flex-[2] items-center justify-center gap-2 rounded-full bg-brand text-[15px] font-semibold text-white shadow-[inset_0_1px_0_#ffffff40]"
      >
        {primary}
      </button>
    </div>
  );
}
