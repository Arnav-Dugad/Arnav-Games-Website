"use client";

import { GameCard } from "./GameCard";
import { Stagger, StaggerItem } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils/cn";
import type { GameSummary } from "@/lib/games/types";

/**
 * Responsive grid. Two columns on phones is deliberate — a single column wastes
 * the width and makes browsing a long list feel endless, and the 3:4 poster
 * stays legible at that size.
 */
export function GameGrid({
  games,
  className,
  priorityCount = 4,
}: {
  games: GameSummary[];
  className?: string;
  priorityCount?: number;
}) {
  return (
    <Stagger
      className={cn(
        // 2 / 3 / 4 / 6 columns: browse pages (24) and catalogue steps (60)
        // divide evenly at every width, so the last row never has a hole.
        "grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:grid-cols-6",
        className,
      )}
      gap={0.045}
      // Grids are the main target of pagination and filtering, so they must
      // never depend on where the reader happens to be scrolled.
      onMount
    >
      {games.map((game, i) => (
        <StaggerItem key={game.id}>
          <GameCard
            game={game}
            priority={i < priorityCount}
            sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, (max-width: 1280px) 23vw, 220px"
          />
        </StaggerItem>
      ))}
    </Stagger>
  );
}
