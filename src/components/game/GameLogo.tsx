"use client";

import { useState } from "react";
import type { GameLogo as GameLogoData } from "@/lib/games/types";
import { cn } from "@/lib/utils/cn";

/**
 * A game's official wordmark, with an honest typographic fallback.
 *
 * Logos arrive in three tones (see `GameLogo` in types.ts). On this dark UI:
 *
 *  - "light" (white marks) render as-is, with a soft shadow so they hold up
 *    over bright key art.
 *  - "dark" (black marks) are inverted — otherwise they vanish into the
 *    background. The inversion is a class keyed off `data-logo-tone` and is
 *    undone under `[data-theme="light"]`, so the light theme shows the mark
 *    as drawn — unless `surface="dark"` says the backdrop stays dark.
 *  - "color" marks are designed to work anywhere and are left alone.
 *
 * With no logo, or when the image fails to load, the game's name is set as
 * a wordmark in the display face instead — never a broken image.
 */

export interface GameLogoProps {
  name: string;
  logo?: GameLogoData | null;
  className?: string;
  /** Rendered height of the mark; the width follows its aspect ratio. */
  height?: number | string;
  align?: "start" | "center";
  priority?: boolean;
  fallback?: "wordmark" | "none";
  /**
   * "auto" follows the page theme. "dark" is for surfaces that stay dark in
   * both themes (heroes over key art): black marks are always inverted and
   * the wordmark fallback is always white.
   */
  surface?: "auto" | "dark";
}

const TONE_CLASSES: Record<GameLogoData["tone"], string> = {
  light: "drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)]",
  dark: "invert brightness-110 [:root[data-theme=light]_&]:invert-0 [:root[data-theme=light]_&]:brightness-100",
  color: "drop-shadow-[0_1px_6px_rgba(0,0,0,0.3)]",
};

/** Black marks on a surface that is dark regardless of theme. */
const DARK_SURFACE_DARK_TONE = "invert brightness-110";

export function GameLogo({
  name,
  logo,
  className,
  height = 64,
  align = "start",
  priority = false,
  fallback = "wordmark",
  surface = "auto",
}: GameLogoProps) {
  // Tracked by URL so a new `logo` (e.g. a rotating hero) retries cleanly.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const usable = logo && logo.url !== failedUrl ? logo : null;
  const cssHeight = typeof height === "number" ? `${height}px` : height;

  if (usable) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote transparent PNG/SVG at intrinsic aspect; next/image needs fixed dimensions and images are unoptimized anyway.
      <img
        src={usable.url}
        alt={name}
        data-logo-tone={usable.tone}
        data-logo-source={usable.source}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        draggable={false}
        onError={() => setFailedUrl(usable.url)}
        style={{ height: cssHeight }}
        className={cn(
          "block w-auto max-w-full select-none object-contain",
          align === "center" ? "mx-auto object-center" : "object-left",
          surface === "dark" && usable.tone === "dark" ? DARK_SURFACE_DARK_TONE : TONE_CLASSES[usable.tone],
          className,
        )}
      />
    );
  }

  if (fallback === "none") return null;

  return (
    <span
      style={{ fontSize: `calc(${cssHeight} * 0.42)` }}
      className={cn(
        "font-display line-clamp-2 block font-bold leading-[1.02] tracking-[-0.03em] text-balance",
        align === "center" ? "text-center" : "text-left",
        surface === "dark" && "text-white",
        className,
      )}
    >
      {name}
    </span>
  );
}
