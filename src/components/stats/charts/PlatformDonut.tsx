"use client";

import { motion } from "motion/react";
import type { SliceDatum } from "@/lib/games/stats";
import { cn } from "@/lib/utils/cn";
import { CountUp, DRAW_EASE, drawTransition, Swatch, formatPercent, seriesColor, useActiveMark, useChartMotion } from "../primitives";

const SIZE = 200;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2 - 4;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The 2px surface gap between segments, as arc length. */
const GAP = 2.5;

/**
 * Owned copies by platform. A donut is right here only because it is a
 * part-to-whole of at most six slices (the tail folds into "other") — the
 * legend beside it carries every exact value, so no one has to judge angles.
 */
export function PlatformDonut({ slices, ownedGames }: { slices: SliceDatum[]; ownedGames: number }) {
  const motionOn = useChartMotion();
  const { active, markProps } = useActiveMark<string>();
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const selected = slices.find((slice) => slice.key === active) ?? null;

  const arcs = slices.map((slice, index) => {
    const start = slices.slice(0, index).reduce((sum, item) => sum + (item.value / total) * CIRCUMFERENCE, 0);
    const length = (slice.value / total) * CIRCUMFERENCE;
    return { slice, index, start, length: Math.max(0.5, length - (slices.length > 1 ? GAP : 0)) };
  });

  return (
    <div className="flex flex-1 flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative w-full max-w-[200px] shrink-0">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block w-full -rotate-90" aria-hidden>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--color-line)" strokeWidth={STROKE} />
          {arcs.map(({ slice, index, start, length }) => (
            <motion.circle
              key={slice.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={seriesColor(index, slice.key)}
              strokeWidth={active === slice.key ? STROKE + 6 : STROKE}
              strokeDashoffset={-start}
              initial={{ strokeDasharray: `0 ${CIRCUMFERENCE}` }}
              whileInView={{ strokeDasharray: `${length} ${CIRCUMFERENCE}` }}
              viewport={{ once: true, amount: 0.5 }}
              transition={drawTransition(motionOn, { duration: 0.9, delay: motionOn ? 0.08 * index : 0, ease: DRAW_EASE })}
              style={{ transition: "stroke-width 160ms ease" }}
              opacity={active && active !== slice.key ? 0.45 : 1}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {selected ? (
            <>
              <span className="font-display text-3xl font-bold">{selected.value}</span>
              <span className="mt-0.5 max-w-[7rem] text-[11px] leading-tight text-muted">{selected.label}</span>
              <span className="text-[11px] font-semibold text-faint">{formatPercent(selected.value / total)}</span>
            </>
          ) : (
            <>
              <CountUp value={total} className="font-display text-3xl font-bold" />
              <span className="mt-0.5 text-[11px] leading-tight text-muted">{total === 1 ? "owned copy" : "owned copies"}</span>
              <span className="text-[11px] text-faint">{ownedGames} unique {ownedGames === 1 ? "game" : "games"}</span>
            </>
          )}
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-1 sm:max-w-sm">
        {slices.map((slice, index) => (
          <li key={slice.key}>
            <button
              type="button"
              {...markProps(slice.key, `${slice.label}: ${slice.value} copies`)}
              className={cn(
                "press flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                active === slice.key ? "bg-fg/[0.08]" : "hover:bg-fg/[0.04]",
              )}
            >
              <Swatch color={seriesColor(index, slice.key)} />
              <span className="min-w-0 flex-1 truncate text-sm">{slice.label}</span>
              <span className="text-sm font-semibold tabular-nums">{slice.value}</span>
              <span className="w-9 text-right text-xs tabular-nums text-faint">{formatPercent(slice.value / total)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
