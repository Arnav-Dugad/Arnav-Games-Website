"use client";

import Link from "next/link";
import { motion, useInView } from "motion/react";
import { useMemo, useState, type PointerEvent } from "react";
import { GameCover } from "@/components/game/GameCover";
import type { HypePoint, HypeReality } from "@/lib/games/hype-reality";
import { cn } from "@/lib/utils/cn";
import { drawTransition, Readout, Swatch, useChartMotion, useElementWidth, VizStyles } from "../primitives";

const HEIGHT = 260;
const PAD = { left: 30, right: 10, top: 12, bottom: 26 };
/** Diverging by meaning: worse than its hype (orange), better (green), as expected (neutral). */
const TONE = { over: "var(--viz-2)", sleeper: "var(--viz-3)", none: "var(--viz-other)" } as const;

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Pre-release hype (log scale) against the score each game landed at, with
 * the least-squares line for "what this much hype usually brings". The
 * labelled outliers are the point; the cloud is the context.
 */
export function HypeScatter({ data }: { data: HypeReality }) {
  const motionOn = useChartMotion();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const [active, setActive] = useState<number | null>(null);
  const { points, model } = data;

  const scale = useMemo(() => {
    const xs = points.map((point) => point.x);
    const minX = Math.floor(Math.min(...xs) * 2) / 2;
    const maxX = Math.ceil(Math.max(...xs) * 2) / 2;
    const minY = Math.max(0, Math.floor((Math.min(...points.map((point) => point.score)) - 5) / 10) * 10);
    return { minX, maxX: maxX === minX ? minX + 1 : maxX, minY, maxY: 100 };
  }, [points]);
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const px = (x: number) => PAD.left + ((x - scale.minX) / (scale.maxX - scale.minX)) * plotW;
  const py = (score: number) => PAD.top + (1 - (score - scale.minY) / (scale.maxY - scale.minY)) * plotH;
  const labelled = new Set([...data.over, ...data.sleepers].map((point) => point.id));
  const selected = points.find((point) => point.id === active) ?? null;

  const ticks: number[] = [];
  for (let power = Math.ceil(scale.minX); power <= Math.floor(scale.maxX); power++) ticks.push(power);

  const nearest = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    let best: HypePoint | null = null;
    let distance = 28 * 28;
    for (const point of points) {
      const d = (px(point.x) - mx) ** 2 + (py(point.score) - my) ** 2;
      if (d < distance) {
        distance = d;
        best = point;
      }
    }
    return best?.id ?? null;
  };

  return (
    <div className="stats-viz flex flex-col gap-4">
      <VizStyles />
      <Readout>
        {selected ? (
          <div className="flex items-baseline justify-between gap-3">
            <Link href={`/game/${selected.slug}`} className="min-w-0 truncate text-sm font-semibold hover:underline">{selected.name}</Link>
            <p className="shrink-0 text-xs text-muted">
              {compact.format(selected.hypes)} follows · <span className="font-semibold text-text">{Math.round(selected.score)}</span> {selected.scoreKind === "critics" ? "critics" : "players"}
              <span className="text-faint"> (expected {Math.round(selected.expected)})</span>
            </p>
          </div>
        ) : (
          <p className="text-sm leading-snug text-muted">
            {Math.abs(model.r) < 0.3
              ? <>Hype barely predicts quality: across <span className="font-semibold text-text">{model.sample}</span> recent releases the link is weak (r = {model.r.toFixed(2)}).</>
              : model.r > 0
                ? <>More hype does tend to mean a better game here (r = {model.r.toFixed(2)} across <span className="font-semibold text-text">{model.sample}</span> releases) — but not always.</>
                : <>The most hyped games scored <em>worse</em> here (r = {model.r.toFixed(2)} across {model.sample} releases).</>}
          </p>
        )}
      </Readout>

      <div
        ref={ref}
        className="relative touch-pan-y select-none"
        style={{ height: HEIGHT }}
        onPointerMove={(event) => setActive(nearest(event))}
        onPointerDown={(event) => setActive(nearest(event))}
        onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}
        aria-hidden
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} className="block overflow-visible">
            {Array.from({ length: (90 - scale.minY) / 10 + 1 }, (_, index) => scale.minY + index * 10).map((score) => (
              <g key={score}>
                <line x1={PAD.left} x2={width - PAD.right} y1={py(score)} y2={py(score)} stroke="var(--color-line)" />
                <text x={PAD.left - 6} y={py(score) + 3} textAnchor="end" fontSize={10} fill="currentColor" className="text-faint">{score}</text>
              </g>
            ))}
            {ticks.map((power) => (
              <text key={power} x={px(power)} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="currentColor" className="text-faint">{compact.format(10 ** power)}</text>
            ))}
            <motion.line
              x1={px(scale.minX)}
              x2={px(scale.maxX)}
              y1={py(model.intercept + model.slope * scale.minX)}
              y2={py(model.intercept + model.slope * scale.maxX)}
              stroke="var(--color-text)"
              strokeOpacity={0.55}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: inView || !motionOn ? 1 : 0 }}
              transition={drawTransition(motionOn, { duration: 1, delay: 0.3 })}
            />
            {points.map((point, index) => {
              const tone = point.tag ? TONE[point.tag] : TONE.none;
              const on = active === point.id;
              return (
                <motion.circle
                  key={point.id}
                  cx={px(point.x)}
                  cy={py(point.score)}
                  r={on ? 6 : (point.tag ? 4.5 : 3.5) * (width < 480 ? 0.75 : 1)}
                  fill={tone}
                  fillOpacity={point.tag ? 0.95 : 0.5}
                  stroke="var(--viz-surface)"
                  strokeWidth={on ? 2 : 1}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: inView || !motionOn ? 1 : 0 }}
                  transition={drawTransition(motionOn, { duration: 0.4, delay: motionOn ? Math.min(0.8, index * 0.003) : 0 })}
                />
              );
            })}
            {placeLabels(points.filter((point) => labelled.has(point.id)), px, py, width).map(({ point, x, y, anchor }) => (
              <text
                key={`t${point.id}`}
                x={x}
                y={y}
                textAnchor={anchor}
                fontSize={11}
                fontWeight={600}
                fill="currentColor"
                stroke="var(--viz-surface)"
                strokeWidth={3}
                paintOrder="stroke"
                className="text-text"
              >
                {shortName(point.name)}
              </text>
            ))}
          </svg>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        <span className="flex items-center gap-1.5"><Swatch color={TONE.over} className="rounded-full" />Over-hyped</span>
        <span className="flex items-center gap-1.5"><Swatch color={TONE.sleeper} className="rounded-full" />Sleeper hit</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-0 w-4 border-t-[1.5px] border-dashed border-text/60" />What that hype usually scores</span>
      </div>

      {/* `grid-cols-1` is minmax(0, 1fr): an implicit column would grow to the
          longest (truncated) game name and push the page wider than a phone. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OutlierList title="Over-hyped" tone={TONE.over} items={data.over} empty="Nothing fell far short of its hype in this window." />
        <OutlierList title="Sleeper hits" tone={TONE.sleeper} items={data.sleepers} empty="No quiet launch beat expectations by a wide margin." />
      </div>

      <div className="sr-only">
        <table>
          <caption>Pre-release hype against final score, outliers</caption>
          <thead><tr><th scope="col">Game</th><th scope="col">Follows before launch</th><th scope="col">Score</th><th scope="col">Expected</th></tr></thead>
          <tbody>
            {[...data.over, ...data.sleepers].map((point) => (
              <tr key={point.id}><th scope="row">{point.name}</th><td>{point.hypes}</td><td>{Math.round(point.score)}</td><td>{Math.round(point.expected)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        {model.sample} games released {DATE.format(new Date(`${data.from}T00:00:00Z`))}–{DATE.format(new Date(`${data.to}T00:00:00Z`))} with IGDB follows before launch and a settled score: the critics&apos; aggregate where three or more reviewed it, otherwise IGDB members&apos; rating. Outliers sit more than 1.1 standard deviations from the line. Refreshed twice a day.
      </p>
    </div>
  );
}

const shortName = (name: string) => (name.length > 22 ? `${name.slice(0, 21)}…` : name);

/**
 * Greedy label placement: each outlier's name goes beside its dot (towards
 * the open side), else above or below it; a label that would overlap one
 * already placed is dropped — the lists under the chart name every outlier
 * anyway, so a missing label loses nothing.
 */
function placeLabels(points: HypePoint[], px: (x: number) => number, py: (score: number) => number, width: number) {
  const placed: Array<{ point: HypePoint; x: number; y: number; anchor: "start" | "end"; box: [number, number, number, number] }> = [];
  const ordered = [...points].sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  for (const point of ordered) {
    const cx = px(point.x);
    const cy = py(point.score);
    const textWidth = shortName(point.name).length * 6.3;
    const right = cx > width * 0.65;
    const candidates: Array<{ x: number; y: number; anchor: "start" | "end" }> = [
      { x: cx + (right ? -8 : 8), y: cy + 3.5, anchor: right ? "end" : "start" },
      { x: cx + (right ? -4 : 4), y: cy - 9, anchor: right ? "end" : "start" },
      { x: cx + (right ? -4 : 4), y: cy + 16, anchor: right ? "end" : "start" },
    ];
    for (const candidate of candidates) {
      const left = candidate.anchor === "start" ? candidate.x : candidate.x - textWidth;
      const box: [number, number, number, number] = [left, candidate.y - 10, left + textWidth, candidate.y + 3];
      const clash = placed.some(({ box: other }) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]);
      if (!clash && box[0] >= 0 && box[2] <= width) {
        placed.push({ point, ...candidate, box });
        break;
      }
    }
  }
  return placed;
}

function OutlierList({ title, tone, items, empty }: { title: string; tone: string; items: HypePoint[]; empty: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-fg/[0.04] p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
        <Swatch color={tone} className="rounded-full" /> {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => {
            const gap = Math.round(item.score - item.expected);
            return (
              <li key={item.id}>
                <Link href={`/game/${item.slug}`} className="press group flex items-center gap-3 rounded-xl">
                  <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md bg-fg/[0.06]">
                    <GameCover name={item.name} slug={item.slug} image={item.image} width={72} sizes="36px" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold group-hover:underline">{item.name}</span>
                    <span className="block text-xs text-muted">
                      {compact.format(item.hypes)} follows · scored <span className="font-semibold text-text">{Math.round(item.score)}</span>
                    </span>
                  </span>
                  <span className={cn("shrink-0 text-sm font-bold tabular-nums", gap > 0 ? "text-mint" : "text-flare")}>{gap > 0 ? "+" : "−"}{Math.abs(gap)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
