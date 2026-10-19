"use client";

import Link, { useLinkStatus } from "next/link";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Real anchor-based pagination — crawlable, middle-clickable and works without
 * JS. Page links carry the full existing filter set.
 *
 * Every link reports its own pending state, which is not decoration. These
 * destinations are dynamic and each one runs a fresh provider query, so a page
 * change can take several seconds; without feedback the click looks ignored and
 * people conclude pagination is broken and click again. `loading.tsx` does not
 * cover this case — it fires for a route change, not for a search-param change
 * within the same route — which is exactly the gap `useLinkStatus` exists for.
 */
export function Pagination({
  page,
  hasNext,
  totalPages,
  basePath,
  params,
}: {
  page: number;
  hasNext: boolean;
  /** Omit when the total is unknown; only prev/next render. */
  totalPages?: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const hrefFor = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    if (target > 1) search.set("page", String(target));
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  if (page === 1 && !hasNext) return null;

  const windowed = totalPages ? pageWindow(page, totalPages) : [];

  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-2">
      <PageLink
        href={hrefFor(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="px-4 sm:px-3"
      >
        <ChevronLeft size={16} />
        <span className="hidden sm:inline">Prev</span>
      </PageLink>

      {/* Phones get a compact "Page 2 of 63" between the arrows; the full
          numbered strip doesn't fit a 320px screen. */}
      <p className="min-w-0 px-2 text-center text-sm text-muted tabular-nums sm:hidden" aria-live="polite">
        Page <span className="font-semibold text-text">{page.toLocaleString("en-US")}</span>
        {totalPages ? <> of {totalPages.toLocaleString("en-US")}</> : null}
      </p>

      <ul className="hidden items-center gap-1.5 sm:flex">
        {windowed.map((entry, i) =>
          entry === "gap" ? (
            <li key={`gap-${i}`} className="px-1 text-faint">
              …
            </li>
          ) : (
            <li key={entry}>
              <PageLink
                href={hrefFor(entry)}
                active={entry === page}
                aria-label={`Page ${entry}`}
                aria-current={entry === page ? "page" : undefined}
                className="w-11 justify-center tabular-nums"
              >
                {entry}
              </PageLink>
            </li>
          ),
        )}
      </ul>

      <PageLink
        href={hrefFor(page + 1)}
        disabled={!hasNext}
        aria-label="Next page"
        className="px-4 sm:px-3"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight size={16} />
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  children,
  disabled,
  active,
  className,
  ...rest
}: {
  href: string;
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
  className?: string;
} & React.AriaAttributes) {
  const classes = cn(
    // `relative` anchors the pending overlay to the link itself.
    "press relative inline-flex min-h-11 items-center gap-1 overflow-hidden rounded-full border text-sm font-medium transition-colors duration-200",
    active
      ? "border-brand/50 bg-brand/25 text-text shadow-[inset_0_1px_0_#ffffff1f]"
      : "border-fg/[0.09] bg-fg/[0.06] text-muted fine:hover:bg-fg/[0.1] fine:hover:text-text",
    disabled && "pointer-events-none opacity-35",
    className,
  );

  if (disabled) {
    return (
      // `role="link"` makes the label and disabled state valid ARIA on a span.
      <span role="link" aria-disabled="true" className={classes} {...rest}>
        {children}
      </span>
    );
  }

  return (
    <Link href={href} className={classes} scroll {...rest}>
      <PendingOverlay />
      {children}
    </Link>
  );
}

/**
 * Covers its link while that link's navigation is in flight.
 *
 * Must be a child of the `<Link>` — `useLinkStatus` reads the nearest link's
 * state from context, so a sibling would always report idle.
 */
function PendingOverlay() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      aria-hidden
      className="absolute inset-0 grid place-items-center rounded-full bg-brand/25 backdrop-blur-[1px]"
    >
      <Loader2 size={14} className="animate-spin text-text" />
    </span>
  );
}

/** First, last, current ±1, with gaps collapsed. */
function pageWindow(page: number, total: number): (number | "gap")[] {
  const capped = Math.min(total, 500);
  if (capped <= 7) return Array.from({ length: capped }, (_, i) => i + 1);

  const out: (number | "gap")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(capped - 1, page + 1);

  if (start > 2) out.push("gap");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < capped - 1) out.push("gap");
  out.push(capped);
  return out;
}
