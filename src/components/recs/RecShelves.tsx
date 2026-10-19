"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Container } from "@/components/ui/SectionHeading";
import { cn } from "@/lib/utils/cn";
import type { RecReasonKind, RecommendedGame } from "@/lib/games/types";
import { RecFeatureCard, RecPosterCard } from "./RecCard";

/**
 * One titled rail of recommendations. Full-bleed like every rail on the site
 * (`.snap-rail .rail-gutter`; desktop arrows come from the global
 * ScrollArrows layer). "feature" = wide cards with inline feedback, used for
 * the top picks; "poster" = covers with one line of why.
 */
export function RecRail({
  id,
  title,
  eyebrow,
  recs,
  variant = "poster",
  href,
  linkLabel = "See all",
  className,
  aside,
  level = "h2",
  skip,
}: {
  id: string;
  title: ReactNode;
  eyebrow?: ReactNode;
  recs: RecommendedGame[];
  variant?: "poster" | "feature";
  href?: string;
  linkLabel?: string;
  className?: string;
  aside?: ReactNode;
  /** h3 when the rail sits inside another titled section (home "For you"). */
  level?: "h2" | "h3";
  /** Reason kinds the title already states, left off the poster cards. */
  skip?: RecReasonKind[];
}) {
  if (recs.length === 0) return null;
  const Heading = level;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-36", className)}>
      <Container className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-[13px] font-semibold text-brand-soft">{eyebrow}</p>}
          <Heading
            id={`${id}-title`}
            className={
              level === "h2"
                ? "text-[22px] font-bold leading-tight tracking-[-0.02em] sm:text-[28px]"
                : "text-[17px] font-semibold tracking-[-0.01em] sm:text-[20px]"
            }
          >
            {title}
          </Heading>
        </div>
        {href && (
          <Link
            href={href}
            className="press group relative inline-flex shrink-0 items-center gap-1 text-[15px] font-medium text-brand-soft after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] fine:hover:text-text"
          >
            {linkLabel}
            <ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </Container>
      {aside}
      {/* `relative`: absolutely-positioned bits inside cards are then clipped by the rail, never widening the page. */}
      <ul className="snap-rail rail-gutter relative mt-3 gap-3 py-3 sm:mt-4 sm:gap-4">
        {recs.map((rec, index) =>
          variant === "feature" ? (
            <li key={rec.game.id} className="w-[86vw] max-w-[400px] shrink-0 sm:w-[380px]">
              <RecFeatureCard rec={rec} priority={index < 2} />
            </li>
          ) : (
            <li key={rec.game.id} className="w-[40vw] max-w-[184px] shrink-0 sm:w-[176px]">
              <RecPosterCard rec={rec} skip={skip} />
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
