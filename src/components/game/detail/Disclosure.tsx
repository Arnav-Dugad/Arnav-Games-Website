"use client";

/**
 * "Show more" for the game page's deep data: regional prices, release dates
 * by region, achievement detail, full requirements, the rest of a patch.
 *
 * Closed by default (progressive disclosure: the 20% people need is above
 * it). Contents mount on first open and stay mounted, so a closed disclosure
 * costs nothing — the regional price table isn't even fetched until asked
 * for. The height animates with a `grid-template-rows` 0fr → 1fr transition:
 * no measuring, no per-frame JS. A link to `#id` (e.g. the "Delayed 2×"
 * badge) opens it, since jumping to a closed box would show nothing.
 */

import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import type { HelpTopic } from "./glossary";
import { InfoTip } from "./InfoTip";

export function Disclosure({
  id,
  icon,
  title,
  subtitle,
  children,
  className,
  help,
  bare = false,
}: {
  id?: string;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** An ⓘ beside the title. It sits outside the toggle: a button can't hold a button. */
  help?: HelpTopic;
  children: ReactNode;
  className?: string;
  /** No panel of its own: for a disclosure inside an existing card. */
  bare?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelId = useId();
  const titleId = `${panelId}-title`;

  useEffect(() => {
    if (!id) return;
    const check = () => {
      if (window.location.hash === `#${id}`) {
        setMounted(true);
        setOpen(true);
      }
    };
    // Off the effect body: the first check runs a frame later.
    const frame = requestAnimationFrame(check);
    window.addEventListener("hashchange", check);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", check);
    };
  }, [id]);

  return (
    <div id={id} className={cn("scroll-mt-36", !bare && "glass overflow-hidden rounded-3xl", className)}>
      {/* The whole row toggles (the button's ::after covers it); the ⓘ sits above that layer. */}
      <div
        className={cn(
          "relative flex min-h-14 items-center gap-3 transition-colors fine:hover:bg-fg/[0.03]",
          bare ? "rounded-2xl py-2" : "px-5 py-3.5 sm:px-6",
        )}
      >
        {icon && (
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fg/[0.06] text-[var(--game-accent)]">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span id={titleId} className="text-[15px] font-semibold text-text">{title}</span>
            {help && (
              <span className="relative z-10 inline-flex">
                <InfoTip topic={help} />
              </span>
            )}
          </span>
          {subtitle && <span className="block text-[13px] text-muted">{subtitle}</span>}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-labelledby={titleId}
          onClick={() => {
            haptic("selection");
            setMounted(true);
            setOpen((value) => !value);
          }}
          className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-end gap-1.5 rounded-full text-[13px] font-medium text-muted after:absolute after:inset-0 after:content-['']"
        >
          <span aria-hidden className="hidden sm:inline">{open ? "Hide" : "Show"}</span>
          <ChevronDown
            size={17}
            aria-hidden
            // Unconditional: the global reduced-motion CSS (OS and in-app) squashes
            // the duration, and a JS-chosen class broke hydration for those readers.
            className={cn("shrink-0 text-faint transition-transform duration-300", open && "rotate-180")}
          />
        </button>
      </div>
      <div
        id={panelId}
        className="grid transition-[grid-template-rows] duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="min-h-0 overflow-hidden" inert={!open}>
          {mounted && <div className={cn(!bare && "border-t border-line px-5 pb-5 pt-4 sm:px-6")}>{children}</div>}
        </div>
      </div>
    </div>
  );
}
