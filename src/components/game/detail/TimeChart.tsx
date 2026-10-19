"use client";

/**
 * A single-series time chart in inline SVG — price history (as a step line:
 * a price holds until it changes) and player counts (as a line).
 *
 * Hand-rolled rather than a chart library because the Worker bundle is
 * shared and tight, and both charts need the same handful of things:
 *
 *  - Measured width (ResizeObserver), so strokes and labels stay crisp at
 *    every size instead of being scaled by a viewBox.
 *  - A crosshair that snaps to the nearest sample. The pointer layer uses
 *    `touch-action: pan-y`, so on a phone a horizontal scrub reads values
 *    while a vertical swipe still scrolls the page.
 *  - Keyboard: focus the chart, then ←/→ (Home/End) step through samples;
 *    the readout is mirrored into a polite live region.
 *  - Dense series (90 days of hourly samples) are thinned to about one
 *    sample per pixel by keeping each bucket's *peak* sample — the shape a
 *    reader cares about — and the tooltip still shows that real sample.
 *
 * Styling follows the dataviz rules: one hue (the game's accent), a 2px
 * line, a ~10% wash, hairline gridlines, labels in text tokens, a 0 baseline
 * so differences are never exaggerated.
 */

import { motion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";

export interface ChartPoint {
  /** Milliseconds since epoch. */
  t: number;
  v: number;
}

export interface TimeChartProps {
  points: ChartPoint[];
  /** Draw as a step line (value holds until the next sample). */
  step?: boolean;
  /** Carry the last value forward to this time (a price still in effect today). */
  extendTo?: number;
  height?: number;
  formatValue: (value: number) => string;
  /** Compact form for the y-axis; defaults to `formatValue`. */
  formatTick?: (value: number) => string;
  formatTime: (t: number) => string;
  formatAxisTime: (t: number) => string;
  /** A labelled point worth calling out (e.g. the lowest price). */
  marker?: { t: number; v: number; label: string } | null;
  /** Accessible name, e.g. "Steam price history". */
  label: string;
  /** One-sentence text alternative for the whole chart. */
  summary: string;
  className?: string;
}

const PAD = { top: 16, right: 52, bottom: 26, left: 2 };

function niceStep(max: number, ticks: number): number {
  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return nice * power;
}

/** Keeps the highest sample in each pixel-wide bucket. */
function thin(points: ChartPoint[], buckets: number): ChartPoint[] {
  if (points.length <= buckets * 1.2 || buckets < 2) return points;
  const first = points[0].t;
  const span = points[points.length - 1].t - first || 1;
  const out: ChartPoint[] = [];
  let bucket = -1;
  for (const point of points) {
    const index = Math.min(buckets - 1, Math.floor(((point.t - first) / span) * buckets));
    if (index !== bucket) {
      out.push(point);
      bucket = index;
    } else if (point.v > out[out.length - 1].v) {
      out[out.length - 1] = point;
    }
  }
  // Always end on the real latest sample, peak or not: "now" must be now.
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out[out.length - 1] = last;
  return out;
}

function nearest(points: ChartPoint[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].t - t) <= Math.abs(points[hi].t - t) ? lo : hi;
}

export function TimeChart({
  points: input,
  step = false,
  extendTo,
  height = 220,
  formatValue,
  formatTick = formatValue,
  formatTime,
  formatAxisTime,
  marker,
  label,
  summary,
  className,
}: TimeChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const calm = useCalmMotion();
  const gradientId = useId().replace(/:/g, "");
  const descriptionId = `${gradientId}-desc`;

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = height - PAD.top - PAD.bottom;

  const points = useMemo(() => thin(input, Math.max(2, Math.floor(plotWidth))), [input, plotWidth]);

  const geometry = useMemo(() => {
    if (points.length === 0 || plotWidth <= 0) return null;
    const t0 = points[0].t;
    const t1 = Math.max(extendTo ?? 0, points[points.length - 1].t);
    const span = t1 - t0 || 1;
    const maxV = Math.max(...points.map((point) => point.v), marker?.v ?? 0) || 1;
    const stepSize = niceStep(maxV, 3);
    const yMax = Math.ceil((maxV * 1.08) / stepSize) * stepSize;
    const x = (t: number) => PAD.left + (span === 1 && points.length === 1 ? plotWidth : ((t - t0) / span) * plotWidth);
    const y = (v: number) => PAD.top + plotHeight - (v / yMax) * plotHeight;

    let line = "";
    points.forEach((point, index) => {
      const px = x(point.t).toFixed(1);
      const py = y(point.v).toFixed(1);
      if (index === 0) line = `M${px},${py}`;
      else line += step ? `H${px}V${py}` : `L${px},${py}`;
    });
    const endX = x(t1);
    if (endX > x(points[points.length - 1].t) + 0.5) line += `H${endX.toFixed(1)}`;
    // A lone sample still draws as a level line across the plot.
    if (points.length === 1) line = `M${PAD.left},${y(points[0].v).toFixed(1)}H${(PAD.left + plotWidth).toFixed(1)}`;
    const baseline = (PAD.top + plotHeight).toFixed(1);
    const startX = points.length === 1 ? PAD.left : x(t0);
    const lastX = points.length === 1 ? PAD.left + plotWidth : Math.max(endX, x(points[points.length - 1].t));
    const area = `${line}V${baseline}H${startX.toFixed(1)}Z`;

    const yTicks = Array.from({ length: Math.round(yMax / stepSize) + 1 }, (_, index) => index * stepSize);
    const xCount = Math.max(2, Math.min(5, Math.floor(plotWidth / 120)));
    const xTicks = span > 1 ? Array.from({ length: xCount }, (_, index) => t0 + (span * index) / (xCount - 1)) : [t0];

    return { x, y, line, area, yTicks, xTicks, lastX, t0, t1 };
  }, [points, plotWidth, plotHeight, extendTo, step, marker]);

  const pick = useCallback(
    (event: PointerEvent<SVGRectElement>) => {
      if (!geometry || points.length === 0) return;
      const box = event.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      const t = geometry.t0 + ratio * (geometry.t1 - geometry.t0);
      const index = nearest(points, t);
      setActive((current) => {
        if (current !== index && event.pointerType === "touch") haptic("selection");
        return index;
      });
    },
    [geometry, points],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    const current = active ?? points.length - 1;
    const keys: Record<string, number> = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowRight: Math.min(points.length - 1, current + 1),
      Home: 0,
      End: points.length - 1,
    };
    if (event.key in keys) {
      event.preventDefault();
      setActive(keys[event.key]);
    }
  };

  const activePoint = active !== null ? points[active] : null;
  const readout = activePoint ? `${formatValue(activePoint.v)} · ${formatTime(activePoint.t)}` : "";
  const lastPoint = points[points.length - 1];

  return (
    <div className={cn("relative", className)}>
      <div
        ref={wrapRef}
        role="img"
        tabIndex={0}
        aria-label={label}
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((current) => current ?? (points.length ? points.length - 1 : null))}
        onBlur={() => setActive(null)}
        className="relative rounded-xl outline-offset-4"
        style={{ height }}
      >
        {geometry && (
          <svg width={width} height={height} className="block overflow-visible" aria-hidden>
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--game-accent, var(--color-brand))" stopOpacity="0.2" />
                <stop offset="100%" stopColor="var(--game-accent, var(--color-brand))" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {geometry.yTicks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotWidth}
                  y1={geometry.y(tick)}
                  y2={geometry.y(tick)}
                  stroke="var(--color-line)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={width - 2}
                  y={geometry.y(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-faint text-[11px] tabular-nums"
                >
                  {formatTick(tick)}
                </text>
              </g>
            ))}
            {geometry.xTicks.map((tick, index) => (
              <text
                key={tick}
                x={geometry.x(tick)}
                y={height - 6}
                textAnchor={index === 0 ? "start" : index === geometry.xTicks.length - 1 ? "end" : "middle"}
                className="fill-faint text-[11px]"
              >
                {formatAxisTime(tick)}
              </text>
            ))}

            <path d={geometry.area} fill={`url(#${gradientId})`} />
            <motion.path
              d={geometry.line}
              fill="none"
              stroke="var(--game-accent, var(--color-brand))"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              // Drawn once, when the chart first scrolls into view.
              initial={calm ? false : { pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            />

            {marker && (
              <g>
                <circle
                  cx={geometry.x(marker.t)}
                  cy={geometry.y(marker.v)}
                  r={4.5}
                  fill="var(--color-mint)"
                  stroke="var(--color-panel)"
                  strokeWidth={2}
                />
                <text
                  x={Math.min(Math.max(geometry.x(marker.t), 40), PAD.left + plotWidth - 40)}
                  y={Math.min(geometry.y(marker.v) + 18, PAD.top + plotHeight - 4)}
                  textAnchor="middle"
                  className="fill-muted text-[11px] font-semibold"
                >
                  {marker.label}
                </text>
              </g>
            )}

            {lastPoint && !activePoint && (
              <circle
                cx={geometry.lastX}
                cy={geometry.y(lastPoint.v)}
                r={4}
                fill="var(--game-accent, var(--color-brand))"
                stroke="var(--color-panel)"
                strokeWidth={2}
              />
            )}

            {activePoint && (
              <g>
                <line
                  x1={geometry.x(activePoint.t)}
                  x2={geometry.x(activePoint.t)}
                  y1={PAD.top - 4}
                  y2={PAD.top + plotHeight}
                  stroke="var(--color-line-strong)"
                  strokeWidth={1}
                />
                <circle
                  cx={geometry.x(activePoint.t)}
                  cy={geometry.y(activePoint.v)}
                  r={5}
                  fill="var(--game-accent, var(--color-brand))"
                  stroke="var(--color-panel)"
                  strokeWidth={2}
                />
              </g>
            )}

            {/* Pointer layer: bigger than the marks, so the reader aims at a date, not a 2px line. */}
            <rect
              x={PAD.left}
              y={0}
              width={plotWidth}
              height={height}
              fill="transparent"
              style={{ touchAction: "pan-y" }}
              onPointerMove={pick}
              onPointerDown={pick}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        )}

        {activePoint && geometry && (
          <div
            aria-hidden
            className="material pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-xl px-2.5 py-1.5 text-center shadow-lg"
            style={{ left: Math.min(Math.max(geometry.x(activePoint.t), 64), Math.max(64, width - 64)) }}
          >
            <p className="text-[13px] font-semibold tabular-nums text-text">{formatValue(activePoint.v)}</p>
            <p className="text-[11px] text-muted">{formatTime(activePoint.t)}</p>
          </div>
        )}
      </div>
      <p id={descriptionId} className="sr-only">
        {summary}
      </p>
      <p className="sr-only" aria-live="polite">
        {readout}
      </p>
    </div>
  );
}
