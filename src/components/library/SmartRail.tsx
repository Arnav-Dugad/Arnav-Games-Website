import { Children, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/SectionHeading";
import { cn } from "@/lib/utils/cn";

/**
 * A titled, full-bleed rail for the collection pages: section title with a
 * quiet count, an optional "See all", an optional control row (segments,
 * filters) and then the covers. Shared so every shelf on the library reads
 * as one family.
 */
export function SmartRail({
  title,
  subtitle,
  count,
  onSeeAll,
  header,
  itemClassName = "w-[120px] sm:w-[156px]",
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  count?: number;
  onSeeAll?: () => void;
  header?: ReactNode;
  itemClassName?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <Container className="mb-3 flex items-end justify-between gap-3 sm:mb-4">
        <div className="min-w-0">
          <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">
            {title}
            {count !== undefined && <> <span className="text-[17px] font-semibold tabular-nums text-faint sm:text-[20px]">{count}</span></>}
          </h2>
          {subtitle && <p className="text-[13px] text-muted sm:text-[15px]">{subtitle}</p>}
        </div>
        {onSeeAll && (
          <button type="button" onClick={onSeeAll} className="press group inline-flex min-h-11 shrink-0 items-center gap-1 text-[15px] font-medium text-brand-soft fine:hover:text-text">
            See all
            {/* Same arrow as every other section's "See all" (SectionHeading, search). */}
            <ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </Container>
      {header}
      <ul className="snap-rail rail-gutter gap-3 pb-2 sm:gap-4">
        {Children.map(children, (child) => (
          <li className={cn("shrink-0", itemClassName)}>{child}</li>
        ))}
      </ul>
    </section>
  );
}

/** Pill row used above a rail to switch what it shows (platform, device…). */
export function RailTabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <Container className="mb-4">
      <div role="group" aria-label={label} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(option.value)}
              className={cn(
                "press inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors coarse:min-h-11",
                on ? "bg-fg text-bg" : "bg-fg/[0.06] text-muted fine:hover:bg-fg/[0.1] fine:hover:text-text",
              )}
            >
              {option.icon}
              {option.label}
              {option.count !== undefined && <span className={cn("tabular-nums", on ? "text-bg/60" : "text-faint")}>{option.count}</span>}
            </button>
          );
        })}
      </div>
    </Container>
  );
}
