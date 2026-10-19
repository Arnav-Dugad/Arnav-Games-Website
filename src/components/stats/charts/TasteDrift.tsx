"use client";

import { motion, useInView } from "motion/react";
import { useId, useRef, type PointerEvent } from "react";
import type { DriftBucket, SliceDatum } from "@/lib/games/stats";
import { DRAW_EASE, drawTransition, Readout, Swatch, formatPercent, seriesColor, useActiveMark, useChartMotion, useElementWidth } from "../primitives";
import { shortGenre } from "./GenreRadar";

const HEIGHT = 190;
const AXIS = 22;

/**
 * Monotone cubic interpolation (Fritsch–Carlson). Unlike a Catmull-Rom curve
 * it never overshoots between points, so a share can't visibly dip below 0%
 * or a band appear to cross its neighbour just because the line was smoothed.
 */
function monotonePath(points: Array<[number, number]>): string {
  if (points.length < 2) return "";
  const n = points.length;
  const dx = points.slice(1).map(([x], i) => x - points[i][0]);
  const slope = points.slice(1).map(([, y], i) => (y - points[i][1]) / (dx[i] || 1));
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    if (slope[i - 1] * slope[i] <= 0) return 0;
    const w1 = 2 * dx[i] + dx[i - 1];
    const w2 = dx[i] + 2 * dx[i - 1];
    return (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
  });
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = dx[i] / 3;
    d += ` C${x0 + h},${y0 + tangent[i] * h} ${x1 - h},${y1 - tangent[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

/**
 * Taste drift: a 100%-stacked area of genre share per period. Share rather
 * than count, because the question is "how did the mix change", and raw
 * counts would mostly show how many games were added that year.
 */
export function TasteDrift({ series, buckets }: { series: SliceDatum[]; buckets: DriftBucket[] }) {
  const motionOn = useChartMotion();
  const clipId = useId();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const { active, setActive, clear } = useActiveMark<number>();
  const pinned = useRef(false);
  // The clip rect lives in <defs> and is never itself "in view", so the
  // draw-in keys off the chart container instead.
  const inView = useInView(ref, { once: true, amount: 0.4 });

  const inset = 6;
  const plotWidth = Math.max(0, width - inset * 2);
  const x = (index: number) => inset + (buckets.length === 1 ? plotWidth / 2 : (index / (buckets.length - 1)) * plotWidth);
  const y = (share: number) => HEIGHT - share * HEIGHT;

  // Cumulative boundaries, bottom series first.
  const boundaries: number[][] = [];
  let running = buckets.map(() => 0);
  boundaries.push(running);
  for (const item of series) {
    running = running.map((value, index) => value + (buckets[index].tags ? (buckets[index].counts[item.key] ?? 0) / buckets[index].tags : 0));
    boundaries.push(running);
  }

  const bandPath = (index: number) => {
    const top = boundaries[index + 1].map((share, i) => [x(i), y(share)] as [number, number]);
    const bottom = boundaries[index].map((share, i) => [x(i), y(share)] as [number, number]).reverse();
    return `${monotonePath(top)} L${bottom[0][0]},${bottom[0][1]} ${monotonePath(bottom).replace(/^M[^C]*/, "")} Z`;
  };

  const shown = active ?? buckets.length - 1;
  const bucket = buckets[shown];

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relative = (event.clientX - rect.left - inset) / Math.max(1, plotWidth);
    return Math.max(0, Math.min(buckets.length - 1, Math.round(relative * (buckets.length - 1))));
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Readout>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">{bucket.label}{active === null && <span className="font-normal text-faint"> · latest</span>}</p>
          <p className="text-xs text-muted">{bucket.games} {bucket.games === 1 ? "game" : "games"}</p>
        </div>
        <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {series.map((item, index) => {
            const share = bucket.tags ? (bucket.counts[item.key] ?? 0) / bucket.tags : 0;
            return (
              <li key={item.key} className="flex min-w-0 items-center gap-1.5 text-xs">
                <span aria-hidden className="h-0.5 w-2.5 shrink-0 rounded-full" style={{ background: seriesColor(index, item.key) }} />
                <span className="font-semibold tabular-nums">{formatPercent(share)}</span>
                <span className="min-w-0 truncate text-muted">{shortGenre(item.label)}</span>
              </li>
            );
          })}
        </ul>
      </Readout>

      <div
        ref={ref}
        className="relative touch-pan-y select-none"
        style={{ height: HEIGHT + AXIS }}
        onPointerMove={(event) => {
          if (!pinned.current) setActive(pick(event));
        }}
        onPointerDown={(event) => {
          // A tap pins the crosshair so it survives the finger lifting.
          if (event.pointerType !== "mouse") {
            pinned.current = true;
            setActive(pick(event));
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") {
            pinned.current = false;
            clear();
          }
        }}
        aria-hidden
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} className="block overflow-visible">
            <defs>
              <clipPath id={clipId}>
                <motion.rect
                  x={0}
                  y={-4}
                  height={HEIGHT + 8}
                  initial={{ width: 0 }}
                  animate={{ width: inView || !motionOn ? width : 0 }}
                  transition={drawTransition(motionOn, { duration: 1.2, ease: DRAW_EASE })}
                />
              </clipPath>
            </defs>
            {[0.25, 0.5, 0.75].map((share) => (
              <line key={share} x1={0} x2={width} y1={y(share)} y2={y(share)} stroke="var(--color-line)" strokeWidth={1} />
            ))}
            <g clipPath={`url(#${clipId})`}>
              {series.map((item, index) => (
                <path key={item.key} d={bandPath(index)} fill={seriesColor(index, item.key)} fillOpacity={0.88} />
              ))}
              {/* The 2px surface gap between bands, drawn as the boundary line. */}
              {boundaries.slice(1, -1).map((boundary, index) => (
                <path
                  key={index}
                  d={monotonePath(boundary.map((share, i) => [x(i), y(share)]))}
                  fill="none"
                  stroke="var(--viz-surface)"
                  strokeWidth={2}
                />
              ))}
            </g>
            {active !== null && (
              <g>
                <line x1={x(active)} x2={x(active)} y1={0} y2={HEIGHT} stroke="var(--color-text)" strokeOpacity={0.85} strokeWidth={1} />
                {boundaries.slice(1).map((boundary, index) => (
                  <circle key={index} cx={x(active)} cy={y(boundary[active])} r={3.5} fill="var(--color-text)" stroke="var(--viz-surface)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        <div className="absolute inset-x-0 bottom-0 h-[22px]">
          {buckets.map((item, index) => {
            // Thin the axis on narrow cards: first, last and evenly spaced between.
            const every = Math.ceil(buckets.length / Math.max(2, Math.floor(width / 64)));
            const show = index === 0 || index === buckets.length - 1 || (index % every === 0 && buckets.length - 1 - index >= every / 2);
            if (!show && active !== index) return null;
            return (
              <span
                key={item.key}
                className={`absolute top-1.5 whitespace-nowrap text-[10px] tabular-nums ${active === index ? "font-semibold text-text" : "text-faint"}`}
                style={{
                  left: x(index),
                  transform: index === 0 ? "none" : index === buckets.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {item.label}
              </span>
            );
          })}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legend">
        {series.map((item, index) => (
          <li key={item.key} className="flex items-center gap-1.5 text-xs text-muted">
            <Swatch color={seriesColor(index, item.key)} />
            {item.label}
          </li>
        ))}
      </ul>

      {/* Tables ignore sr-only's 1px box, so a div does the hiding. */}
      <div className="sr-only">
        <table>
          <caption>Share of genre tags per period</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Games</th>
              {series.map((item) => <th key={item.key} scope="col">{item.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {buckets.map((item) => (
              <tr key={item.key}>
                <th scope="row">{item.label}</th>
                <td>{item.games}</td>
                {series.map((s) => <td key={s.key}>{formatPercent(item.tags ? (item.counts[s.key] ?? 0) / item.tags : 0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
