"use client";

import Link from "next/link";
import { motion, useInView } from "motion/react";
import { useId, useRef, useState, type PointerEvent } from "react";
import { currencyDigits } from "@/lib/games/market-rules";
import { formatMoney as money, type GameValue, type LibraryValue, type SpendBucket, type SpendSummary } from "@/lib/personal/spend";
import { cn } from "@/lib/utils/cn";
import { CountUp, DRAW_EASE, drawTransition, Readout, useActiveMark, useChartMotion, useElementWidth } from "../primitives";

export { money };

export interface GameName {
  name: string;
  slug: string;
}

/* ---------------------------------------------------------------------------
 * Spending
 * ------------------------------------------------------------------------ */

const BAR_HEIGHT = 120;

function Bars({ buckets, currency }: { buckets: SpendBucket[]; currency: string }) {
  const motionOn = useChartMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const { active, markProps } = useActiveMark<string>();
  const max = Math.max(1, ...buckets.map((bucket) => bucket.value));
  const selected = buckets.find((bucket) => bucket.key === active) ?? null;
  const thin = buckets.length > 8;

  return (
    <div ref={ref} className="flex flex-col gap-2">
      <p className="min-h-5 text-xs text-muted" aria-live="polite">
        {selected
          ? <><span className="font-semibold text-text">{selected.label}</span> · {money(selected.value, currency)} on {selected.purchases} {selected.purchases === 1 ? "game" : "games"}</>
          : <>&nbsp;</>}
      </p>
      <div className="flex items-end gap-[2px]" style={{ height: BAR_HEIGHT }}>
        {buckets.map((bucket, index) => (
          <button
            key={bucket.key}
            type="button"
            {...markProps(bucket.key, `${bucket.label}: ${money(bucket.value, currency)}`)}
            className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
          >
            <motion.span
              className={cn("block w-full max-w-14 rounded-t-[4px] transition-colors", active === bucket.key ? "bg-[var(--viz-1)]" : "bg-[color-mix(in_oklab,var(--viz-1)_70%,transparent)] group-hover:bg-[var(--viz-1)]")}
              style={{ height: `${Math.max(bucket.value > 0 ? 3 : 0, (bucket.value / max) * 100)}%`, originY: 1 }}
              initial={{ scaleY: 0 }}
              animate={inView ? { scaleY: 1 } : undefined}
              transition={drawTransition(motionOn, { duration: 0.7, delay: motionOn ? index * 0.04 : 0, ease: DRAW_EASE })}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-[2px] border-t border-line pt-1.5">
        {buckets.map((bucket, index) => (
          <span key={bucket.key} className={cn("min-w-0 flex-1 truncate text-center text-[10px] tabular-nums", active === bucket.key ? "font-semibold text-text" : "text-faint")}>
            {thin && index % 2 === 1 && active !== bucket.key ? "" : bucket.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ValueList({ title, items, names, currency }: { title: string; items: GameValue[]; names: Record<number, GameName>; currency: string }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-2xl bg-fg/[0.04] p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.gameId} className="flex items-baseline justify-between gap-3 text-sm">
            {names[item.gameId] ? (
              <Link href={`/game/${names[item.gameId].slug}`} className="min-w-0 truncate hover:underline">{names[item.gameId].name}</Link>
            ) : (
              <span className="min-w-0 truncate text-muted">A game you own</span>
            )}
            <span className="shrink-0 text-xs text-muted">
              <span className="font-semibold tabular-nums text-text">{money(item.perHour, currency, { whole: item.perHour >= 10 ** currencyDigits(currency) * 10 })}</span>/h · {Math.round(item.hours)} h
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SpendBreakdown({ summary, names }: { summary: SpendSummary; names: Record<number, GameName> }) {
  const [view, setView] = useState<"years" | "months">(summary.years.length >= 2 ? "years" : "months");
  const { currency } = summary;
  const perHourWhole = (summary.perHour?.value ?? 0) >= 10 ** currencyDigits(currency) * 10;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Figure label="Spent" value={<CountUp value={summary.total} format={(n) => money(n, currency)} />} note={`on ${summary.counted} ${summary.counted === 1 ? "game" : "games"}`} />
        <Figure label="Average" value={summary.average !== null ? money(summary.average, currency) : "—"} note={summary.free ? `${summary.free} free ${summary.free === 1 ? "claim" : "claims"} aside` : "per paid game"} />
        <Figure
          className="col-span-2 sm:col-span-1"
          label="Per hour played"
          value={summary.perHour ? money(summary.perHour.value, currency, { whole: perHourWhole }) : "—"}
          note={summary.perHour ? `over ${Math.round(summary.perHour.hours)} h on ${summary.perHour.games} ${summary.perHour.games === 1 ? "game" : "games"}` : "log hours to see it"}
        />
      </div>

      <div>
        <div role="tablist" aria-label="Spending by" className="mb-3 inline-flex gap-1 rounded-full bg-fg/[0.06] p-1">
          {(["years", "months"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={cn("press min-h-8 rounded-full px-3 text-[12px] font-semibold coarse:min-h-11", view === key ? "bg-fg/[0.14] text-text" : "text-muted fine:hover:text-text")}
            >
              {key === "years" ? "By year" : "Last 12 months"}
            </button>
          ))}
        </div>
        <Bars key={view} buckets={view === "years" ? summary.years : summary.months} currency={currency} />
      </div>

      {(summary.vsLowest || summary.vsFull) && (
        <div className="rounded-2xl bg-fg/[0.04] p-4 text-sm leading-relaxed text-muted">
          {summary.vsFull && summary.vsFull.saved > 0 && (
            <p>
              Buying on sale saved you <span className="font-display text-xl font-bold text-mint">{money(summary.vsFull.saved, currency)}</span> against the full prices we&apos;ve seen for {summary.vsFull.games} {summary.vsFull.games === 1 ? "game" : "games"}.
            </p>
          )}
          {summary.vsLowest && (
            <p className={cn(summary.vsFull && summary.vsFull.saved > 0 && "mt-1.5")}>
              {summary.vsLowest.overpaid > 0
                ? <>You paid <span className="font-semibold text-text">{money(summary.vsLowest.overpaid, currency)}</span> more than the lowest prices we&apos;ve seen</>
                : <>You paid no more than the lowest prices we&apos;ve seen</>}
              {" "}— {summary.vsLowest.atLowest} of {summary.vsLowest.games} bought at (or within 2% of) the low.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <ValueList title="Best value" items={summary.bestValue} names={names} currency={currency} />
        <ValueList title="Most per hour" items={summary.worstValue} names={names} currency={currency} />
      </div>

      <div className="sr-only">
        <table>
          <caption>Spending by year</caption>
          <thead><tr><th scope="col">Year</th><th scope="col">Spent</th><th scope="col">Games</th></tr></thead>
          <tbody>{summary.years.map((bucket) => <tr key={bucket.key}><th scope="row">{bucket.label}</th><td>{money(bucket.value, currency)}</td><td>{bucket.purchases}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Figure({ label, value, note, className }: { label: string; value: React.ReactNode; note?: string; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-2xl bg-fg/[0.045] p-3.5", className)}>
      <p className="truncate text-[12px] font-medium text-muted">{label}</p>
      <p className="mt-1 truncate font-display text-[22px] font-bold leading-none tabular-nums sm:text-[24px]">{value}</p>
      {note && <p className="mt-1 truncate text-[11px] text-faint">{note}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Library value
 * ------------------------------------------------------------------------ */

const LINE_HEIGHT = 150;

/**
 * Value of the owned library at each month's end, as an area. Months whose
 * value rests mostly on today's prices (no observation that early) are
 * drawn dashed, so the honest part of the line looks different from the
 * reconstructed part.
 */
export function LibraryValueChart({ value, currency, paid }: { value: LibraryValue; currency: string; paid: number | null }) {
  const motionOn = useChartMotion();
  const clipId = useId();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [hover, setHover] = useState<number | null>(null);
  const points = value.points;
  const shown = hover ?? points.length - 1;
  const max = Math.max(1, ...points.map((point) => point.value)) * 1.1;
  const inset = 4;
  const x = (index: number) => inset + (points.length <= 1 ? (width - inset * 2) / 2 : (index / (points.length - 1)) * (width - inset * 2));
  const y = (amount: number) => LINE_HEIGHT - (amount / max) * LINE_HEIGHT;
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.value)}`).join(" ");
  const area = points.length ? `${line} L${x(points.length - 1)},${LINE_HEIGHT} L${x(0)},${LINE_HEIGHT} Z` : "";
  const firstObserved = points.findIndex((point) => point.observed >= 0.5);
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - rect.left - inset) / Math.max(1, width - inset * 2)) * (points.length - 1))));
  };
  const point = points[shown];

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <Figure label="Worth today" value={<CountUp value={value.current} format={(n) => money(n, currency)} />} note={`${value.priced} priced ${value.priced === 1 ? "game" : "games"}`} />
        <Figure
          label="You paid"
          value={paid !== null ? money(paid, currency) : "—"}
          note={paid !== null ? (paid > 0 ? `${value.current >= paid ? "worth" : "now"} ${Math.round((value.current / paid) * 100)}% of that` : "all free") : "record prices to compare"}
        />
      </div>

      {points.length >= 2 && point && (
        <>
          <Readout className="min-h-0 py-2">
            <p className="text-sm">
              <span className="font-semibold">{point.label}</span>
              <span className="text-muted"> · {money(point.value, currency)} for {point.games} {point.games === 1 ? "game" : "games"}</span>
              <span className="block text-[11px] text-faint">
                {point.observed >= 0.95 ? "All at prices we observed then." : point.observed > 0 ? `${Math.round(point.observed * 100)}% at prices we observed then; the rest at today's.` : "At today's prices."}
              </span>
            </p>
          </Readout>
          <div
            ref={ref}
            className="relative touch-pan-y select-none"
            style={{ height: LINE_HEIGHT + 20 }}
            onPointerMove={(event) => setHover(pick(event))}
            onPointerDown={(event) => setHover(pick(event))}
            onPointerLeave={(event) => event.pointerType === "mouse" && setHover(null)}
            aria-hidden
          >
            {width > 0 && (
              <svg width={width} height={LINE_HEIGHT} className="block overflow-visible">
                <defs>
                  <clipPath id={clipId}>
                    <motion.rect x={0} y={-4} height={LINE_HEIGHT + 8} initial={{ width: 0 }} animate={{ width: inView || !motionOn ? width : 0 }} transition={drawTransition(motionOn, { duration: 1.1, ease: DRAW_EASE })} />
                  </clipPath>
                  <linearGradient id={`${clipId}-fill`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--viz-3)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--viz-3)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {[0.5, 1].map((share) => (
                  <line key={share} x1={0} x2={width} y1={LINE_HEIGHT - share * (LINE_HEIGHT / 1.1)} y2={LINE_HEIGHT - share * (LINE_HEIGHT / 1.1)} stroke="var(--color-line)" />
                ))}
                {paid !== null && paid > 0 && paid < max && (
                  <g>
                    <line x1={0} x2={width} y1={y(paid)} y2={y(paid)} stroke="var(--color-text)" strokeOpacity={0.5} strokeDasharray="3 4" />
                    <text x={width - 2} y={y(paid) - 5} textAnchor="end" fontSize={10} fill="currentColor" className="text-faint">You paid</text>
                  </g>
                )}
                <g clipPath={`url(#${clipId})`}>
                  <path d={area} fill={`url(#${clipId}-fill)`} />
                  {/* Reconstructed months dashed, observed months solid. */}
                  <path d={line} fill="none" stroke="var(--viz-3)" strokeWidth={2} strokeDasharray={firstObserved === 0 ? undefined : "4 4"} strokeLinejoin="round" />
                  {firstObserved > 0 && (
                    <path
                      d={points.slice(firstObserved).map((p, i) => `${i ? "L" : "M"}${x(firstObserved + i)},${y(p.value)}`).join(" ")}
                      fill="none"
                      stroke="var(--viz-3)"
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                  )}
                </g>
                {hover !== null && (
                  <g>
                    <line x1={x(hover)} x2={x(hover)} y1={0} y2={LINE_HEIGHT} stroke="var(--color-text)" strokeOpacity={0.6} />
                    <circle cx={x(hover)} cy={y(points[hover].value)} r={4} fill="var(--color-text)" stroke="var(--viz-surface)" strokeWidth={2} />
                  </g>
                )}
              </svg>
            )}
            <div className="absolute inset-x-0 bottom-0 flex justify-between text-[10px] tabular-nums text-faint">
              <span>{points[0].label}</span>
              <span>{points[points.length - 1].label}</span>
            </div>
          </div>
        </>
      )}

      <div className="sr-only">
        <table>
          <caption>Library value by month</caption>
          <thead><tr><th scope="col">Month</th><th scope="col">Value</th><th scope="col">Games</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.key}><th scope="row">{p.label}</th><td>{money(p.value, currency)}</td><td>{p.games}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
