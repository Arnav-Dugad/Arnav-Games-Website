"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { RadarAxis } from "@/lib/games/stats";
import { canonicalEntryHref } from "@/lib/notifications/model";
import { cn } from "@/lib/utils/cn";
import { DRAW_EASE, drawTransition, Readout, formatPercent, useActiveMark, useChartMotion } from "../primitives";

/**
 * IGDB genre names are long ("Role-playing (RPG)", "Hack and slash/Beat 'em
 * up") and a radar label sits in a few dozen pixels on a phone. The
 * parenthetical acronym is what players actually call the genre, so prefer it.
 */
export function shortGenre(label: string): string {
  const acronym = label.match(/\(([A-Z]{2,5})\)/);
  if (acronym) return acronym[1];
  return label.split("/")[0].replace(/\s+and\s+/i, " & ").trim();
}

const R = 100;
const RINGS = [0.25, 0.5, 0.75, 1];

/**
 * Genre radar. Each axis is one of the user's top genres; its length is the
 * number of their games carrying that genre, relative to the biggest one.
 *
 * Labels are HTML laid over the SVG rather than SVG text: the chart scales
 * with its card, and SVG text would shrink to an unreadable size on a 320px
 * phone. As HTML they stay at body size and double as the tap targets.
 */
export function GenreRadar({ axes, totalWithGenres }: { axes: RadarAxis[]; totalWithGenres: number }) {
  const motionOn = useChartMotion();
  const { active, markProps } = useActiveMark<number>();
  const max = Math.max(1, ...axes.map((axis) => axis.count));
  const n = axes.length;
  const angle = (index: number) => (Math.PI * 2 * index) / n - Math.PI / 2;
  const point = (index: number, radius: number) => [Math.cos(angle(index)) * radius, Math.sin(angle(index)) * radius] as const;
  const shape = axes.map((axis, index) => point(index, (axis.count / max) * R).join(",")).join(" ");
  const selected = axes.find((axis) => axis.id === active) ?? null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Readout>
        {selected ? (
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-semibold">{selected.label}</p>
            <p className="shrink-0 text-sm"><span className="font-bold">{selected.count} {selected.count === 1 ? "game" : "games"}</span> <span className="text-muted">· {formatPercent(selected.share)}</span></p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            <span className="font-semibold text-text">{axes[0]?.label}</span> leads, on {axes[0]?.count} of your {totalWithGenres} genre-tagged games.
            <span className="block text-xs text-faint"><span className="fine:hidden">Tap</span><span className="hidden fine:inline">Hover or select</span> a genre to see its games.</span>
          </p>
        )}
      </Readout>

      {/* The SVG sits in the middle 66% so the label ring has room on every
          side; all of it is relative, so it scales with the card. */}
      <div className="relative mx-auto aspect-square w-full max-w-[340px] lg:max-w-[380px]">
        <svg viewBox="-110 -110 220 220" className="absolute left-[17%] top-[17%] h-[66%] w-[66%] overflow-visible" aria-hidden>
          {RINGS.map((ring) => (
            <polygon
              key={ring}
              points={axes.map((_, index) => point(index, ring * R).join(",")).join(" ")}
              fill="none"
              stroke="var(--color-line-strong)"
              strokeWidth={ring === 1 ? 1 : 0.75}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {axes.map((axis, index) => {
            const [x, y] = point(index, R);
            return (
              <line
                key={axis.id}
                x1={0}
                y1={0}
                x2={x}
                y2={y}
                stroke={active === axis.id ? "var(--viz-1)" : "var(--color-line)"}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {/* The invisible full-size rect pins the group's box to the origin so
              the grow-in scales from the centre, not the shape's own bounds. */}
          <motion.g
            initial={{ scale: 0.2, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={drawTransition(motionOn, { duration: 0.9, ease: DRAW_EASE })}
          >
            <rect x={-110} y={-110} width={220} height={220} fill="none" />
            <polygon points={shape} fill="var(--viz-1)" fillOpacity={0.2} stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {axes.map((axis, index) => {
              const [x, y] = point(index, (axis.count / max) * R);
              const on = active === axis.id;
              return (
                <circle
                  key={axis.id}
                  cx={x}
                  cy={y}
                  r={on ? 5.5 : 4}
                  fill="var(--viz-1)"
                  stroke="var(--viz-surface)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </motion.g>
        </svg>

        {axes.map((axis, index) => {
          // Percent positions in the padded box: the SVG spans the middle 66%
          // of it, and the viewBox is 220 units across.
          const [x, y] = point(index, R * 1.27);
          const left = 50 + (x / 220) * 66;
          const top = 50 + (y / 220) * 66;
          const on = active === axis.id;
          return (
            <button
              key={axis.id}
              type="button"
              {...markProps(axis.id, `${axis.label}: ${axis.count} games`)}
              className={cn(
                "press absolute flex max-w-[5.75rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-lg px-1.5 py-1 text-center leading-tight transition-colors",
                on ? "bg-brand/20 text-text" : "text-muted hover:text-text",
              )}
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <span className="text-[11px] font-semibold">{shortGenre(axis.label)}</span>
              <span className="text-[10px] tabular-nums text-faint">{axis.count}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${selected.label} games`}>
          {selected.games.slice(0, 8).map((game) => (
            <li key={game.gameId}>
              <Link href={canonicalEntryHref(game)} className="press inline-flex max-w-[14rem] items-center rounded-full bg-fg/[0.06] px-2.5 py-1 text-xs font-medium transition-colors hover:bg-fg/[0.1]">
                <span className="truncate">{game.name}</span>
              </Link>
            </li>
          ))}
          {selected.games.length > 8 && (
            <li className="px-1.5 py-1 text-xs text-faint">+{selected.games.length - 8} more</li>
          )}
        </ul>
      )}

      {/* Tables ignore sr-only's 1px box, so a div does the hiding. */}
      <div className="sr-only">
        <table>
          <caption>Games per genre, top {axes.length} genres</caption>
          <thead><tr><th scope="col">Genre</th><th scope="col">Games</th><th scope="col">Share of genre-tagged games</th></tr></thead>
          <tbody>
            {axes.map((axis) => (
              <tr key={axis.id}><th scope="row">{axis.label}</th><td>{axis.count}</td><td>{formatPercent(axis.share)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
