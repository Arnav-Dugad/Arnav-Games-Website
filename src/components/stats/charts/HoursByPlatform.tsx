"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";
import type { PlatformHours } from "@/lib/games/stats";
import { cn } from "@/lib/utils/cn";
import { DRAW_EASE, drawTransition, Readout, Swatch, formatHours, useActiveMark, useChartMotion } from "../primitives";

const FINISHED = "var(--viz-1)";
const IN_PROGRESS = "var(--viz-6)";

/**
 * Estimated hours per platform, split into finished games (full IGDB
 * "normally" time) and games in progress (half of it). Horizontal bars,
 * because platform names are long and read best left-aligned.
 */
export function HoursByPlatform({ rows }: { rows: PlatformHours[] }) {
  const motionOn = useChartMotion();
  // Bars start at zero width, and a zero-area element never counts as "in
  // view", so the draw-in keys off the whole chart instead.
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { once: true, amount: 0.3 });
  const { active, markProps } = useActiveMark<string>();
  const max = Math.max(1, ...rows.map((row) => row.finished + row.inProgress));
  const selected = rows.find((row) => row.key === active) ?? null;
  const visible = rows.slice(0, 6);

  return (
    <div ref={rootRef} className="flex flex-1 flex-col gap-4">
      <Readout>
        {selected ? (
          <div>
            <p className="truncate text-sm font-semibold">{selected.label}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-muted">
              <span className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-2.5 rounded-full" style={{ background: FINISHED }} /><span className="font-semibold text-text">{formatHours(selected.finished)}</span> finished</span>
              <span className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-2.5 rounded-full" style={{ background: IN_PROGRESS }} /><span className="font-semibold text-text">{formatHours(selected.inProgress)}</span> in progress</span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Most of your time goes to <span className="font-semibold text-text">{rows[0].label}</span>: about {formatHours(rows[0].finished + rows[0].inProgress)}.
          </p>
        )}
      </Readout>

      <ul className="space-y-1">
        {visible.map((row, index) => {
          const total = row.finished + row.inProgress;
          const on = active === row.key;
          return (
            <li key={row.key}>
              <button
                type="button"
                {...markProps(row.key, `${row.label}: about ${total} hours`)}
                className={cn("press block w-full rounded-xl px-2 py-1.5 text-left transition-colors", on ? "bg-fg/[0.07]" : "hover:bg-fg/[0.03]")}
              >
                <span className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm">{row.label}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{formatHours(total)}</span>
                </span>
                <motion.span
                  className="flex h-2.5 gap-[2px] overflow-hidden rounded-r-[4px]"
                  style={{ width: `${(total / max) * 100}%`, originX: 0 }}
                  initial={{ scaleX: 0 }}
                  animate={inView ? { scaleX: 1 } : undefined}
                  transition={drawTransition(motionOn, { duration: 0.8, delay: motionOn ? index * 0.06 : 0, ease: DRAW_EASE })}
                >
                  {row.finished > 0 && <span className="h-full" style={{ flexGrow: row.finished, background: FINISHED }} />}
                  {row.inProgress > 0 && <span className="h-full" style={{ flexGrow: row.inProgress, background: IN_PROGRESS }} />}
                </motion.span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > visible.length && <p className="text-[11px] text-faint">+{rows.length - visible.length} more platforms with fewer hours.</p>}

      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        <span className="flex items-center gap-1.5"><Swatch color={FINISHED} />Finished games</span>
        <span className="flex items-center gap-1.5"><Swatch color={IN_PROGRESS} />In progress (half)</span>
      </div>

      {/* Tables ignore sr-only's 1px box, so a div does the hiding. */}
      <div className="sr-only">
        <table>
          <caption>Estimated hours by platform</caption>
          <thead><tr><th scope="col">Platform</th><th scope="col">Finished, hours</th><th scope="col">In progress, hours</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td>{row.finished}</td><td>{row.inProgress}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
