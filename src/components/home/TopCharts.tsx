"use client";

/**
 * "Top charts": three ranked lists behind one segmented control, laid out
 * like the App Store's charts — numbered rows in columns of four.
 *
 * Merging trending, most-anticipated and top-rated into one section replaces
 * three near-identical poster rails with one that reads as what it is: a
 * ranking. Each row shows the number behind its position (hype index or
 * critic score) so the order is explainable, never just asserted.
 *
 * Phones page sideways one column at a time (snap), tablets and desktop show
 * all three columns. Rows are game-menu targets, so long-press works here
 * like everywhere else.
 */

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { Flame } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { SegmentedControl } from "@/components/filters/SegmentedControl";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { useGameMenuTarget } from "@/components/interactions/game-menu-targets";
import { Container, SectionHeading } from "@/components/ui/SectionHeading";
import { ScorePill } from "@/components/ui/ScoreRing";
import { cn } from "@/lib/utils/cn";
import { releaseLabel } from "@/lib/utils/format";
import type { GameSummary } from "@/lib/games/types";

export type ChartId = "trending" | "anticipated" | "top";

export interface ChartRow {
  game: GameSummary;
  /** The number behind the rank, when the chart has one. */
  hype?: number;
}

export interface Chart {
  id: ChartId;
  label: string;
  href: string;
  rows: ChartRow[];
}

const PER_COLUMN = 4;
const MAX_ROWS = 12;

export function TopCharts({ charts }: { charts: Chart[] }) {
  const available = charts.filter((chart) => chart.rows.length >= 3);
  const [active, setActive] = useState<ChartId>(available[0]?.id ?? "trending");
  const calm = useCalmMotion();
  const chart = available.find((entry) => entry.id === active) ?? available[0];
  if (!chart) return null;

  const rows = chart.rows.slice(0, MAX_ROWS);
  const columns: { row: ChartRow; rank: number }[][] = [];
  rows.forEach((row, i) => {
    const column = Math.floor(i / PER_COLUMN);
    (columns[column] ??= []).push({ row, rank: i + 1 });
  });

  return (
    <section data-track-src="home:charts" aria-labelledby="home-charts-title" className="py-9 sm:py-12 lg:py-14">
      <Container>
        {/* The segmented control names the chart; the heading names the shelf. */}
        <SectionHeading title={<span id="home-charts-title">Top charts</span>} href={chart.href} />
        {available.length > 1 && (
          <SegmentedControl
            label="Choose a chart"
            className="mt-5 sm:max-w-md"
            segments={available.map((entry) => ({ value: entry.id, label: entry.label }))}
            value={chart.id}
            onChange={setActive}
          />
        )}
      </Container>

      <Container className="mt-5 sm:mt-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={chart.id}
            initial={calm ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={calm ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: calm ? 0.15 : 0.32, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "no-scrollbar -mx-4 flex snap-x snap-mandatory gap-6 overflow-x-auto overscroll-x-contain px-4 scroll-px-4",
              "md:mx-0 md:grid md:grid-cols-3 md:gap-x-6 md:overflow-visible md:px-0 lg:gap-x-10",
            )}
          >
            {columns.map((column, c) => (
              <ol
                key={c}
                start={column[0].rank}
                aria-label={`${chart.label}, ranks ${column[0].rank} to ${column[column.length - 1].rank}`}
                // `relative`: the rows' visually-hidden rank labels are
                // absolutely positioned, and without a containing block in
                // the scroller they escaped it and widened the phone page.
                className="relative w-[84vw] max-w-[420px] shrink-0 snap-start md:w-auto md:max-w-none"
              >
                {column.map(({ row, rank }, r) => (
                  <ChartRowItem key={row.game.id} row={row} rank={rank} last={r === column.length - 1} />
                ))}
              </ol>
            ))}
          </motion.div>
        </AnimatePresence>
      </Container>
    </section>
  );
}

function ChartRowItem({ row, rank, last }: { row: ChartRow; rank: number; last: boolean }) {
  const { game, hype } = row;
  const menuRef = useGameMenuTarget(game);
  const genre = game.genres[0]?.name;
  const release = releaseLabel(game, "");

  return (
    <li ref={menuRef} data-game-menu className="press-menu-target">
      <Link
        href={`/game/${game.slug}`}
        data-menu-preview
        className="group -mx-2 flex min-h-[84px] items-center gap-3 rounded-2xl px-2 transition-colors duration-200 fine:hover:bg-fg/[0.045] coarse:active:bg-fg/[0.06]"
      >
        <span className="relative h-[68px] w-[51px] shrink-0 overflow-hidden rounded-[10px] border border-fg/[0.08] bg-panel shadow-[0_8px_18px_-12px_#000] light:shadow-[0_6px_14px_-10px_#00000059]">
          <GameCover
            name={game.name}
            slug={game.slug}
            image={game.image}
            imageFallback={game.imageFallback}
            width={120}
            sizes="51px"
          />
        </span>
        {/* The separator starts after the art, iOS-list style. */}
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 self-stretch py-2",
            !last && "border-b border-line",
          )}
        >
          <span
            aria-hidden
            className="w-6 shrink-0 text-center font-display text-[17px] font-semibold tabular-nums text-muted"
          >
            {rank}
          </span>
          <span className="min-w-0 flex-1">
            <span className="sr-only">Number {rank}: </span>
            <span className="block truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] transition-colors fine:group-hover:text-brand-soft">
              {game.name}
            </span>
            <span className="mt-1 block truncate text-[13px] text-muted">
              {[genre, release].filter(Boolean).join(" · ") || " "}
            </span>
          </span>
          {hype !== undefined ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-flare/12 px-2 py-[3px] text-[12px] font-semibold tabular-nums text-flare"
              title="Hype index: anticipation from follows, want-to-play lists and page visits (0–100)"
            >
              <Flame size={12} aria-hidden />
              {hype}
              <span className="sr-only"> hype</span>
            </span>
          ) : (
            <ScorePill score={game.metacritic} className="shrink-0" />
          )}
        </span>
      </Link>
    </li>
  );
}

/** Same geometry as the populated chart, so streaming in never shifts the page. */
export function TopChartsSkeleton() {
  return (
    <section aria-hidden className="py-9 sm:py-12 lg:py-14">
      <Container>
        {/* Matches the heading without eyebrow or description. */}
        <div className="skeleton-glass h-8 w-44 rounded-xl" />
        <div className="skeleton-glass mt-5 h-10 w-full max-w-md rounded-full" />
        <div className="mt-6 grid gap-x-10 md:grid-cols-3">
          {[0, 1, 2].map((column) => (
            <div key={column} className={cn(column > 0 && "hidden md:block")}>
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex min-h-[84px] items-center gap-3">
                  <div className="skeleton-glass h-[68px] w-[51px] rounded-[10px]" />
                  <div className="flex-1">
                    <div className="skeleton-glass h-3.5 w-3/4 rounded-full" />
                    <div className="skeleton-glass mt-2 h-3 w-1/2 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
