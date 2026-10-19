"use client";

/**
 * Animated gradient-mesh backdrop.
 *
 * Three heavily-blurred blobs on long, offset cycles. Rendered as fixed-size
 * divs with CSS animation rather than a canvas or SVG filter — the whole effect
 * costs three composited layers and no per-frame JS.
 *
 * On coarse pointers the blur radius drops sharply: large `filter: blur()`
 * surfaces are one of the most expensive things a mobile GPU can be asked to
 * composite, and the effect still reads at a smaller radius.
 */

import { cn } from "@/lib/utils/cn";

interface AuroraProps {
  className?: string;
  /** Dials the whole effect up or down without touching individual blobs. */
  intensity?: "subtle" | "normal" | "vivid";
}

const OPACITY = {
  subtle: "opacity-[0.35]",
  normal: "opacity-60",
  vivid: "opacity-80",
} as const;

export function Aurora({ className, intensity = "normal" }: AuroraProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        OPACITY[intensity],
        className,
      )}
    >
      <div
        className="absolute -top-[30%] left-[-10%] h-[60vmax] w-[60vmax] rounded-full blur-[80px] coarse:blur-[48px] animate-aurora"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, rgba(124,92,255,0.55), rgba(124,92,255,0) 62%)",
        }}
      />
      <div
        className="absolute -right-[15%] top-[5%] h-[52vmax] w-[52vmax] rounded-full blur-[90px] coarse:blur-[52px] animate-aurora"
        style={{
          background:
            "radial-gradient(circle at 60% 40%, rgba(34,211,238,0.42), rgba(34,211,238,0) 64%)",
          animationDelay: "-7s",
        }}
      />
      <div
        className="absolute bottom-[-25%] left-[20%] h-[48vmax] w-[48vmax] rounded-full blur-[100px] coarse:blur-[56px] animate-aurora"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,61,139,0.35), rgba(255,61,139,0) 66%)",
          animationDelay: "-14s",
        }}
      />
    </div>
  );
}

/**
 * Fine grid that fades out toward the bottom. Sits under the aurora to give the
 * background a sense of structure and scale.
 */
export function GridLines({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 mask-fade-b", className)}
      style={{
        backgroundImage:
          "linear-gradient(to right, color-mix(in oklab, var(--color-fg) 4.5%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--color-fg) 4.5%, transparent) 1px, transparent 1px)",
        backgroundSize: "56px 56px",
      }}
    />
  );
}
