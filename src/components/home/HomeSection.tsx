import type { ReactNode } from "react";
import { Container, SectionHeading } from "@/components/ui/SectionHeading";
import { cn } from "@/lib/utils/cn";

/**
 * One homepage shelf: the standard section rhythm, a heading with its
 * "See all", and the `data-track-src` attribution hook.
 *
 * `data-track-src="home:<id>"` is read by the analytics layer to attribute a
 * click (or a follow) to the shelf it came from, so every shelf must carry
 * one — that is the main reason this wrapper exists rather than each shelf
 * hand-rolling a `<section>`.
 *
 * Content is passed as `children` *outside* the heading's `Container`: rails
 * are full-bleed and align themselves with `.rail-gutter`; grids that want
 * the column wrap themselves in `Container`.
 */
export function HomeSection({
  id,
  eyebrow,
  title,
  description,
  href,
  linkLabel,
  aside,
  children,
  className,
  headingClassName,
}: {
  /** Analytics id, e.g. "charts" → `data-track-src="home:charts"`. */
  id: string;
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  href?: string;
  linkLabel?: string;
  /** Rendered under the heading inside the column — e.g. a segmented control. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  headingClassName?: string;
}) {
  return (
    <section
      data-track-src={`home:${id}`}
      aria-labelledby={`home-${id}-title`}
      className={cn("py-9 sm:py-12 lg:py-14", className)}
    >
      <Container>
        <SectionHeading
          eyebrow={eyebrow}
          title={<span id={`home-${id}-title`}>{title}</span>}
          description={description}
          href={href}
          linkLabel={linkLabel}
          className={headingClassName}
        />
        {aside}
      </Container>
      <div className="mt-6 sm:mt-7">{children}</div>
    </section>
  );
}
