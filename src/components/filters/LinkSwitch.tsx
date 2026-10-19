"use client";

/**
 * An iOS switch whose state lives in the URL.
 *
 * It is a real link, so it works before hydration and can be opened in a new
 * tab, but it is announced and drawn as a switch because that's what it is
 * to the reader: an on/off setting for the list below. The knob flips
 * optimistically on tap — the server render behind it can take a moment.
 */

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";

export function LinkSwitch({
  href,
  checked,
  label,
  description,
  className,
}: {
  href: string;
  checked: boolean;
  label: string;
  description?: string;
  className?: string;
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [lastChecked, setLastChecked] = useState(checked);
  if (checked !== lastChecked) {
    setLastChecked(checked);
    setOptimistic(null);
  }
  const on = optimistic ?? checked;

  return (
    <Link
      href={href}
      scroll={false}
      role="switch"
      aria-checked={on}
      onClick={() => setOptimistic(!checked)}
      className={cn(
        "press group inline-flex min-h-11 items-center gap-3 rounded-full border border-fg/[0.08] bg-fg/[0.05] py-1.5 pl-4 pr-1.5 text-left transition-colors fine:hover:bg-fg/[0.08]",
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-tight text-text">{label}</span>
        {description && (
          <span className="block text-[11px] leading-tight text-faint">{description}</span>
        )}
      </span>
      <span
        aria-hidden
        className={cn(
          "relative h-[28px] w-[46px] shrink-0 rounded-full transition-colors duration-300 ease-[var(--ease-apple)]",
          on ? "bg-mint" : "bg-fg/[0.16]",
        )}
      >
        <span
          className={cn(
            "absolute left-[2px] top-[2px] h-6 w-6 rounded-full bg-white shadow-[0_2px_6px_#00000059] transition-transform duration-300 ease-[var(--ease-apple)]",
            on && "translate-x-[18px]",
          )}
        />
      </span>
    </Link>
  );
}
