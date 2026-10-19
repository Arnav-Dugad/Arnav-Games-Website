import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The one heading treatment for every block on the game page.
 *
 * The page used to give each section its own voice — an uppercase eyebrow,
 * a 36px black title and a marketing subtitle ("See the world in motion",
 * "The complete game record") — so ten sections read as ten competing
 * heroes. Now they share the design system's section scale: a quiet accent
 * eyebrow, a 22/28px title that says what's there, and an optional one-line
 * description. `aside` holds the section's single control (a range picker,
 * a "Change region" link) on the right on desktop, below on phones.
 */
export function DetailHeading({
  eyebrow,
  icon,
  title,
  description,
  aside,
  titleId,
  className,
}: {
  eyebrow?: string;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  titleId?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6", className)}>
      <div className="min-w-0">
        {eyebrow && (
          // The accent is mixed toward the text colour: raw cover accents can
          // fall just short of 4.5:1 at 13px on the light theme.
          <p className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))]">
            {icon && <span aria-hidden className="shrink-0">{icon}</span>}
            {eyebrow}
          </p>
        )}
        <h2 id={titleId} className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-text sm:text-[28px]">
          {title}
        </h2>
        {description && <p className="mt-1.5 max-w-2xl text-[15px] leading-snug text-muted">{description}</p>}
      </div>
      {aside && <div className="min-w-0 shrink-0">{aside}</div>}
    </div>
  );
}

export function DetailSection({
  id,
  children,
  className,
  label,
  ...heading
}: {
  id: string;
  children: ReactNode;
  className?: string;
  /** Accessible name when the heading is visually omitted. */
  label?: string;
} & Partial<Parameters<typeof DetailHeading>[0]>) {
  const titleId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={heading.title ? titleId : undefined}
      aria-label={heading.title ? undefined : label}
      className={cn("min-w-0 scroll-mt-36", className)}
    >
      {heading.title && <DetailHeading {...heading} title={heading.title} titleId={titleId} />}
      <div className={heading.title ? "mt-5 sm:mt-6" : undefined}>{children}</div>
    </section>
  );
}
