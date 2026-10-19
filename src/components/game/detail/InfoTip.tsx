"use client";

/**
 * The ⓘ next to a metric: tap or click for a two-line explanation.
 *
 * A popover rather than a sheet on phones too — the answer is two sentences,
 * and a bottom sheet would carry the reader away from the number they asked
 * about. The visible glyph is small (it sits beside 11px labels), so the hit
 * area is grown with a pseudo-element to a 44px square without moving
 * anything around it.
 */

import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import { HELP, type HelpTopic } from "./glossary";

export function InfoTip({ topic, className }: { topic: HelpTopic; className?: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const help: { title: string; body: string; source?: string } = HELP[topic];

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`About “${help.title}”`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={(event) => {
          // Info buttons sit inside links and summary rows; the tap is theirs alone.
          event.preventDefault();
          event.stopPropagation();
          haptic("selection");
          setOpen((value) => !value);
        }}
        className={cn(
          "relative inline-grid h-4 w-4 shrink-0 place-items-center rounded-full align-middle text-faint transition-colors fine:hover:text-text",
          "before:absolute before:-inset-3.5 before:content-['']",
          open && "text-text",
          className,
        )}
      >
        <Info size={14} strokeWidth={2.2} aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={300} label={help.title}>
        <div className="px-3 py-2.5 normal-case tracking-normal">
          <p className="text-[14px] font-semibold text-text">{help.title}</p>
          <p className="mt-1 text-[13px] font-normal leading-snug text-muted">{help.body}</p>
          {help.source && <p className="mt-2 text-[11px] font-normal text-faint">Source: {help.source}</p>}
        </div>
      </Popover>
    </>
  );
}
