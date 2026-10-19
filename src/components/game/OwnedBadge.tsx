"use client";

/**
 * "You own this" marker for a game poster.
 *
 * Appears on every card across the site, so the answer to "do I already have
 * this?" never requires opening the page. That question is asked constantly
 * while browsing a store-like catalogue, and answering it inline is the single
 * cheapest way to stop someone buying a game twice.
 *
 * Renders nothing at all when the game isn't owned, or when nobody is signed
 * in — an empty badge slot on every card would be pure noise.
 */

import { Check } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { OWNERSHIP_PLATFORMS } from "@/lib/games/stores-catalog";
import { cn } from "@/lib/utils/cn";

const iconFor = (slug: string) =>
  OWNERSHIP_PLATFORMS.find((platform) => platform.slug === slug)?.icon ?? null;

export function OwnedBadge({
  gameId,
  className,
  /** `dot` is for dense grids; `pill` names the store. */
  variant = "pill",
}: {
  gameId: number;
  className?: string;
  variant?: "pill" | "dot";
}) {
  const { ownershipOf } = useWatchlist();
  const owned = ownershipOf(gameId);

  if (owned.length === 0) return null;

  const primary = owned[0];
  const icon = iconFor(primary);

  if (variant === "dot") {
    return (
      <span
        title={`Owned on ${owned.join(", ")}`}
        className={cn(
          "grid h-6 w-6 place-items-center rounded-full bg-[#30d158]/90 text-black shadow-lg backdrop-blur-sm",
          className,
        )}
      >
        <Check size={13} strokeWidth={3} />
      </span>
    );
  }

  return (
    <span
      title={`Owned on ${owned.join(", ")}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-[#30d158]/90 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-black shadow-lg backdrop-blur-sm",
        className,
      )}
    >
      {icon ? <BrandIcon name={icon} size={11} title={null} /> : <Check size={11} strokeWidth={3} />}
      Owned
      {owned.length > 1 && <span className="tabular-nums opacity-70">+{owned.length - 1}</span>}
    </span>
  );
}
