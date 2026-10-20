import type { ReactNode } from "react";
import { TextReveal } from "@/components/motion/text";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "./SectionHeading";
import { cn } from "@/lib/utils/cn";

/**
 * Shared masthead for every non-home route. Keeps page entrances consistent so
 * navigating between sections feels like one product rather than a set of
 * separately-designed screens.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        // Clears the header wherever it ends — in the installed app that
        // includes the status bar, which a flat pt-24 let the title slide under.
        "relative isolate overflow-hidden pb-6 pt-[calc(var(--chrome-top)+2rem)] sm:pb-8 lg:pb-12 lg:pt-32",
        className,
      )}
    >
      {/* No backdrop of its own: the site-wide ambient drift (AmbientBackdrop)
          shows through, so mastheads no longer stack a second aurora — or a
          fade-to-black band — over it. */}

      <Container>
        {eyebrow && (
          <Reveal>
            <p className="mb-2 text-[13px] font-semibold text-brand-soft sm:text-[15px]">
              {eyebrow}
            </p>
          </Reveal>
        )}

        <TextReveal
          as="h1"
          text={title}
          // The design system's page large title (34/48px), the same scale
          // search, compare and offline set by hand — so every route's title
          // sits at one size and one top offset.
          className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-5xl"
        />

        {description && (
          <Reveal delay={0.15}>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-[17px]">
              {description}
            </p>
          </Reveal>
        )}

        {children && <Reveal delay={0.22} className="mt-7">{children}</Reveal>}
      </Container>
    </header>
  );
}
