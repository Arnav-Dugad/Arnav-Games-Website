"use client";

/**
 * Building blocks shared by the dashboard's sections: grouped panels, empty
 * states, KPI tiles with honest deltas, and section headings.
 */

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Kpi } from "@/lib/analytics/types";
import { Sparkline, formatCount } from "./charts";
import { cn } from "@/lib/utils/cn";

/** One dashboard section: an anchor target with a large title and a scope note. */
export function Section({
  id,
  title,
  scope,
  children,
}: {
  id: string;
  title: string;
  /** What the numbers cover ("Last 7 days", "Right now"). */
  scope: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-36 pt-9 first:pt-2 sm:pt-12 lg:scroll-mt-40">
      <header className="mb-4 flex items-baseline justify-between gap-4 sm:mb-5">
        <h2 id={`${id}-title`} className="text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">
          {title}
        </h2>
        <p className="shrink-0 text-[13px] text-faint">{scope}</p>
      </header>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">{children}</div>
    </section>
  );
}

export function Panel({
  title,
  subtitle,
  icon,
  action,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("glass min-w-0 rounded-3xl p-5 sm:p-6", className)}>
      <header className="mb-5 flex items-start gap-2.5">
        {icon && <span className="mt-0.5 text-brand-soft">{icon}</span>}
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold tracking-[-0.015em]">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[13px] leading-relaxed text-muted">
      {children}
    </p>
  );
}

export function Caveat({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[12px] leading-relaxed text-faint">{children}</p>;
}

export function KpiTile({
  label,
  kpi,
  spark,
  rate = false,
  note,
}: {
  label: string;
  kpi: Kpi;
  spark?: number[];
  rate?: boolean;
  note?: string;
}) {
  const value = rate ? formatRate(kpi.current) : formatCount(kpi.current);
  return (
    <div className="glass flex min-w-0 flex-col rounded-3xl p-4 sm:p-5">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="mt-1.5 font-display text-[28px] font-bold leading-none tracking-[-0.03em] tabular-nums sm:text-[32px]">
        {value}
      </p>
      <Delta kpi={kpi} rate={rate} />
      {note && <p className="mt-1 truncate text-[11px] text-faint" title={note}>{note}</p>}
      {spark && <Sparkline values={spark} className="mt-auto pt-3" />}
    </div>
  );
}

export function formatRate(value: number): string {
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
}

/** Signed change vs the same elapsed span of the previous period. Up is good
 *  for every metric here; the arrow carries direction, not just the colour. */
export function Delta({ kpi, rate }: { kpi: Kpi; rate: boolean }) {
  const { current, previous } = kpi;
  let text: string;
  let direction: "up" | "down" | "flat";
  if (rate) {
    const points = (current - previous) * 100;
    direction = Math.abs(points) < 0.05 ? "flat" : points > 0 ? "up" : "down";
    text = `${points > 0 ? "+" : ""}${points.toFixed(1)} pts`;
  } else if (previous === 0) {
    direction = current > 0 ? "up" : "flat";
    text = current > 0 ? "New" : "No change";
  } else {
    const change = ((current - previous) / previous) * 100;
    direction = Math.abs(change) < 0.5 ? "flat" : change > 0 ? "up" : "down";
    text = `${change > 0 ? "+" : ""}${Math.round(change)}%`;
  }
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return (
    <p className="mt-2 flex items-center gap-1 text-[12px]">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-semibold",
          direction === "up" && "text-mint",
          direction === "down" && "text-flare",
          direction === "flat" && "text-muted",
        )}
      >
        <Icon size={13} aria-hidden />
        {text}
      </span>
      <span className="text-faint">vs prior</span>
    </p>
  );
}

/** "home:trending" → "Home · Trending". */
export function prettySource(src: string): string {
  return src
    .split(":")
    .map((part) => part.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()))
    .join(" · ");
}

export function relativeTime(ts: number, now: number): string {
  const seconds = Math.max(0, now - ts);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
