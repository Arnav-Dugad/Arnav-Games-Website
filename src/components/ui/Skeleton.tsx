import { cn } from "@/lib/utils/cn";

/**
 * Loading placeholders in the glass language.
 *
 * A faint foreground tint (so it flips with the theme) under a soft sheen that
 * sweeps across with a transform — compositor-only, unlike the old
 * background-position shimmer, which repainted every placeholder every frame.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton-glass rounded-xl", className)} aria-hidden />;
}

/** Placeholder matching `GameCard`'s exact geometry, so grids don't reflow. */
export function GameCardSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="aspect-[3/4] w-full rounded-2xl" />
      {/* Two caption lines at the card title's 13px / snug leading. */}
      <Skeleton className="mt-2.5 h-3.5 w-4/5 rounded-full" />
      <Skeleton className="mt-2 h-3.5 w-2/5 rounded-full" />
    </div>
  );
}

export function GameGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading games"
      // Mirrors GameGrid's own column and gap scale exactly.
      className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:grid-cols-5"
    >
      {Array.from({ length: count }, (_, i) => (
        <GameCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function GameRailSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading games" className="flex gap-3.5 overflow-hidden sm:gap-4 lg:gap-5">
      {Array.from({ length: count }, (_, i) => (
        // Same widths as GameRail's poster slots.
        <div key={i} className="w-[42vw] max-w-[220px] shrink-0 sm:w-52 lg:w-56 xl:w-60">
          <GameCardSkeleton />
        </div>
      ))}
    </div>
  );
}
