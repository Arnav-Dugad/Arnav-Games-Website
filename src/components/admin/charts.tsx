"use client";

/**
 * Dependency-free chart primitives for the admin dashboard.
 *
 * Inline SVG only — a chart library would outweigh the whole dashboard. The
 * specs follow one system: 2px lines, a ~10% area wash, hairline solid grid,
 * 4px rounded bar ends, 8px markers with a 2px surface ring, and text that
 * always wears text tokens (never a series colour).
 */

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { usePreferences } from "@/lib/preferences/PreferencesProvider";
import { cn } from "@/lib/utils/cn";

/* ---------------------------------------------------------------------------
 * Shared helpers
 * ------------------------------------------------------------------------ */

/** OS reduced-motion *or* the in-app opt-out from Settings. */
export function useChartMotion(): boolean {
  const reduced = useReducedMotion();
  const { reduceMotion } = usePreferences();
  return !reduced && !reduceMotion;
}

const EASE = [0.16, 1, 0.3, 1] as const;

const fullFormat = new Intl.NumberFormat("en");
const compactFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 1,284 below ten thousand; 12.9K above. */
export function formatCount(value: number): string {
  return Math.abs(value) < 10_000 ? fullFormat.format(Math.round(value)) : compactFormat.format(value);
}

/** Rounds an axis maximum up to a clean 1/2/5 × 10ⁿ step. */
function niceMax(value: number, ticks = 4): { max: number; step: number } {
  if (value <= 0) return { max: ticks, step: 1 };
  const rough = value / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  const step = Math.max(1, nice * magnitude);
  return { max: step * Math.ceil(value / step), step };
}

/** Tracks an element's content width so the SVG can draw at true pixels
 *  (no viewBox stretching, so 2px lines stay 2px at every size). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/* ---------------------------------------------------------------------------
 * Sparkline
 * ------------------------------------------------------------------------ */

/**
 * KPI trend. Drawn in a recessive tone with the latest point in the accent,
 * per the stat-tile contract: the number is the headline, the line is context.
 */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const height = 32;
  const pad = 4;
  const max = Math.max(0, ...values);
  const points = useMemo(() => {
    if (width === 0 || values.length < 2) return [];
    const step = (width - pad * 2) / (values.length - 1);
    return values.map((v, i) => [
      pad + i * step,
      max === 0 ? height - pad : height - pad - (v / max) * (height - pad * 2),
    ] as const);
  }, [values, width, max]);

  const last = points[points.length - 1];
  return (
    <div ref={ref} className={cn("h-8 w-full", className)} aria-hidden>
      {points.length > 1 && (
        <svg width={width} height={height} className="block overflow-visible">
          <polyline
            points={points.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="text-faint"
          />
          {last && (
            <circle cx={last[0]} cy={last[1]} r={3} className="fill-brand stroke-panel" strokeWidth={2} />
          )}
        </svg>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Trend chart (area + crosshair tooltip)
 * ------------------------------------------------------------------------ */

export interface TrendPoint {
  t: number;
  value: number;
  /** Extra rows for the tooltip (value first, label second). */
  details?: { label: string; value: number }[];
}

export function TrendChart({
  points,
  label,
  formatTick,
  formatTooltipTime,
  className,
}: {
  points: TrendPoint[];
  /** Series name, used in the tooltip and the accessible summary. */
  label: string;
  formatTick: (t: number) => string;
  formatTooltipTime: (t: number) => string;
  className?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const animate = useChartMotion();
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);

  const height = width < 520 ? 190 : 240;
  const margin = { top: 12, right: 12, bottom: 26, left: 40 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;

  const { max, step } = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const x = useCallback(
    (i: number) => margin.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW),
    [innerW, points.length, margin.left],
  );
  const y = (v: number) => margin.top + innerH - (v / max) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const areaPath = points.length
    ? `${linePath}L${x(points.length - 1).toFixed(1)},${margin.top + innerH}L${x(0).toFixed(1)},${margin.top + innerH}Z`
    : "";

  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);

  // ~5 x labels whatever the density; always include the last bucket.
  const labelEvery = Math.max(1, Math.ceil(points.length / (width < 520 ? 4 : 7)));
  const xLabels = points
    .map((p, i) => ({ i, t: p.t }))
    .filter(({ i }) => (i % labelEvery === 0 && points.length - 1 - i >= labelEvery / 2) || i === points.length - 1);

  const indexFromPointer = (event: PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const rel = (event.clientX - rect.left) / Math.max(1, rect.width);
    return Math.round(Math.min(1, Math.max(0, rel)) * (points.length - 1));
  };

  const onKeyDown = (event: KeyboardEvent<SVGRectElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    setActive((current) => {
      const last = points.length - 1;
      if (event.key === "Home") return 0;
      if (event.key === "End") return last;
      const base = current ?? last;
      return Math.min(last, Math.max(0, base + (event.key === "ArrowRight" ? 1 : -1)));
    });
  };

  const activePoint = active !== null ? points[active] : null;
  const total = points.reduce((sum, p) => sum + p.value, 0);
  // Re-key the draw-in on data identity so a range switch draws afresh.
  const drawKey = `${points.length}-${points[0]?.t ?? 0}-${total}`;

  return (
    <div ref={ref} className={cn("relative w-full select-none", className)} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={`${label}: ${formatCount(total)} total across ${points.length} periods`}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {/* Grid + y ticks */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={margin.left + innerW}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-fg/[0.08]"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={margin.left - 8}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-faint text-[11px] tabular-nums"
              >
                {formatCount(tick)}
              </text>
            </g>
          ))}

          {/* X labels */}
          {xLabels.map(({ i, t }) => (
            <text
              key={t}
              x={x(i)}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              className="fill-faint text-[11px]"
            >
              {formatTick(t)}
            </text>
          ))}

          {/* Area + line */}
          <motion.path
            key={`a-${drawKey}`}
            d={areaPath}
            fill={`url(#${gradientId})`}
            initial={animate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.25, ease: EASE }}
          />
          <motion.path
            key={`l-${drawKey}`}
            d={linePath}
            fill="none"
            className="stroke-brand"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={animate ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: EASE }}
          />

          {/* Crosshair */}
          {activePoint && active !== null && (
            <g pointerEvents="none">
              <line
                x1={x(active)}
                x2={x(active)}
                y1={margin.top}
                y2={margin.top + innerH}
                className="stroke-fg/25"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <circle cx={x(active)} cy={y(activePoint.value)} r={4.5} className="fill-brand stroke-panel" strokeWidth={2} />
            </g>
          )}

          {/* Hit layer: the whole plot, so the pointer only has to find the X. */}
          <rect
            x={margin.left}
            y={margin.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            tabIndex={0}
            role="slider"
            aria-label={`${label} by period. Use arrow keys to inspect values.`}
            aria-valuemin={0}
            aria-valuemax={Math.max(0, points.length - 1)}
            aria-valuenow={active ?? points.length - 1}
            aria-valuetext={
              activePoint
                ? `${formatTooltipTime(activePoint.t)}: ${formatCount(activePoint.value)} ${label.toLowerCase()}`
                : undefined
            }
            className="cursor-crosshair outline-none [touch-action:pan-y]"
            onPointerMove={(event) => setActive(indexFromPointer(event))}
            onPointerDown={(event) => setActive(indexFromPointer(event))}
            onPointerLeave={(event) => {
              // Touch lifts end the hover; keep the readout so a tap "sticks".
              if (event.pointerType === "mouse") setActive(null);
            }}
            onFocus={() => setActive((current) => current ?? points.length - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={onKeyDown}
          />
        </svg>
      )}

      {activePoint && active !== null && (
        <Tooltip
          x={x(active)}
          width={width}
          time={formatTooltipTime(activePoint.t)}
          rows={[{ label, value: activePoint.value, key: true }, ...(activePoint.details ?? [])]}
        />
      )}
    </div>
  );
}

function Tooltip({
  x,
  width,
  time,
  rows,
}: {
  x: number;
  width: number;
  time: string;
  rows: { label: string; value: number; key?: boolean }[];
}) {
  const tooltipWidth = 176;
  const left = Math.min(Math.max(0, x - tooltipWidth / 2), Math.max(0, width - tooltipWidth));
  return (
    <div
      role="status"
      aria-live="polite"
      className="material pointer-events-none absolute top-0 z-10 rounded-2xl px-3.5 py-2.5 text-[12px]"
      style={{ left, width: tooltipWidth }}
    >
      <p className="text-faint">{time}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            {/* Line key, not a box: tooltip density wants the lightest ink. */}
            <span aria-hidden className={cn("h-0.5 w-3 shrink-0 rounded-full", row.key ? "bg-brand" : "bg-transparent")} />
            <span className="font-semibold tabular-nums text-text">{formatCount(row.value)}</span>
            <span className="truncate text-muted">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Bar list (ranked categories)
 * ------------------------------------------------------------------------ */

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  /** Secondary text after the value, e.g. "3 follows". */
  meta?: string;
  href?: string;
  title?: string;
}

/**
 * Ranked list with a thin magnitude bar under each label. One series, so one
 * colour for every bar — a value ramp here would just restate the length.
 */
export function BarList({ items, className }: { items: BarItem[]; className?: string }) {
  const animate = useChartMotion();
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ol className={cn("space-y-3", className)}>
      {items.map((item, index) => {
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-text">{item.label}</span>
              <span className="shrink-0 tabular-nums text-muted">
                <span className="font-semibold text-text">{formatCount(item.value)}</span>
                {item.meta && <span className="ml-1.5 text-faint">{item.meta}</span>}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-fg/[0.06]">
              <motion.div
                className="h-full rounded-full bg-brand"
                initial={animate ? { width: 0 } : false}
                animate={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
                transition={{ duration: 0.7, delay: animate ? index * 0.03 : 0, ease: EASE }}
              />
            </div>
          </>
        );
        return (
          <li key={item.key} title={item.title}>
            {item.href ? (
              <a href={item.href} className="block rounded-lg outline-offset-4 transition-opacity fine:hover:opacity-80">
                {content}
              </a>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------------------
 * Segmented (part-to-whole) bar
 * ------------------------------------------------------------------------ */

export interface Segment {
  key: string;
  label: string;
  value: number;
  /** A CSS colour. */
  color: string;
}

/**
 * Part-to-whole in one bar with 2px surface gaps between segments, plus a
 * legend that carries every label and value (so identity never rests on
 * colour alone, and narrow segments needn't fit inline labels).
 */
export function SegmentedBar({ segments, className }: { segments: Segment[]; className?: string }) {
  const animate = useChartMotion();
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div className={className}>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={segments.map((s) => `${s.label} ${pct(s.value, total)}`).join(", ")}>
        {visible.map((segment) => (
          <motion.div
            key={segment.key}
            title={`${segment.label}: ${formatCount(segment.value)} (${pct(segment.value, total)})`}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ backgroundColor: segment.color }}
            initial={animate ? { flexGrow: 0 } : false}
            animate={{ flexGrow: segment.value }}
            transition={{ duration: 0.8, ease: EASE }}
          />
        ))}
      </div>
      <ul className="mt-4 grid gap-2.5 text-[13px] sm:grid-cols-3">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: segment.color }} />
            <span className="text-muted">{segment.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-text sm:ml-1">{pct(segment.value, total)}</span>
            <span className="tabular-nums text-faint">{formatCount(segment.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function pct(value: number, total: number): string {
  if (total <= 0) return "0%";
  const p = (value / total) * 100;
  return `${p > 0 && p < 1 ? "<1" : Math.round(p)}%`;
}
