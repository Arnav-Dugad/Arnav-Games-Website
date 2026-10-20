"use client";

/**
 * "Do critics and players agree?": every verdict we have on one 0–100 line,
 * the gap between critics and players drawn as a bar between their dots,
 * and the gap said in words (`score-spread.ts`).
 *
 * The scale is honest about itself: it starts at 40 only when every figure
 * is above 45 (the usual case — a full 0–100 line would squash the gap into
 * a few pixels) and labels its ends either way. Labels live in the legend
 * rather than on the line, so close dots never collide into unreadable text.
 */

import type { CSSProperties } from "react";
import { scoreSpread, type ScoreSpread as Spread, type SpreadKey, type ScoreSpreadInput } from "@/lib/games/score-spread";
import { cn } from "@/lib/utils/cn";
import { compactNumber } from "@/lib/utils/format";
import { InfoTip } from "./InfoTip";

const SERIES: Record<SpreadKey, { colour: string; hollow?: boolean; unit: string }> = {
  critics: { colour: "var(--game-accent, var(--color-brand))", unit: "/100" },
  members: { colour: "var(--color-gold)", unit: "/100" },
  steam: { colour: "var(--color-neon)", unit: "% positive" },
  recent: { colour: "var(--color-neon)", hollow: true, unit: "% positive" },
};

const COUNT_NOUN: Record<SpreadKey, [string, string]> = {
  critics: ["review", "reviews"],
  members: ["rating", "ratings"],
  steam: ["review", "reviews"],
  recent: ["review", "reviews"],
};

const TONE: Record<NonNullable<Spread["gap"]>["tone"], string> = {
  agree: "text-mint",
  mild: "text-text",
  split: "text-gold",
};

export function ScoreSpreadView({ input }: { input: ScoreSpreadInput }) {
  const spread = scoreSpread(input);
  // The question is critics against players; without a critic figure the Steam card already says it all.
  if (!spread || !spread.marks.some((mark) => mark.key === "critics")) return null;
  const { marks, gap, trend } = spread;

  const low = marks.every((mark) => mark.value > 45) ? 40 : 0;
  const at = (value: number) => ((Math.max(low, value) - low) / (100 - low)) * 100;
  const critics = marks.find((mark) => mark.key === "critics");
  const players = gap ? marks.find((mark) => mark.key === gap.players) : null;

  return (
    <div className="border-t border-line px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-text">
          Do critics and players agree? <InfoTip topic="scoreSpread" />
        </h3>
        {gap && (
          <p className={cn("text-[13px] font-semibold", TONE[gap.tone])}>
            {gap.headline}
            {gap.tone !== "agree" && (
              <span className="font-normal tabular-nums text-muted">
                {" "}
                · {Math.abs(gap.points)} {Math.abs(gap.points) === 1 ? "point" : "points"}
              </span>
            )}
          </p>
        )}
      </div>

      {/* The line. Decorative for screen readers: the legend below states every value. */}
      <div aria-hidden className="relative mt-5 h-6">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-fg/[0.07]" />
        {critics && players && (
          <div
            className={cn(
              "absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full",
              gap?.tone === "split" ? "bg-gold/55" : gap?.tone === "mild" ? "bg-fg/25" : "bg-mint/45",
            )}
            style={{ left: `${Math.min(at(critics.value), at(players.value))}%`, width: `${Math.abs(at(critics.value) - at(players.value))}%` }}
          />
        )}
        {marks.map((mark) => (
          <span
            key={mark.key}
            className={cn(
              "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--color-panel)]",
              SERIES[mark.key].hollow && "bg-[var(--color-panel)]! ring-0 border-[2.5px]",
            )}
            style={
              {
                left: `${at(mark.value)}%`,
                background: SERIES[mark.key].colour,
                borderColor: SERIES[mark.key].colour,
                // Critics sit on top: theirs is the figure the gap is measured from.
                zIndex: mark.key === "critics" ? 2 : 1,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-[11px] tabular-nums text-faint">
        <span>{low}</span>
        <span>{Math.round((low + 100) / 2)}</span>
        <span>100</span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {marks.map((mark) => (
          <div key={mark.key} className="min-w-0">
            <dt className="flex items-center gap-1.5 truncate text-[12px] text-muted">
              <span
                aria-hidden
                className={cn("h-2.5 w-2.5 shrink-0 rounded-full", SERIES[mark.key].hollow && "border-2 bg-transparent!")}
                style={{ background: SERIES[mark.key].colour, borderColor: SERIES[mark.key].colour }}
              />
              {mark.label}
            </dt>
            <dd className="mt-0.5">
              <span className="font-display text-[19px] font-bold leading-none tabular-nums text-text">{mark.value}</span>
              <span className="text-[12px] font-semibold text-muted">{SERIES[mark.key].unit}</span>
              {mark.count > 0 && (
                <span className="block truncate text-[11px] tabular-nums text-faint">
                  {compactNumber(mark.count)} {COUNT_NOUN[mark.key][mark.count === 1 ? 0 : 1]}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {trend && <p className="mt-4 text-[13px] leading-snug text-text">{trend.text}</p>}
      <p className="mt-3 text-[12px] leading-snug text-faint">
        Critics are IGDB&rsquo;s average of published reviews — individual critic scores aren&rsquo;t available, so there&rsquo;s no range among
        them.{marks.some((mark) => mark.key === "steam") && " Steam figures are the share of positive reviews, not an average score."}
      </p>
    </div>
  );
}
