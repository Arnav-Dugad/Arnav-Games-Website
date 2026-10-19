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
          <p className="mb-1.5 text-[13px] font-semibold tracking-[-0.005em] text-brand-soft sm:text-sm">
            {eyebrow}
          </p>
        )}
        <h2 className="text-[26px] font-bold leading-tight sm:text-3xl lg:text-[2.25rem]">{title}</h2>
        {description && (
          <p className="mt-1.5 max-w-xl text-[15px] leading-snug text-muted sm:text-[17px]">{description}</p>
        )}
      </div>

      {href && (
        <Link
          href={href}
          className={cn(
            // Phones: App Store-style accent text link. Desktop: a glass pill.
            "press group inline-flex shrink-0 items-center gap-1 text-[15px] font-medium text-brand-soft",
            "sm:gap-2 sm:rounded-full sm:border sm:border-white/10 sm:bg-white/[0.06] sm:px-4 sm:py-2.5 sm:text-sm sm:text-text",
            "transition-colors duration-300 sm:hover:bg-white/[0.11]",
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
