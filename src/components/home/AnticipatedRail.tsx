"use client";

/**
 * "Most anticipated": a poster rail ranked by the hype index, with each
 * card's rank and score set beneath it.
 *
 * The score lives under the card rather than on the poster: `GameCard` owns
 * the poster's corners (ownership, critic score, the "Upcoming" chip), and a
 * third badge there would crowd the art. Below the title it reads like an
 * App Store chart position — rank first, then the number behind it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { GameCard } from "@/components/game/GameCard";
import { Reveal } from "@/components/motion/Reveal";
import { useRubberBand } from "@/components/interactions/useRubberBand";
import { cn } from "@/lib/utils/cn";
import type { RankedGame } from "@/lib/games/types";

export function AnticipatedRail({ items }: { items: RankedGame[] }) {
  const railRef = useRef<HTMLOListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  useRubberBand(railRef);

  const syncEdges = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(syncEdges);
    const observer = new ResizeObserver(syncEdges);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [syncEdges, items.length]);

  const page = (direction: 1 | -1) => {
    const el = railRef.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  };

  if (items.length === 0) return null;

  return (
    <div className="group/rail relative">
      {/* Vertical padding gives the cards' hover lift room inside the
          scroller's implicit vertical clip; see GameRail. */}
      <ol
        ref={railRef}
        onScroll={syncEdges}
        aria-label="Most anticipated games, ranked by hype"
        className="snap-rail rail-gutter -my-4 gap-3.5 py-4 sm:gap-4 lg:gap-5"
      >
        {items.map(({ game, hype }, i) => (
          <li key={game.id} className="w-[42vw] max-w-[220px] sm:w-52 lg:w-56 xl:w-60">
            <Reveal delay={Math.min(i, 6) * 0.05} amount={0.1} blur={false}>
              <GameCard game={game} />
              <div className="mt-2.5 flex items-center gap-2 px-0.5">
                <span
                  aria-label={`Rank ${i + 1}`}
                  className="font-display text-[22px] font-bold leading-none tracking-[-0.04em] text-fg/30 tabular-nums"
                >
                  {i + 1}
                </span>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-flare/12 px-2 py-[3px] text-[11px] font-semibold tabular-nums text-flare"
                  title="Hype index: anticipation from follows, want-to-play lists and page visits (0–100)"
                >
                  <Flame size={11} aria-hidden />
                  {hype}
                  <span className="font-medium opacity-80">hype</span>
                </span>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>

      <RailButton direction="left" disabled={atStart} onClick={() => page(-1)} />
      <RailButton direction="right" disabled={atEnd} onClick={() => page(1)} />
    </div>
  );
}

function RailButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "left" ? "Scroll left" : "Scroll right"}
      className={cn(
        "material absolute top-[38%] hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-text fine:grid",
        "opacity-0 transition-all duration-300 group-hover/rail:opacity-100 focus-visible:opacity-100",
        "hover:scale-110 active:scale-95 disabled:pointer-events-none disabled:opacity-0",
        direction === "left" ? "left-2 xl:left-4" : "right-2 xl:right-4",
      )}
    >
      <Icon size={18} />
    </button>
  );
}
