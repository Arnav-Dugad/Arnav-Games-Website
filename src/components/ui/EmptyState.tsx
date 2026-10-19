import type { ReactNode } from "react";
import { Button } from "./Button";
import { cn } from "@/lib/utils/cn";

/**
 * The one empty state.
 *
 * Every "nothing here" across the site was previously bespoke, which meant they
 * drifted in tone and several said nothing useful — "No results" tells a reader
 * what happened but not what to do. This enforces the shape that works: name
 * what's missing, say why in one line, and offer the single most likely next
 * action.
 *
 * `tone` separates the two cases that deserve different language. An *empty*
 * result is a normal outcome of the reader's own filters and should read
 * neutrally; an *unavailable* one is our problem, and saying so plainly beats
 * pretending the catalogue is simply small today.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  secondaryAction,
  tone = "empty",
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: { href?: string; onClick?: () => void; label: string };
  secondaryAction?: { href?: string; onClick?: () => void; label: string };
  tone?: "empty" | "unavailable";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-3xl border border-dashed px-6 py-16 text-center",
        tone === "unavailable" ? "border-flare/25 bg-flare/[0.04]" : "border-line",
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            "grid h-14 w-14 place-items-center rounded-2xl",
            tone === "unavailable" ? "bg-flare/10 text-flare" : "bg-fg/5 text-faint",
          )}
        >
          {icon}
        </span>
      )}
      <h2 className="mt-5 font-display text-lg font-bold">{title}</h2>
      {body && <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{body}</p>}

      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {action && (
            <Button href={action.href} onClick={action.onClick} size="sm">
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              href={secondaryAction.href}
              onClick={secondaryAction.onClick}
              variant="secondary"
              size="sm"
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
