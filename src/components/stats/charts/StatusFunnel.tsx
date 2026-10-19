"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";
import type { FunnelStage } from "@/lib/games/stats";
import { cn } from "@/lib/utils/cn";
import { DRAW_EASE, drawTransition, formatPercent, useActiveMark, useChartMotion } from "../primitives";

const STAGE_HINT: Record<FunnelStage["key"], string> = {
  tracked: "Want to play, playing or played",
  started: "Playing or played",
  finished: "Marked played",
};

/**
 * Want → playing → played, cumulatively. Each step shows its conversion from
 * the step before, which is the number people actually want from a funnel
 * ("of what I start, how much do I finish?").
 */
export function StatusFunnel({ stages, counts }: { stages: FunnelStage[]; counts: { want: number; playing: number; played: number } }) {
  const motionOn = useChartMotion();
  // Bars start at zero width, and a zero-area element never counts as "in
  // view", so the draw-in keys off the whole chart instead.
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { once: true, amount: 0.3 });
  const { active, markProps } = useActiveMark<FunnelStage["key"]>();
  const top = Math.max(1, stages[0]?.value ?? 1);

  return (
    <div ref={rootRef} className="flex flex-1 flex-col gap-3.5">
      {stages.map((stage, index) => {
        const previous = stages[index - 1];
        const conversion = previous && previous.value ? stage.value / previous.value : null;
        const on = active === stage.key;
        return (
          <div key={stage.key}>
            {conversion !== null && (
              <p className="mb-2 flex items-center gap-1.5 pl-1 text-[11px] text-faint">
                <span aria-hidden className="h-3 w-px bg-line-strong" />
                <span className="font-semibold tabular-nums text-muted">{formatPercent(conversion)}</span> carried through
              </p>
            )}
            <button
              type="button"
              {...markProps(stage.key, `${stage.label}: ${stage.value} games`)}
              className={cn("press block w-full rounded-xl p-1 text-left transition-colors", on ? "bg-fg/[0.06]" : "hover:bg-fg/[0.03]")}
            >
              <span className="mb-1.5 flex items-baseline justify-between gap-3 px-0.5">
                <span className="text-sm font-semibold">{stage.label}</span>
                <span className="text-sm font-bold tabular-nums">{stage.value}</span>
              </span>
              <span className="block h-5 overflow-hidden rounded-[6px] bg-fg/[0.05]">
                <motion.span
                  className="block h-full rounded-[6px]"
                  style={{ background: "var(--viz-1)", opacity: 1 - index * 0.22, originX: 0 }}
                  initial={{ scaleX: 0 }}
                  animate={inView ? { scaleX: stage.value / top } : undefined}
                  transition={drawTransition(motionOn, { duration: 0.8, delay: motionOn ? index * 0.12 : 0, ease: DRAW_EASE })}
                />
              </span>
              {on && <span className="mt-1.5 block px-0.5 text-[11px] text-muted">{STAGE_HINT[stage.key]}</span>}
            </button>
          </div>
        );
      })}
      <p className="mt-auto pt-1 text-[11px] leading-relaxed text-faint">
        Right now: {counts.want} want to play · {counts.playing} playing · {counts.played} played.
      </p>
    </div>
  );
}
