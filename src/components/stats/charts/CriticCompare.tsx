"use client";

import Link from "next/link";
import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { GameCover } from "@/components/game/GameCover";
import type { CatalogueBenchmark, CriticData, CriticGame } from "@/lib/games/stats";
import { canonicalEntryHref } from "@/lib/notifications/model";
import { CountUp, DRAW_EASE, drawTransition, useChartMotion } from "../primitives";

/**
 * Library average vs. catalogue benchmark on one shared 0–100 axis. Two bars,
 * one scale: the comparison is honest only because neither is re-scaled.
 */
export function CriticCompare({ critic, benchmark }: { critic: CriticData; benchmark: CatalogueBenchmark | null }) {
  const motionOn = useChartMotion();
  // Bars start at zero width, and a zero-area element never counts as "in
  // view", so the draw-in keys off the whole chart instead.
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { once: true, amount: 0.3 });
  const average = critic.average ?? 0;
  const delta = benchmark ? average - benchmark.average : null;
  const rows = [
    { key: "you", label: critic.basis === "owned" ? "Games you own" : "Your library", value: average, color: "var(--viz-1)", note: `${critic.scored} scored ${critic.scored === 1 ? "game" : "games"}` },
    ...(benchmark ? [{ key: "catalogue", label: "Catalogue benchmark", value: benchmark.average, color: "var(--viz-other)", note: `${benchmark.sample} most-rated scored games` }] : []),
  ];

  return (
    <div ref={rootRef} className="flex flex-1 flex-col gap-5">
      <div className="flex items-end gap-3">
        <CountUp value={average} className="font-display text-5xl font-bold leading-none" />
        <div className="pb-1 text-xs leading-snug text-muted">
          average critic score
          {delta !== null && (
            <span className="block font-semibold text-text">
              {delta === 0 ? "level with" : `${Math.abs(delta)} ${delta > 0 ? "above" : "below"}`} the benchmark
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={row.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
              <span className="font-semibold">{row.label}</span>
              <span><span className="font-bold tabular-nums">{row.value}</span><span className="text-faint"> / 100</span></span>
            </div>
            <div className="relative h-3 rounded-[4px] bg-fg/[0.05]">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-[4px]"
                style={{ background: row.color, width: `${row.value}%`, originX: 0 }}
                initial={{ scaleX: 0 }}
                animate={inView ? { scaleX: 1 } : undefined}
                transition={drawTransition(motionOn, { duration: 0.9, delay: motionOn ? index * 0.12 : 0, ease: DRAW_EASE })}
              />
            </div>
            <p className="mt-1 text-[10px] text-faint">{row.note}</p>
          </div>
        ))}
        <div className="flex justify-between text-[10px] tabular-nums text-faint" aria-hidden><span>0</span><span>50</span><span>100</span></div>
      </div>

      {(critic.highest || critic.lowest) && (
        <div className="mt-auto grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 lg:grid-cols-1">
          {critic.highest && <ScoredGame game={critic.highest} tag="Highest rated" />}
          {critic.lowest && <ScoredGame game={critic.lowest} tag="Lowest rated" />}
        </div>
      )}
    </div>
  );
}

function ScoredGame({ game, tag }: { game: CriticGame; tag: string }) {
  return (
    <Link href={canonicalEntryHref(game)} className="press group flex min-w-0 items-center gap-3 rounded-2xl bg-fg/[0.04] p-2 pr-3 transition-colors hover:bg-fg/[0.07]">
      <span className="relative aspect-[3/4] w-10 shrink-0 overflow-hidden rounded-lg">
        <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={80} sizes="40px" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">{tag}</span>
        <span className="block truncate text-sm font-semibold">{game.name}</span>
      </span>
      <span className="font-display text-lg font-bold tabular-nums">{game.score}</span>
    </Link>
  );
}
