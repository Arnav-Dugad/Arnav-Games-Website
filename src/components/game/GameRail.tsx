"use client";

/**
 * Horizontal game rail.
 *
 * Touch: a native scroll-snap rail — momentum, rubber-banding and snap points
 * all come from the platform, which no JS carousel matches for feel.
 * Desktop: the same rail plus arrow controls, since users without a horizontal
 * scroll gesture have no good way to page through it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GameCard } from "./GameCard";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils/cn";
import type { GameSummary } from "@/lib/games/types";

interface GameRailProps {
  games: GameSummary[];
  className?: string;
  shape?: "poster" | "wide";
  priorityCount?: number;
}

export function GameRail({ games, className, shape = "poster", priorityCount = 0 }: GameRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const syncEdges = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    // 4px slack absorbs sub-pixel rounding at fractional zoom levels.
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    syncEdges();
    const el = railRef.current;
    if (!el) return;
    const observer = new ResizeObserver(syncEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncEdges, games.length]);

  const scrollBy = (direction: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    // Page by ~85% of the viewport so a partial card stays visible as an anchor.
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  };

  if (games.length === 0) return null;

  return (
    <div className={cn("group/rail relative", className)}>
      {/* `rail-gutter` keeps the first card aligned with the section heading
          above it while still letting cards scroll off the viewport edge. */}
      {/*
        The vertical padding is load-bearing, not decoration.

        `.snap-rail` sets `overflow-x: auto`, and CSS forces the other axis to
        `auto` whenever one axis is not `visible` — so the rail clips vertically
        too, even though nothing scrolls that way. Cards lift on hover (a 3%
        scale, a 3D tilt and a 24px drop shadow), and all of that was being
        sliced off at the rail's edges. Padding gives the hover state somewhere
        to grow into; the negative margin keeps the surrounding rhythm intact.
      */}
      <div
        ref={railRef}
        onScroll={syncEdges}
        className="snap-rail rail-gutter -my-4 gap-3.5 py-4 sm:gap-4 lg:gap-5"
      >
        {games.map((game, i) => (
          <Reveal
            key={game.id}
            // Cap the stagger so the tail of a long rail isn't left waiting.
            delay={Math.min(i, 6) * 0.05}
            amount={0.1}
            blur={false}
            className={cn(
              shape === "poster"
                ? "w-[42vw] max-w-[220px] sm:w-52 lg:w-56 xl:w-60"
                : "w-[80vw] max-w-[420px] sm:w-96",
            )}
          >
            <GameCard game={game} shape={shape} priority={i < priorityCount} />
          </Reveal>
        ))}
      </div>

      <RailButton direction="left" disabled={atStart} onClick={() => scrollBy(-1)} />
      <RailButton direction="right" disabled={atEnd} onClick={() => scrollBy(1)} />
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
        "absolute top-1/2 hidden -translate-y-1/2 fine:grid",
        "h-11 w-11 place-items-center rounded-full",
        "material text-text",
        "opacity-0 transition-all duration-300 group-hover/rail:opacity-100 focus-visible:opacity-100",
        "hover:scale-110 hover:border-line-strong active:scale-95",
        "disabled:pointer-events-none disabled:opacity-0",
        direction === "left" ? "left-2 xl:left-4" : "right-2 xl:right-4",
      )}
    >
      <Icon size={18} />
    </button>
  );
}
