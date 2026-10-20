"use client";

import { motion, useInView } from "motion/react";
import { useRef, useState } from "react";
import type { FinishHighlight, FinishRates as Rates, FinishRow } from "@/lib/personal/play-insights";
import { MIN_RESOLVED, STALL_DAYS } from "@/lib/personal/play-insights";
import { cn } from "@/lib/utils/cn";
import { DRAW_EASE, drawTransition, Readout, Swatch, formatPercent, useActiveMark, useChartMotion } from "../primitives";
import { shortGenre } from "./GenreRadar";

/** Outcome order is fixed (left to right in every bar) and so is its colour. */
const OUTCOMES = [
  { key: "finished", label: "Finished", color: "var(--viz-3)" },
  { key: "playing", label: "Playing", color: "var(--viz-6)" },
  { key: "stalled", label: "Stalled", color: "var(--viz-2)" },
  { key: "untouched", label: "Not started", color: "var(--viz-other)" },
] as const;

type Dimension = "genres" | "themes" | "platforms";
const DIMENSIONS: Array<{ key: Dimension; label: string }> = [
  { key: "genres", label: "Genre" },
  { key: "themes", label: "Theme" },
  { key: "platforms", label: "Platform" },
];

const label = (row: FinishRow, dimension: Dimension) => (dimension === "genres" ? shortGenre(row.label) : row.label);

/** "You finish 72% of RPGs you start, but only 20% of Open world games." */
export function finishSentence(highlight: FinishHighlight, dimension: Dimension): string {
  const best = label(highlight.best, dimension);
  const worst = label(highlight.worst, dimension);
  const noun = dimension === "platforms" ? "games on" : "";
  const subject = (name: string) => (dimension === "platforms" ? `${noun} ${name}` : `${name} games`);
  return `You finish ${formatPercent(highlight.best.rate!)} of the ${subject(best)} you start, but only ${formatPercent(highlight.worst.rate!)} of ${subject(worst)}.`;
}

/**
 * What you finish, by genre, theme or platform: one 100%-stacked bar per row
 * (finished, playing, stalled, not started) with the finish rate — finished
 * out of the games that reached an outcome — as the row's figure.
 */
export function FinishRates({ rates }: { rates: Rates }) {
  const motionOn = useChartMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { once: true, amount: 0.25 });
  const available = DIMENSIONS.filter((item) => rates[item.key].length > 0);
  const [dimension, setDimension] = useState<Dimension>(available[0]?.key ?? "genres");
  const rows = rates[dimension];
  const highlight = rates.highlight[dimension];
  const { active, markProps } = useActiveMark<string>();
  const selected = rows.find((row) => row.key === active) ?? null;

  return (
    <div ref={rootRef} className="flex flex-1 flex-col gap-4">
      {available.length > 1 && (
        <div role="tablist" aria-label="Group by" className="inline-flex w-fit gap-1 rounded-full bg-fg/[0.06] p-1">
          {available.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={dimension === item.key}
              onClick={() => setDimension(item.key)}
              className={cn(
                "press min-h-9 rounded-full px-3.5 text-[13px] font-semibold transition-colors coarse:min-h-11",
                dimension === item.key ? "bg-fg/[0.14] text-text" : "text-muted fine:hover:text-text",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <Readout>
        {selected ? (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-semibold">{label(selected, dimension)}</p>
              <p className="shrink-0 text-sm">
                {selected.rate !== null ? <span className="font-bold">{formatPercent(selected.rate)} finished</span> : <span className="text-muted">No outcome yet</span>}
              </p>
            </div>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
              {OUTCOMES.map((outcome) => (
                <span key={outcome.key} className="flex items-center gap-1">
                  <Swatch color={outcome.color} className="h-2 w-2" />
                  <span className="font-semibold tabular-nums text-text">{selected[outcome.key]}</span> {outcome.label.toLowerCase()}
                </span>
              ))}
            </p>
          </div>
        ) : highlight ? (
          <p className="text-sm leading-snug text-muted">{finishSentence(highlight, dimension)}</p>
        ) : (
          <p className="text-sm leading-snug text-muted">
            {rates.totals.rate !== null
              ? <>Of the games you&apos;ve started and moved on from, you finished <span className="font-semibold text-text">{formatPercent(rates.totals.rate)}</span>.</>
              : <>Finish or shelve a few games and your rates appear here.</>}
            <span className="block text-xs text-faint">A rate shows once {MIN_RESOLVED} games in a row have an outcome.</span>
          </p>
        )}
      </Readout>

      <ul className="space-y-1">
        {rows.map((row, index) => {
          const on = active === row.key;
          const confident = row.finished + row.stalled >= MIN_RESOLVED;
          return (
            <li key={row.key}>
              <button
                type="button"
                {...markProps(row.key, `${label(row, dimension)}: ${row.finished} finished, ${row.playing} playing, ${row.stalled} stalled, ${row.untouched} not started`)}
                className={cn("press block w-full rounded-xl px-2 py-1.5 text-left transition-colors", on ? "bg-fg/[0.07]" : "fine:hover:bg-fg/[0.03]")}
              >
                <span className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm">
                    {label(row, dimension)} <span className="text-xs text-faint">· {row.total}</span>
                  </span>
                  <span className={cn("shrink-0 text-sm font-semibold tabular-nums", !confident && "font-normal text-faint")}>
                    {row.rate === null ? "—" : formatPercent(row.rate)}
                  </span>
                </span>
                <motion.span
                  className="flex h-2.5 gap-[2px] overflow-hidden rounded-[4px]"
                  style={{ originX: 0 }}
                  initial={{ scaleX: 0 }}
                  animate={inView ? { scaleX: 1 } : undefined}
                  transition={drawTransition(motionOn, { duration: 0.8, delay: motionOn ? index * 0.05 : 0, ease: DRAW_EASE })}
                >
                  {OUTCOMES.map((outcome) =>
                    row[outcome.key] > 0 ? <span key={outcome.key} className="h-full" style={{ flexGrow: row[outcome.key], background: outcome.color }} /> : null,
                  )}
                </motion.span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        {OUTCOMES.map((outcome) => (
          <span key={outcome.key} className="flex items-center gap-1.5"><Swatch color={outcome.color} />{outcome.label}</span>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        Stalled: marked Playing but untouched for {STALL_DAYS} days, or hours logged with no status. The rate is finished out of finished plus stalled.
      </p>

      <div className="sr-only">
        <table>
          <caption>Finish rate by {DIMENSIONS.find((item) => item.key === dimension)?.label.toLowerCase()}</caption>
          <thead><tr><th scope="col">Group</th>{OUTCOMES.map((outcome) => <th key={outcome.key} scope="col">{outcome.label}</th>)}<th scope="col">Finish rate</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {OUTCOMES.map((outcome) => <td key={outcome.key}>{row[outcome.key]}</td>)}
                <td>{row.rate === null ? "none" : formatPercent(row.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
