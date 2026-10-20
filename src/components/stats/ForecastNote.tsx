"use client";

/**
 * "At your pace you'll clear your backlog in March 2028" — with what that
 * date is built on one tap away. Shared by the library and /stats.
 */

import { useState } from "react";
import { ChevronDown, Hourglass } from "lucide-react";
import type { BacklogForecast } from "@/lib/games/forecast";
import { cn } from "@/lib/utils/cn";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en")} ${count === 1 ? one : many}`;

export function ForecastNote({ forecast, className }: { forecast: BacklogForecast; className?: string }) {
  const [open, setOpen] = useState(false);
  // Past ten years a month is false precision.
  const when = forecast.distant ? "in over a decade" : MONTH.format(forecast.date);
  const window = forecast.windowDays >= 360 ? "the last 12 months" : `the last ${Math.round(forecast.windowDays / 30.44)} months`;

  return (
    <div className={cn("rounded-2xl bg-brand/[0.08] p-4", className)}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
        <Hourglass size={12} aria-hidden /> At your pace
      </p>
      <p className="mt-1 text-[15px] leading-snug text-muted">
        You&apos;ll clear your backlog{forecast.distant ? " " : " in "}
        <span className="font-display text-[22px] font-bold tracking-[-0.01em] text-text">{when}</span>
      </p>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="press -ml-1 mt-1 inline-flex min-h-10 items-center gap-1 rounded-full px-1 text-[13px] font-medium text-brand-soft coarse:min-h-11"
      >
        How we worked it out
        <ChevronDown size={14} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="mt-1 space-y-1 text-[13px] leading-relaxed text-muted">
          <li>
            You finished {plural(forecast.finished, "game")} in {window} — about {forecast.hoursPerMonth.toLocaleString("en")} hours of play a month.
          </li>
          <li>
            {plural(forecast.games, "game")} left ≈ {forecast.hours.toLocaleString("en")} hours, from time-to-beat figures and the hours you&apos;ve logged.
          </li>
          {forecast.estimatedGames > 0 && (
            <li>
              {plural(forecast.estimatedGames, "game")} with no known length {forecast.estimatedGames === 1 ? "is" : "are"} counted at your typical {forecast.typicalHours} h.
            </li>
          )}
          <li>Finish or add games and the date moves.</li>
        </ul>
      )}
    </div>
  );
}
