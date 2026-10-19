"use client";

/**
 * Small pieces of price UI shared by the Prices section, the bento's price
 * tile and the compare page, so a verdict or a store reads the same
 * everywhere it appears.
 */

import { CircleHelp, Hourglass, Scale, ThumbsUp } from "lucide-react";
import type { ReactNode } from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { cn } from "@/lib/utils/cn";
import type { GameMarket, LocalPrice, PriceVerdictKind } from "@/lib/games/types";

export const STORE_LABEL: Record<LocalPrice["store"], string> = {
  steam: "Steam",
  microsoft: "Microsoft Store",
};

export function StoreMark({ store, size = 15 }: { store: LocalPrice["store"]; size?: number }) {
  return <BrandIcon name={store === "steam" ? "steam" : "xbox"} size={size} title={null} tinted={store === "microsoft"} />;
}

export const VERDICT: Record<PriceVerdictKind, { label: string; short: string; icon: ReactNode; className: string }> = {
  buy: {
    label: "Good time to buy",
    short: "Buy",
    icon: <ThumbsUp size={13} />,
    className: "border-mint/30 bg-mint/12 text-mint",
  },
  wait: {
    label: "Wait for a sale",
    short: "Wait",
    icon: <Hourglass size={13} />,
    className: "border-gold/30 bg-gold/12 text-gold",
  },
  fair: {
    label: "Fair price",
    short: "Fair",
    icon: <Scale size={13} />,
    className: "border-line bg-fg/[0.06] text-text",
  },
  unknown: {
    label: "Too early to call",
    short: "No call yet",
    icon: <CircleHelp size={13} />,
    className: "border-line bg-fg/[0.04] text-muted",
  },
};

export function VerdictChip({ kind, short = false, className }: { kind: PriceVerdictKind; short?: boolean; className?: string }) {
  const verdict = VERDICT[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold leading-none",
        verdict.className,
        className,
      )}
    >
      <span aria-hidden>{verdict.icon}</span>
      {short ? verdict.short : verdict.label}
    </span>
  );
}

/** The cheapest current listing, preferring Steam on a tie (its history is deeper). */
export function bestPrice(market: GameMarket): LocalPrice | null {
  if (market.prices.length === 0) return null;
  return [...market.prices].sort((a, b) => a.price - b.price || (a.store === "steam" ? -1 : 1))[0];
}

export function DiscountTag({ percent, className }: { percent: number; className?: string }) {
  if (percent < 1) return null;
  return (
    <span className={cn("rounded-md bg-mint/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-mint", className)}>
      −{Math.round(percent)}%
    </span>
  );
}
