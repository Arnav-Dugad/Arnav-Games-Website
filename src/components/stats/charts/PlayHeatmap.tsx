"use client";

import { motion } from "motion/react";
import { useMemo, useSyncExternalStore } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { dayHourGrid, playCalendar, type PlaySession } from "@/lib/personal/play-insights";
import { cn } from "@/lib/utils/cn";
import { drawTransition, Readout, useActiveMark, useChartMotion } from "../primitives";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Sequential: one hue (the brand violet), light → strong, five steps plus empty. */
const LEVELS = [0.08, 0.28, 0.48, 0.7, 0.95];

const hourLabel = (hour: number) => (hour === 0 ? "12am" : hour < 12 ? `${hour}am` : hour === 12 ? "12pm" : `${hour - 12}pm`);
const formatH = (hours: number) => (hours >= 10 ? `${Math.round(hours)} h` : hours >= 1 ? `${Math.round(hours * 10) / 10} h` : `${Math.round(hours * 60)} min`);

function level(value: number, max: number): number {
  if (value <= 0 || max <= 0) return -1;
  return Math.min(LEVELS.length - 1, Math.floor((value / max) * LEVELS.length - 1e-9));
}

function cellStyle(value: number, max: number) {
  const step = level(value, max);
  return step < 0
    ? { background: "color-mix(in oklab, var(--color-fg) 7%, transparent)" }
    : { background: `color-mix(in oklab, var(--viz-1) ${Math.round(LEVELS[step] * 100)}%, transparent)` };
}

/** True only in the browser after hydration: zone-dependent output waits for it. */
const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);

/**
 * When you play: hours by weekday × hour of day in the reader's own time
 * zone, then a year of play days. Both depend on the device's zone, which
 * the server can't know, so they render as a skeleton until mounted —
 * identical HTML on both sides, then the real grid.
 */
export function PlayHeatmap({ sessions, milestones }: { sessions: PlaySession[]; milestones: number[] }) {
  const mounted = useMounted();
  if (!mounted) {
    return (
      <div className="flex flex-col gap-4" aria-label="Loading">
        <Skeleton className="h-14 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    );
  }
  return <Grids sessions={sessions} milestones={milestones} />;
}

function Grids({ sessions, milestones }: { sessions: PlaySession[]; milestones: number[] }) {
  const motionOn = useChartMotion();
  const grid = useMemo(() => dayHourGrid(sessions), [sessions]);
  const calendar = useMemo(() => playCalendar(sessions, milestones), [sessions, milestones]);
  const { active, markProps } = useActiveMark<string>();
  const [day, hour] = active?.startsWith("c:") ? active.slice(2).split(":").map(Number) : [null, null];
  const calMax = Math.max(1, ...calendar.days.map((cell) => cell.hours));
  const activeDay = active?.startsWith("d:") ? calendar.days.find((cell) => cell.key === active.slice(2)) ?? null : null;
  const busiestDay = grid.byWeekday.indexOf(Math.max(...grid.byWeekday));
  const evening = grid.byHour.slice(18).reduce((a, b) => a + b, 0) + grid.byHour.slice(0, 2).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-5">
      <Readout>
        {day !== null && hour !== null ? (
          <p className="text-sm">
            <span className="font-semibold">{WEEKDAYS[day]}s, {hourLabel(hour)}–{hourLabel((hour + 1) % 24)}</span>
            <span className="text-muted"> · {grid.cells[day][hour] > 0 ? `${formatH(grid.cells[day][hour])} played` : "nothing logged"}</span>
          </p>
        ) : activeDay ? (
          <p className="text-sm">
            <span className="font-semibold">{new Date(`${activeDay.key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</span>
            <span className="text-muted"> · {activeDay.sessions ? `${formatH(activeDay.hours)} over ${activeDay.sessions} ${activeDay.sessions === 1 ? "session" : "sessions"}` : activeDay.milestones ? "started or finished a game" : "no play logged"}</span>
          </p>
        ) : grid.peak ? (
          <p className="text-sm leading-snug text-muted">
            You play most on <span className="font-semibold text-text">{WEEKDAYS[busiestDay]}s</span>, peaking around{" "}
            <span className="font-semibold text-text">{hourLabel(grid.peak.hour)}</span>
            {grid.hours > 0 && evening / grid.hours >= 0.5 ? " — a night-time player." : "."}
          </p>
        ) : (
          <p className="text-sm text-muted">Starting and finishing games marks your play days below.</p>
        )}
      </Readout>

      {grid.sessions > 0 && (
        <div>
          {/* 24 columns fit a 320px phone at ~9px a cell, so the whole day stays in view. */}
          <div>
            <div className="grid gap-[2px] sm:gap-[3px]" style={{ gridTemplateColumns: "1.75rem repeat(24, minmax(0, 1fr))" }} aria-label="Hours played by weekday and hour">
              {grid.cells.map((row, weekday) => (
                <div key={weekday} className="contents">
                  <span className="self-center text-[10px] text-faint">{WEEKDAYS[weekday].slice(0, 3)}</span>
                  {row.map((value, h) => (
                    <motion.button
                      key={h}
                      type="button"
                      {...markProps(`c:${weekday}:${h}`, `${WEEKDAYS[weekday]} ${hourLabel(h)}: ${value > 0 ? formatH(value) : "nothing"}`)}
                      // Only played hours are tab stops: 168 empty cells would bury the keyboard.
                      tabIndex={value > 0 ? 0 : -1}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={drawTransition(motionOn, { duration: 0.4, delay: motionOn ? (weekday * 24 + h) * 0.002 : 0 })}
                      className={cn("aspect-square min-h-0 min-w-0 rounded-[2px] outline-offset-1 sm:rounded-[3px]", active === `c:${weekday}:${h}` && "ring-2 ring-text")}
                      style={cellStyle(value, grid.max)}
                    />
                  ))}
                </div>
              ))}
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="overflow-visible whitespace-nowrap text-[9px] tabular-nums text-faint">{h % 6 === 0 ? hourLabel(h) : ""}</span>
              ))}
            </div>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
            From {grid.sessions} journal {grid.sessions === 1 ? "session" : "sessions"} in your time zone. A session&apos;s hours are laid back from when you logged it; one without a length counts as an hour.
          </p>
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-[13px] font-semibold">Your year of play</p>
          <p className="text-[12px] text-muted">
            <span className="font-semibold tabular-nums text-text">{calendar.activeDays}</span> days ·{" "}
            longest run <span className="font-semibold tabular-nums text-text">{calendar.longestStreak}</span>
            {calendar.currentStreak > 1 && <> · on a <span className="font-semibold tabular-nums text-text">{calendar.currentStreak}</span>-day streak</>}
          </p>
        </div>
        {/* Newest weeks on the right; on a phone the strip scrolls and starts scrolled to today. */}
        <div className="no-scrollbar -mx-1 overflow-x-auto px-1 pb-1" dir="rtl">
          <div dir="ltr" className="inline-grid gap-[3px]" style={{ gridTemplateRows: "auto repeat(7, 11px)", gridAutoFlow: "column", gridAutoColumns: "11px" }} aria-label="Play days over the last year">
            {Array.from({ length: calendar.weeks }, (_, column) => {
              const month = calendar.months.find((item) => item.column === column);
              return [
                <span key={`m${column}`} className="h-3 overflow-visible whitespace-nowrap text-[9px] leading-3 text-faint">{month && column < calendar.weeks - 2 ? MONTHS[month.month - 1] : ""}</span>,
                ...calendar.days.slice(column * 7, column * 7 + 7).map((cell) =>
                  cell.future ? (
                    <span key={cell.key} />
                  ) : (
                    <button
                      key={cell.key}
                      type="button"
                      {...markProps(`d:${cell.key}`, `${cell.key}: ${cell.sessions ? formatH(cell.hours) : cell.milestones ? "milestone" : "no play"}`)}
                      tabIndex={cell.sessions + cell.milestones > 0 ? 0 : -1}
                      className={cn("h-[11px] w-[11px] rounded-[2px]", active === `d:${cell.key}` && "ring-2 ring-text")}
                      style={cell.sessions ? cellStyle(cell.hours, calMax) : cell.milestones ? cellStyle(calMax * 0.05, calMax) : cellStyle(0, 1)}
                    />
                  ),
                ),
              ];
            })}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-faint" aria-hidden>
          Less
          {[-1, 0, 1, 2, 3, 4].map((step) => (
            <span key={step} className="h-[11px] w-[11px] rounded-[2px]" style={step < 0 ? cellStyle(0, 1) : { background: `color-mix(in oklab, var(--viz-1) ${Math.round(LEVELS[step] * 100)}%, transparent)` }} />
          ))}
          More
        </div>
      </div>

      <div className="sr-only">
        <table>
          <caption>Hours played by weekday</caption>
          <thead><tr><th scope="col">Weekday</th><th scope="col">Hours</th></tr></thead>
          <tbody>{grid.byWeekday.map((value, index) => <tr key={index}><th scope="row">{WEEKDAYS[index]}</th><td>{Math.round(value * 10) / 10}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
