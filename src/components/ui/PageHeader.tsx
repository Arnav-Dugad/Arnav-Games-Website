import type { ReactNode } from "react";
import { Aurora } from "@/components/motion/Aurora";
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
        "relative isolate overflow-hidden pb-6 pt-24 sm:pb-8 lg:pb-12 lg:pt-36",
        className,
      )}
    >
      <Aurora intensity="subtle" className="-z-10" />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-bg to-transparent"
      />

      <Container>
        {eyebrow && (
          <Reveal>
            <p className="mb-2.5 text-[13px] font-semibold tracking-[-0.005em] text-brand-soft sm:text-[15px]">
              {eyebrow}
            </p>
          </Reveal>
        )}

        <TextReveal
          as="h1"
          text={title}
          className="font-display text-[clamp(2.125rem,7vw,4rem)] font-bold leading-[1.04] tracking-[-0.032em]"
        />

        {description && (
          <Reveal delay={0.15}>
            <p className="mt-4 max-w-2xl text-[17px] leading-[1.47] text-muted sm:text-[19px]">
              {description}
            </p>
          </Reveal>
        )}

        {children && <Reveal delay={0.22} className="mt-7">{children}</Reveal>}
      </Container>
    </header>
  );
}
