"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";
import type { SliceDatum } from "@/lib/games/stats";
import { DRAW_EASE, drawTransition, Readout, useActiveMark, useChartMotion, useElementWidth } from "../primitives";

const PLOT = 140;
const BAR = 24;

/** Rounded data-end, square at the baseline. */
function columnPath(x: number, top: number, width: number, bottom: number): string {
  const r = Math.min(4, (bottom - top) / 2, width / 2);
  return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${bottom} Z`;
}

/** Games per release decade. Single series, so a single colour. */
export function EraHistogram({ eras, total, undated }: { eras: SliceDatum[]; total: number; undated: number }) {
  const motionOn = useChartMotion();
  // Bars start at zero width, and a zero-area element never counts as "in
  // view", so the draw-in keys off the whole chart instead.
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { once: true, amount: 0.3 });
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const { active, markProps } = useActiveMark<string>();
  const max = Math.max(1, ...eras.map((era) => era.value));
  const peak = eras.reduce((best, era) => (era.value > best.value ? era : best), eras[0]);
  const slot = width / Math.max(1, eras.length);
  const barWidth = Math.min(BAR, Math.max(6, slot - 8));
  const selected = eras.find((era) => era.key === active) ?? null;
  const dated = total - undated;

  return (
    <div ref={rootRef} className="flex flex-1 flex-col gap-4">
      <Readout>
        {selected ? (
          <p className="text-sm">
            <span className="font-bold">{selected.value} {selected.value === 1 ? "game" : "games"}</span>
            <span className="text-muted"> from the {selected.label}</span>
            <span className="block text-xs text-faint">{dated ? Math.round((selected.value / dated) * 100) : 0}% of your dated games</span>
          </p>
        ) : (
          <p className="text-sm text-muted">
            Your library peaks in the <span className="font-semibold text-text">{peak.label}</span>, with {peak.value} {peak.value === 1 ? "game" : "games"}.
          </p>
        )}
      </Readout>

      <div ref={ref} className="relative" style={{ height: PLOT + 22 }}>
        {width > 0 && (
          <svg width={width} height={PLOT + 22} className="block overflow-visible" aria-hidden>
            <line x1={0} x2={width} y1={PLOT} y2={PLOT} stroke="var(--color-line-strong)" strokeWidth={1} />
            {eras.map((era, index) => {
              const height = era.value ? Math.max(4, (era.value / max) * (PLOT - 18)) : 0;
              const x = index * slot + (slot - barWidth) / 2;
              const on = active === era.key;
              return (
                <g key={era.key}>
                  {height > 0 && (
                    <motion.path
                      d={columnPath(x, PLOT - height, barWidth, PLOT)}
                      fill="var(--viz-1)"
                      opacity={active && !on ? 0.4 : 1}
                      initial={{ scaleY: 0 }}
                      animate={inView ? { scaleY: 1 } : undefined}
                      transition={drawTransition(motionOn, { duration: 0.7, delay: motionOn ? 0.05 * index : 0, ease: DRAW_EASE })}
                      style={{ originY: 1, transformBox: "fill-box" }}
                    />
                  )}
                  {height > 0 && (
                    <text x={x + barWidth / 2} y={PLOT - height - 6} textAnchor="middle" className="fill-muted text-[10px] font-semibold tabular-nums">
                      {era.value}
                    </text>
                  )}
                  <text x={index * slot + slot / 2} y={PLOT + 15} textAnchor="middle" className={on ? "fill-text text-[10px] font-semibold" : "fill-faint text-[10px]"}>
                    {slot < 44 ? `’${era.label.slice(2)}` : era.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {/* Whole-slot hit targets, far larger than the bars themselves. */}
        <div className="absolute inset-0 flex">
          {eras.map((era) => (
            <button
              key={era.key}
              type="button"
              {...markProps(era.key, `${era.label}: ${era.value} games`)}
              className="h-full flex-1 rounded-lg outline-offset-0"
            />
          ))}
        </div>
      </div>

      {/* Tables ignore sr-only's 1px box, so a div does the hiding. */}
      <div className="sr-only">
        <table>
          <caption>Games by release decade</caption>
          <thead><tr><th scope="col">Decade</th><th scope="col">Games</th></tr></thead>
          <tbody>{eras.map((era) => <tr key={era.key}><th scope="row">{era.label}</th><td>{era.value}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
