"use client";

/**
 * Steam's charts as ranked lists, App Store "Top Charts" style: rank, cover,
 * title, one line of context, score. Rank is the point of the page, so it
 * leads every row instead of hiding in a shelf of equal cards.
 *
 * Desktop shows the charts side by side. A phone shows one at a time behind
 * a segmented control — three 15-row lists stacked would be a very long
 * scroll to reach the third.
 */

import Link from "next/link";
import { useState } from "react";
import { SegmentedControl } from "@/components/filters";
import { GameCover } from "@/components/game/GameCover";
import { ScorePill } from "@/components/ui/ScoreRing";
import { cn } from "@/lib/utils/cn";
import { isUnreleased, releaseLabel, releaseYear } from "@/lib/utils/format";
import type { GameSummary } from "@/lib/games/types";

export interface ChartData {
  key: string;
  title: string;
  /** Short label for the phone segmented control. */
  short: string;
  /** What the rank measures, in a few words. */
  measure: string;
  games: GameSummary[];
}

export function SteamCharts({ charts }: { charts: ChartData[] }) {
  const [active, setActive] = useState(charts[0]?.key ?? "");

  return (
    <div>
      <SegmentedControl
        className="mb-6 lg:hidden"
        label="Chart"
        value={active}
        onChange={setActive}
        segments={charts.map((chart) => ({ value: chart.key, label: chart.title, shortLabel: chart.short }))}
      />
      <div className="grid gap-10 lg:grid-cols-3 lg:gap-8">
        {charts.map((chart) => (
          <section
            key={chart.key}
            aria-labelledby={`chart-${chart.key}`}
            className={cn(chart.key !== active && "max-lg:hidden")}
          >
            <header className="mb-2 border-b border-line pb-3 max-lg:sr-only">
              <h2 id={`chart-${chart.key}`} className="text-[22px] font-bold tracking-[-0.02em]">
                {chart.title}
              </h2>
              <p className="mt-0.5 text-[13px] text-muted">{chart.measure}</p>
            </header>
            <p className="mb-2 text-[13px] text-muted lg:hidden">{chart.measure}</p>
            <ol>
              {chart.games.map((game, index) => (
                <li key={game.id} className="border-b border-line last:border-b-0">
                  <ChartRow game={game} rank={index + 1} />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

function ChartRow({ game, rank }: { game: GameSummary; rank: number }) {
  const upcoming = isUnreleased(game);
  const meta = upcoming
    ? releaseLabel(game)
    : // `releaseYear` prints "TBA" for a missing date; on a released game that
      // reads as an error, so an undated one shows its genre alone.
      [game.genres[0]?.name, game.released ? releaseYear(game.released) : null].filter(Boolean).join(" · ");
  return (
    <Link prefetch={false}
      href={`/game/${game.slug}`}
      className="press group flex items-center gap-3.5 rounded-xl py-2.5 transition-colors fine:hover:bg-fg/[0.04] sm:gap-4"
    >
      <span
        className={cn(
          "w-7 shrink-0 text-center font-display text-[17px] font-bold tabular-nums",
          rank <= 3 ? "text-text" : "text-muted",
        )}
      >
        {rank}
      </span>
      <span className="relative aspect-[3/4] w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-fg/10">
        <GameCover
          name={game.name}
          slug={game.slug}
          image={game.image}
          imageFallback={game.imageFallback}
          width={120}
          sizes="48px"
          priority={rank <= 4}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[15px] font-semibold leading-snug">{game.name}</span>
        {meta && <span className={cn("mt-0.5 block truncate text-[13px]", upcoming ? "text-neon" : "text-muted")}>{meta}</span>}
      </span>
      {game.metacritic !== null && <ScorePill score={game.metacritic} className="shrink-0" />}
    </Link>
  );
}
