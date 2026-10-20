"use client";

/**
 * "Should I wait?" under the best price: a hedged verdict, how sure we are,
 * the one-line reason, and — a tap away — every signal that went into it
 * (`buying-tip.ts`). It only ever renders once the market has arrived, which
 * is client-side, so reading the clock here can't split server and client
 * HTML.
 */

import { useMemo, useState, type ReactNode } from "react";
import { CalendarClock, ChevronDown, Hourglass, Info, ThumbsUp, TrendingDown } from "lucide-react";
import { buyingTip, saleSentence, type BuyingTip, type BuyingTipKind, type TipConfidence, type TipReason } from "@/lib/games/buying-tip";
import type { GameMarket, LocalPrice } from "@/lib/games/types";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { InfoTip } from "./InfoTip";

const KIND: Record<BuyingTipKind, { label: string; icon: ReactNode; className: string }> = {
  buy: { label: "Good time to buy", icon: <ThumbsUp size={13} />, className: "border-mint/30 bg-mint/12 text-mint" },
  soon: { label: "Likely cheaper soon", icon: <TrendingDown size={13} />, className: "border-gold/30 bg-gold/12 text-gold" },
  wait: { label: "Wait for the sale", icon: <Hourglass size={13} />, className: "border-gold/30 bg-gold/12 text-gold" },
};

const CONFIDENCE: Record<TipConfidence, { label: string; level: number }> = {
  high: { label: "High confidence", level: 3 },
  medium: { label: "Medium confidence", level: 2 },
  low: { label: "Low confidence", level: 1 },
};

const LEAN: Record<TipReason["lean"], ReactNode> = {
  buy: <ThumbsUp size={13} className="text-mint" />,
  wait: <Hourglass size={13} className="text-gold" />,
  info: <Info size={13} className="text-faint" />,
};

/** The tip for this market, or null when there's nothing to judge (free, unreleased, no price). */
export function useBuyingTip(
  market: GameMarket,
  best: LocalPrice | null,
  game: { released: string | null; publishers: string[] },
): BuyingTip | null {
  // Captured once per mount: the tip is about today, not about the instant of each render.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  return useMemo(() => {
    if (!best) return null;
    return buyingTip({
      today,
      current: best,
      history: {
        kind: market.verdict.kind,
        reason: market.verdict.reason,
        days: new Set(market.history.map((point) => point.date)).size,
        lowest: market.lowest?.price ?? null,
      },
      deepestDiscount: market.lowestEver?.deepestDiscount ?? null,
      released: game.released,
      publishers: game.publishers,
      onSteam: market.prices.some((price) => price.store === "steam" && price.price > 0),
    });
  }, [market, best, game.released, game.publishers, today]);
}

export function BuyingTipPanel({ tip }: { tip: BuyingTip }) {
  const [open, setOpen] = useState(false);
  const calm = useCalmMotion();
  const kind = KIND[tip.kind];
  const confidence = CONFIDENCE[tip.confidence];
  const rest = tip.reasons.filter((reason) => reason.text !== tip.summary);
  const saleText = tip.sale ? saleSentence(tip.sale) : null;
  // The sale countdown always shows; as a pill unless it's already one of the reasons.
  const salePill = tip.sale && saleText && !tip.reasons.some((reason) => reason.text === saleText) ? tip.sale : null;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold leading-none",
            kind.className,
          )}
        >
          <span aria-hidden>{kind.icon}</span>
          {kind.label}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted">
          <span aria-hidden className="flex items-end gap-[2px]">
            {[1, 2, 3].map((bar) => (
              <span
                key={bar}
                className={cn("w-[3px] rounded-full", bar <= confidence.level ? "bg-current" : "bg-fg/15")}
                style={{ height: 4 + bar * 3 }}
              />
            ))}
          </span>
          {confidence.label}
          <InfoTip topic="buyingTip" />
        </span>
      </div>

      <p className="mt-2.5 text-[14px] leading-snug text-text">{tip.summary}</p>

      {salePill && (
        <p className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-fg/[0.05] px-2.5 py-1 text-[12px] text-muted">
          <CalendarClock size={12} aria-hidden className="shrink-0 text-faint" />
          <span className="min-w-0">
            Steam {salePill.name}
            {" · "}
            <span className="tabular-nums">
              {salePill.live ? "on now" : `${salePill.estimated ? "~" : ""}${salePill.daysUntil} ${salePill.daysUntil === 1 ? "day" : "days"} away`}
            </span>
          </span>
        </p>
      )}

      {rest.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              haptic("selection");
              setOpen((value) => !value);
            }}
            className="press -ml-1 mt-2 flex min-h-10 items-center gap-1 rounded-full px-1 text-[13px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))] coarse:min-h-11"
          >
            {open ? "Hide the reasons" : `Why? ${rest.length} more ${rest.length === 1 ? "signal" : "signals"}`}
            <ChevronDown size={14} aria-hidden className={cn(!calm && "transition-transform duration-300", open && "rotate-180")} />
          </button>
          <div
            className={cn("grid", !calm && "transition-[grid-template-rows] duration-300 ease-[var(--ease-apple)]")}
            style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
          >
            <ul className="min-h-0 space-y-2 overflow-hidden" inert={!open}>
              {rest.map((reason) => (
                <li key={reason.text} className="flex gap-2 text-[13px] leading-snug text-muted first:pt-1">
                  <span aria-hidden className="mt-[2px] shrink-0">
                    {LEAN[reason.lean]}
                  </span>
                  <span className="min-w-0">
                    <span className="sr-only">{reason.lean === "buy" ? "For buying now: " : reason.lean === "wait" ? "For waiting: " : "Note: "}</span>
                    {reason.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
