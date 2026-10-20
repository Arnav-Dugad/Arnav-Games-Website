"use client";

/**
 * "Will the date hold?" for an upcoming game: a 0–100 confidence that the
 * announced date holds, its label, and the signals behind it
 * (`release-confidence.ts`), including the developer's own record once the
 * page's extras arrive.
 *
 * Client-only by construction: it reads today's date and the extras, so the
 * server (and the hydrating render) show the skeleton, and the card fills in
 * after mount — no server/client mismatch. The skeleton matches the card's
 * collapsed height, so filling in doesn't move the page.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { useNearId } from "@/hooks";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import { releaseConfidence, usableStudioRecord, type DatePrecision, type ReleaseConfidence } from "@/lib/games/release-confidence";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { InfoTip } from "./InfoTip";
import { useGameExtras } from "./live";

const ID = "release-confidence";
/** Reasons shown before "Show all". */
const VISIBLE = 3;

const TONE: Record<ReleaseConfidence["tone"], { text: string; stroke: string }> = {
  good: { text: "text-mint", stroke: "var(--color-mint)" },
  fair: { text: "text-gold", stroke: "var(--color-gold)" },
  poor: { text: "text-flare", stroke: "var(--color-flare)" },
};

const noop = () => () => {};

export interface ReleaseConfidenceProps {
  precision: DatePrecision;
  /** The day, or the window's last day. */
  date: string;
  /** "Mar 5, 2027" / "Q1 2027", as the page shows it. */
  dateLabel: string;
  delays: number;
  status?: "alpha" | "beta" | "early-access" | "rumored" | null;
  publishers: string[];
  follows: number;
  /** Whether the page asked the extras for a developer record. */
  hasDevelopers: boolean;
}

export default function ReleaseConfidenceCard(props: ReleaseConfidenceProps) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const near = useNearId(ID, "600px");
  const extras = useGameExtras(near && props.hasDevelopers);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  // Wait for the studio record when one was asked for; a failed extras request computes without it.
  const studioPending = props.hasDevelopers && (extras === null ? false : extras.status === "loading");
  const studio = extras?.status === "ready" ? extras.data.studios?.[0] ?? null : null;

  const confidence = useMemo(() => {
    const record = studio ? usableStudioRecord(studio.reliability, today) : null;
    return releaseConfidence({
      today,
      precision: props.precision,
      date: props.date,
      delays: props.delays,
      studio: studio && record ? { name: studio.name, ...record } : null,
      status: props.status ?? null,
      publishers: props.publishers,
      follows: props.follows,
    });
  }, [today, props.precision, props.date, props.delays, props.status, props.publishers, props.follows, studio]);

  if (mounted && !studioPending && !confidence) return <div id={ID} hidden />;

  return (
    <section id={ID} aria-labelledby={`${ID}-title`} className="glass rounded-3xl p-5 sm:p-6">
      {!mounted || studioPending || !confidence ? <CardSkeleton /> : <Card confidence={confidence} dateLabel={props.dateLabel} />}
    </section>
  );
}

function Card({ confidence, dateLabel }: { confidence: ReleaseConfidence; dateLabel: string }) {
  const [all, setAll] = useState(false);
  const calm = useCalmMotion();
  const tone = TONE[confidence.tone];
  const reasons = all ? confidence.reasons : confidence.reasons.slice(0, VISIBLE);
  return (
    <>
      <div className="flex items-center gap-4">
        <Gauge score={confidence.score} stroke={tone.stroke} calm={calm} />
        <div className="min-w-0">
          <h3 id={`${ID}-title`} className="flex items-center gap-1.5 text-[17px] font-semibold text-text">
            Will the date hold? <InfoTip topic="releaseConfidence" />
          </h3>
          <p className="mt-0.5 text-[14px] leading-snug text-muted">
            <span className={cn("font-semibold", tone.text)}>{confidence.label}</span> that {dateLabel} holds
          </p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {reasons.map((reason) => (
          <li key={reason.text} className="flex gap-2.5 text-[13px] leading-snug text-muted">
            <span
              aria-hidden
              className={cn(
                "mt-px inline-flex h-[18px] min-w-9 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-bold tabular-nums",
                reason.effect > 0 ? "bg-mint/12 text-mint" : reason.effect < 0 ? "bg-flare/12 text-flare" : "bg-fg/[0.06] text-faint",
              )}
            >
              {reason.effect > 0 ? `+${reason.effect}` : reason.effect < 0 ? `−${Math.abs(reason.effect)}` : "·"}
            </span>
            <span className="min-w-0">
              <span className="sr-only">{reason.effect > 0 ? `Adds ${reason.effect}: ` : reason.effect < 0 ? `Takes ${Math.abs(reason.effect)}: ` : ""}</span>
              {reason.text}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-[12px] leading-snug text-faint">A rule of thumb from public signals and our own delay history — not word from the publisher.</p>
        {confidence.reasons.length > VISIBLE && (
          <button
            type="button"
            aria-expanded={all}
            onClick={() => {
              haptic("selection");
              setAll((value) => !value);
            }}
            className="press -mr-1 inline-flex min-h-10 items-center gap-1 rounded-full px-1 text-[13px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))] coarse:min-h-11"
          >
            {all ? "Fewer reasons" : `All ${confidence.reasons.length} reasons`}
            <ChevronDown size={14} aria-hidden className={cn(!calm && "transition-transform duration-300", all && "rotate-180")} />
          </button>
        )}
      </div>
    </>
  );
}

/** A 60px ring: the share filled is the score; colour is the label's. */
function Gauge({ score, stroke, calm }: { score: number; stroke: string; calm: boolean }) {
  const size = 60;
  const width = 6;
  const radius = (size - width) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative grid h-[60px] w-[60px] shrink-0 place-items-center" role="img" aria-label={`Confidence ${score} out of 100`}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="color-mix(in oklab, var(--color-fg) 9%, transparent)" strokeWidth={width} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          className={cn(!calm && "animate-[gauge-in_900ms_var(--ease-apple)_both]")}
          style={{ ["--gauge-from" as string]: String(circumference) }}
        />
      </svg>
      <span aria-hidden className="font-display text-[19px] font-bold tabular-nums text-text">
        {score}
      </span>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div aria-hidden>
      <div className="flex items-center gap-4">
        <Skeleton className="h-[60px] w-[60px] shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-44 rounded-full" />
          <Skeleton className="h-3.5 w-56 max-w-full rounded-full" />
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        <Skeleton className="h-3.5 w-full rounded-full" />
        <Skeleton className="h-3.5 w-11/12 rounded-full" />
        <Skeleton className="h-3.5 w-4/5 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-3 w-2/3 rounded-full" />
    </div>
  );
}
