"use client";

/**
 * The reader's PC judged against Steam's requirements (`evaluateHardware`).
 *
 * Its own module, loaded with `next/dynamic({ ssr: false })` by the game
 * page and the compare table: a verdict only exists once the browser has
 * read the reader's specs from this device, so the server never renders one
 * — and keeping the GPU/CPU score tables out of the server render keeps them
 * out of the Worker bundle too.
 *
 * Reading order: the chip and one sentence ("Runs well at 1080p High; 1440p
 * High is a stretch"), then how each resolution or preset should go, then
 * the caveats that change expectations, then the part-by-part table.
 */

import { CircleAlert, CircleCheck, CircleHelp, Info } from "lucide-react";
import { evaluateHardware } from "@/lib/games/hardware";
import type { HardwareOutlook, PcRequirements, UserPcSpecs } from "@/lib/games/types";
import { cn } from "@/lib/utils/cn";
import { HardwareChip } from "./PcSection";

const LEVEL: Record<HardwareOutlook["level"], { label: string; bars: number; tone: string }> = {
  great: { label: "Runs well", bars: 4, tone: "bg-mint" },
  ok: { label: "Playable", bars: 3, tone: "bg-gold" },
  lower: { label: "A stretch", bars: 2, tone: "bg-[color-mix(in_oklab,var(--color-gold)_55%,var(--color-flare))]" },
  no: { label: "Out of reach", bars: 1, tone: "bg-flare" },
};

export function HardwareVerdictView({
  specs,
  requirements,
  variant = "full",
  onRefine,
}: {
  specs: UserPcSpecs;
  requirements: PcRequirements;
  /** "cell": chip and sentence only, for the compare table. */
  variant?: "full" | "cell";
  /** Opens My PC, offered when the screen or goal is missing. */
  onRefine?: () => void;
}) {
  const verdict = evaluateHardware(specs, requirements);

  if (variant === "cell") {
    return (
      <>
        <HardwareChip kind={verdict.kind} />
        <span className="mt-1.5 block text-[13px] leading-snug text-muted">{verdict.headline ?? verdict.summary}</span>
      </>
    );
  }

  return (
    <>
      {verdict.kind === "great" && (
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 -z-10 h-56 w-56 rounded-full bg-mint/20 blur-3xl" />
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <HardwareChip kind={verdict.kind} className="w-fit" />
        <div className="min-w-0">
          <p className="text-[15px] font-medium leading-snug text-text">{verdict.headline ?? verdict.summary}</p>
          {verdict.headline && <p className="mt-0.5 text-[13px] leading-snug text-muted">{verdict.summary}</p>}
        </div>
      </div>

      {verdict.outlook && verdict.outlook.length > 0 && (
        <ul className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="How it should run">
          {verdict.outlook.map((row) => {
            const level = LEVEL[row.level];
            return (
              <li
                key={`${row.label}-${row.fps}`}
                className={cn("rounded-2xl border px-3.5 py-3", row.goal ? "border-brand/40 bg-brand/[0.06]" : "border-line bg-fg/[0.02]")}
              >
                <p className="flex items-baseline justify-between gap-2">
                  <span className="text-[14px] font-semibold text-text">{row.label}</span>
                  <span className="text-[12px] tabular-nums text-muted">{row.fps} fps</span>
                </p>
                <span aria-hidden className="mt-2 flex gap-1">
                  {[1, 2, 3, 4].map((bar) => (
                    <span key={bar} className={cn("h-1.5 flex-1 rounded-full", bar <= level.bars ? level.tone : "bg-fg/10")} />
                  ))}
                </span>
                <p className="mt-1.5 text-[12px] font-medium text-muted">
                  {level.label}
                  {row.goal && <span className="text-brand-soft"> · your goal</span>}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {verdict.reasons && verdict.reasons.length > 0 && (
        <ul className="mt-4 space-y-2">
          {verdict.reasons.map((reason) => (
            <li key={reason} className="flex gap-2 text-[14px] leading-snug text-muted">
              <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-faint" />
              {reason}
            </li>
          ))}
        </ul>
      )}

      {onRefine && !specs.goal && !specs.display && verdict.kind !== "unknown" && (
        <button
          type="button"
          onClick={onRefine}
          className="press mt-4 inline-flex min-h-11 items-center rounded-full text-[14px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))] fine:hover:underline"
        >
          Add your screen and goal for a sharper answer
        </button>
      )}

      {verdict.parts.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-2xl border border-line" aria-label="Part by part">
          {verdict.parts.map((part) => (
            <li key={part.part} className="grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
              <span className="text-[12px] font-semibold text-faint">{part.part}</span>
              <span className="min-w-0">
                <span className="block break-words text-[14px] font-medium leading-snug text-text">{part.yours}</span>
                {part.needed && <span className="mt-0.5 block break-words text-[12px] leading-snug text-muted">Needs {part.needed}</span>}
              </span>
              <PartMark ok={part.ok} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PartMark({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-muted">
        <CircleHelp size={15} aria-hidden /> Unknown
      </span>
    );
  }
  return ok ? (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-mint">
      <CircleCheck size={15} aria-hidden /> Meets
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-flare">
      <CircleAlert size={15} aria-hidden /> Below
    </span>
  );
}
