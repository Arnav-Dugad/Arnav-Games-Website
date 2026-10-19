"use client";

/**
 * The reader's PC judged against Steam's requirements (`evaluateHardware`).
 *
 * Its own module, loaded with `next/dynamic({ ssr: false })` by the game
 * page and the compare table: a verdict only exists once the browser has
 * read the reader's specs from this device, so the server never renders one
 * — and keeping the GPU/CPU score tables out of the server render keeps them
 * out of the Worker bundle too.
 */

import { CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import { evaluateHardware } from "@/lib/games/hardware";
import type { PcRequirements, UserPcSpecs } from "@/lib/games/types";
import { HardwareChip } from "./PcSection";

export function HardwareVerdictView({
  specs,
  requirements,
  variant = "full",
}: {
  specs: UserPcSpecs;
  requirements: PcRequirements;
  /** "cell": chip and sentence only, for the compare table. */
  variant?: "full" | "cell";
}) {
  const verdict = evaluateHardware(specs, requirements);

  if (variant === "cell") {
    return (
      <>
        <HardwareChip kind={verdict.kind} />
        <span className="mt-1.5 block text-[13px] leading-snug text-muted">{verdict.summary}</span>
      </>
    );
  }

  return (
    <>
      {verdict.kind === "great" && (
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 -z-10 h-56 w-56 rounded-full bg-mint/20 blur-3xl" />
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <HardwareChip kind={verdict.kind} className="w-fit" />
        <p className="text-[15px] leading-snug text-muted">{verdict.summary}</p>
      </div>
      {verdict.parts.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-2xl border border-line" aria-label="Part by part">
          {verdict.parts.map((part) => (
            <li key={part.part} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
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
