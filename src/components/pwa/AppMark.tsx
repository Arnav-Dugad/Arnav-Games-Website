"use client";

import { useId } from "react";
import { MARK_GLYPH_PATH, MARK_GRADIENT_FROM, MARK_GRADIENT_TO, MARK_TILE_RADIUS } from "./brand-mark";
import { cn } from "@/lib/utils/cn";

/**
 * The app icon as it appears on a home screen — used by the install prompt and
 * Settings row. `className` sets the size (default 44px); `cn` doesn't merge
 * conflicting utilities, so the default only applies when none is given.
 */
export function AppMark({ className = "h-11 w-11" }: { className?: string }) {
  // Unique per instance: the prompt and the Settings row can be on screen together.
  // Sanitised because some React versions put characters in ids that `url(#…)` can't reference.
  const gradientId = `ag-mark-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("shrink-0 drop-shadow-[0_6px_16px_rgba(124,92,255,0.45)]", className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={MARK_GRADIENT_FROM} />
          <stop offset="1" stopColor={MARK_GRADIENT_TO} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={MARK_TILE_RADIUS} fill={`url(#${gradientId})`} />
      <path d={MARK_GLYPH_PATH} fill="#fff" />
    </svg>
  );
}
