import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils/cn";

interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  href,
  linkLabel = "See all",
  className,
}: SectionHeadingProps) {
  return (
    <Reveal className={cn("flex items-end justify-between gap-6", className)} amount={0.4}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[13px] font-semibold text-brand-soft">{eyebrow}</p>
        )}
        {/* The design system's one section scale (22/28px), shared with the
            game page's DetailHeading so a shelf on the home page and a block
            on a detail page read as the same kind of thing. */}
        <h2 className="text-[22px] font-bold leading-tight tracking-[-0.02em] sm:text-[28px]">{title}</h2>
        {description && (
          <p className="mt-1.5 max-w-xl text-[15px] leading-snug text-muted sm:text-[17px]">{description}</p>
        )}
      </div>

      {href && (
        <Link
          href={href}
          className={cn(
            // Phones: App Store-style accent text link. Desktop: a glass pill.
            // The phone text link is 23px tall; the invisible `after` slop
            // makes it a 44px target without moving the heading's baseline.
            "press group relative inline-flex shrink-0 items-center gap-1 text-[15px] font-medium text-brand-soft",
            "after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] sm:after:hidden",
            "sm:gap-2 sm:rounded-full sm:border sm:border-fg/10 sm:bg-fg/[0.06] sm:px-4 sm:py-2.5 sm:text-sm sm:text-text",
            "transition-colors duration-300 sm:hover:bg-fg/[0.11]",
          )}
        >
          {linkLabel}
          <ArrowRight
            size={15}
            className="transition-transform duration-300 group-hover:translate-x-0.5"
          />
        </Link>
      )}
    </Reveal>
  );
}

/** Full-bleed section wrapper with the page's standard gutters. */
export function Section({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("py-9 sm:py-12 lg:py-16", className)}>
      {children}
    </section>
  );
}

export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[1400px] px-4 lg:px-6 xl:px-10", className)}>
      {children}
    </div>
  );
}
