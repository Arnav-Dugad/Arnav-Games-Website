"use client";

import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { FacetKind, TasteMap as Map_, TasteNode } from "@/lib/personal/taste-map";
import { cn } from "@/lib/utils/cn";
import { DRAW_EASE, drawTransition, Readout, Swatch, formatPercent, useActiveMark, useChartMotion } from "../primitives";
import { shortGenre } from "./GenreRadar";

/** Colour follows the kind of facet, never its rank. */
const KIND: Record<FacetKind, { label: string; color: string; labelled: number }> = {
  genre: { label: "Genres", color: "var(--viz-1)", labelled: 4 },
  theme: { label: "Themes", color: "var(--viz-5)", labelled: 3 },
  perspective: { label: "Perspectives", color: "var(--viz-4)", labelled: 2 },
};
const KINDS = ["genre", "theme", "perspective"] as const;
/** Degrees left empty between two kinds' arcs, so each reads as its own cluster. */
const GAP = 22;

const nodeLabel = (node: TasteNode) => (node.kind === "genre" ? shortGenre(node.label) : node.label);

interface Placed extends TasteNode {
  x: number;
  y: number;
  size: number;
  /** 0–1: share relative to the strongest facet of the same kind. */
  strength: number;
  labelled: boolean;
}

/**
 * Lay the facets out as a constellation around "you". Each kind owns an arc
 * sized by how many facets it has (one equal slot per star, a gap between
 * kinds); within a kind the strongest sit closest to the centre and shine
 * biggest. Strength is relative *within* a kind: a game has one perspective
 * but several genres, so raw weights across kinds aren't comparable.
 * Coordinates are in a −100…100 square.
 */
function place(nodes: TasteNode[]): Placed[] {
  const kinds = KINDS.filter((kind) => nodes.some((node) => node.kind === kind));
  const slot = (360 - GAP * kinds.length) / Math.max(1, nodes.length);
  const out: Placed[] = [];
  let cursor = -90 + GAP / 2;
  for (const kind of kinds) {
    const ofKind = nodes.filter((node) => node.kind === kind).sort((a, b) => b.share - a.share);
    const top = ofKind[0]?.share || 1;
    // Strongest in the middle of the arc, the rest alternating outwards.
    const order = ofKind.map((_, index) => (index % 2 ? -1 : 1) * Math.ceil(index / 2));
    const mid = cursor + (slot * ofKind.length) / 2;
    ofKind.forEach((node, index) => {
      const angle = ((mid + order[index] * slot) * Math.PI) / 180;
      const strength = node.share / top;
      const radius = 30 + Math.pow(1 - strength, 0.8) * 46 + (index % 2) * 9;
      out.push({
        ...node,
        x: Math.sin(angle) * radius,
        y: -Math.cos(angle) * radius,
        size: 3.5 + Math.sqrt(strength) * 8.5,
        strength,
        labelled: index < KIND[kind].labelled,
      });
    });
    cursor += slot * ofKind.length + GAP;
  }
  return out;
}

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0.01);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${28 - (value / max) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-7 w-24 overflow-visible" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Delta({ delta, className }: { delta: number | null; className?: string }) {
  if (delta === null || Math.abs(delta) < 0.05) return null;
  const Icon = delta > 0 ? ArrowUpRight : ArrowDownRight;
  return <Icon size={12} aria-label={delta > 0 ? "rising" : "fading"} className={cn("shrink-0", delta > 0 ? "text-mint" : "text-muted", className)} />;
}

export function TasteMap({ map }: { map: Map_ }) {
  const motionOn = useChartMotion();
  const { active, markProps } = useActiveMark<string>();
  const placed = place(map.nodes);
  const selected = placed.find((node) => node.key === active) ?? null;
  // The strongest of each kind: comparable within a kind, not across.
  const top = KINDS.flatMap((kind) => [...map.nodes].filter((node) => node.kind === kind).sort((a, b) => b.share - a.share).slice(0, 1));
  const kinds = KINDS.filter((kind) => map.nodes.some((node) => node.kind === kind));

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Readout>
        {selected ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                {selected.label} <Delta delta={selected.delta} />
              </p>
              <p className="text-xs text-muted">
                {formatPercent(selected.share)} of your {KIND[selected.kind].label.toLowerCase()} · {selected.games} {selected.games === 1 ? "game" : "games"}
                {selected.delta !== null && Math.abs(selected.delta) >= 0.01 && (
                  <> · {selected.delta > 0 ? "+" : "−"}{Math.round(Math.abs(selected.delta) * 100)} pts vs a year ago</>
                )}
              </p>
            </div>
            <Spark values={selected.trend} color={KIND[selected.kind].color} />
          </div>
        ) : (
          <p className="text-sm leading-snug text-muted">
            At the heart of your taste: {top.map((node, index) => (
              <span key={node.key}>
                {index > 0 && (index === top.length - 1 ? " and " : ", ")}
                <span className="font-semibold text-text">{nodeLabel(node)}</span>
              </span>
            ))}.
            <span className="block text-xs text-faint"><span className="fine:hidden">Tap</span><span className="hidden fine:inline">Hover or select</span> a star for its share and trend.</span>
          </p>
        )}
      </Readout>

      <div className="relative mx-auto aspect-square w-full max-w-[420px]">
        <svg viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {[30, 55, 80].map((r) => (
            <circle key={r} r={r} fill="none" stroke="var(--color-line)" strokeWidth={0.6} strokeDasharray="1.5 2.5" />
          ))}
          {placed.map((node, index) => (
            <motion.line
              key={`l${node.key}`}
              x1={0}
              y1={0}
              x2={node.x}
              y2={node.y}
              stroke={KIND[node.kind].color}
              strokeWidth={0.6}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: active && active !== node.key ? 0.12 : 0.15 + 0.45 * node.strength }}
              transition={drawTransition(motionOn, { duration: 0.9, delay: motionOn ? 0.1 + index * 0.035 : 0, ease: DRAW_EASE })}
            />
          ))}
          <circle r={6} fill="var(--color-text)" />
          <circle r={11} fill="none" stroke="var(--color-text)" strokeOpacity={0.25} strokeWidth={0.8} />
          {placed.map((node, index) => (
            <motion.circle
              key={node.key}
              cx={node.x}
              cy={node.y}
              r={node.size}
              fill={KIND[node.kind].color}
              stroke="var(--viz-surface)"
              strokeWidth={1.2}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: active && active !== node.key ? 0.35 : 1 }}
              style={{ transformOrigin: `${node.x}px ${node.y}px`, transformBox: "view-box" }}
              transition={drawTransition(motionOn, { duration: 0.6, delay: motionOn ? 0.35 + index * 0.035 : 0, ease: DRAW_EASE })}
            />
          ))}
        </svg>
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-[0.9rem] text-[10px] font-semibold uppercase tracking-[0.08em] text-faint" aria-hidden>
          You
        </span>
        {/* HTML labels double as the tap targets (≥ 44px tall on touch). */}
        {placed.map((node) => {
          // Labels sit just outside their star, pointing away from "you",
          // so they fan out round the ring instead of stacking on one row.
          const r = Math.hypot(node.x, node.y) || 1;
          const ux = node.x / r;
          const uy = node.y / r;
          const left = 50 + (node.x + ux * (node.size + 2.5)) / 2;
          const top = 50 + (node.y + uy * (node.size + 2.5)) / 2;
          const side = ux > 0.3 ? "right" : ux < -0.3 ? "left" : uy < 0 ? "top" : "bottom";
          return (
            <button
              key={node.key}
              type="button"
              {...markProps(node.key, `${node.label}: ${formatPercent(node.share)} of your ${KIND[node.kind].label.toLowerCase()}, ${node.games} games${node.delta !== null && Math.abs(node.delta) >= 0.05 ? node.delta > 0 ? ", rising" : ", fading" : ""}`)}
              className={cn(
                "absolute flex min-h-7 max-w-[6.5rem] items-center gap-0.5 rounded-full px-1 text-[11px] leading-tight transition-colors sm:max-w-[8rem] sm:text-[12px]",
                side === "right" && "-translate-y-1/2",
                side === "left" && "-translate-x-full -translate-y-1/2",
                side === "top" && "-translate-x-1/2 -translate-y-full",
                side === "bottom" && "-translate-x-1/2",
                active === node.key ? "z-10 font-semibold text-text" : node.labelled ? "text-muted fine:hover:text-text" : "text-transparent fine:hover:text-muted",
              )}
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <span className="truncate">{nodeLabel(node)}</span>
              {node.labelled && <Delta delta={node.delta} />}
            </button>
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legend">
        {kinds.map((kind) => (
          <li key={kind} className="flex items-center gap-1.5 text-xs text-muted">
            <Swatch color={KIND[kind].color} className="rounded-full" />
            {KIND[kind].label}
          </li>
        ))}
        <li className="text-xs text-faint">Closer and larger: a stronger pull</li>
      </ul>

      {(map.rising.length > 0 || map.fading.length > 0) ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { title: "Rising this year", items: map.rising },
            { title: "Fading", items: map.fading },
          ].map((group) =>
            group.items.length ? (
              <div key={group.title} className="rounded-2xl bg-fg/[0.04] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{group.title}</p>
                <ul className="mt-2 space-y-2">
                  {group.items.map((node) => (
                    <li key={node.key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Swatch color={KIND[node.kind].color} className="rounded-full" />
                        <span className="truncate">{nodeLabel(node)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Spark values={node.trend} color={KIND[node.kind].color} />
                        <span className={cn("w-12 text-right text-xs font-semibold tabular-nums", node.delta! > 0 ? "text-mint" : "text-muted")}>
                          {node.delta! > 0 ? "+" : "−"}{Math.round(Math.abs(node.delta!) * 100)} pts
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      ) : (
        <p className="rounded-2xl bg-fg/[0.04] p-3.5 text-[13px] leading-relaxed text-muted">
          {map.driftNote ?? "Your taste has held steady: nothing gained or lost five points of share against a year ago."}
        </p>
      )}

      <div className="sr-only">
        <table>
          <caption>Your taste: share of each facet within its kind</caption>
          <thead><tr><th scope="col">Facet</th><th scope="col">Kind</th><th scope="col">Share</th><th scope="col">Games</th><th scope="col">Change vs a year ago</th></tr></thead>
          <tbody>
            {map.nodes.map((node) => (
              <tr key={node.key}>
                <th scope="row">{node.label}</th>
                <td>{KIND[node.kind].label}</td>
                <td>{formatPercent(node.share)}</td>
                <td>{node.games}</td>
                <td>{node.delta === null ? "not enough history" : `${Math.round(node.delta * 100)} points`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
