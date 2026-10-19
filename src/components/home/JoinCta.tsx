"use client";

/**
 * Closing call-to-action, for signed-out visitors only.
 *
 * A signed-in reader already has "For you" at the top of the page, which is
 * a far better welcome back than a banner at the bottom, so this renders
 * nothing for them. While auth is still resolving it also renders nothing —
 * it sits at the very end of the page, so appearing a beat late shifts
 * nothing above it, whereas pitching sign-up to someone signed in is the
 * clearest possible signal that a site isn't paying attention.
 */

import { ArrowRight, Bell, Library, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";

const POINTS = [
  { icon: Bell, label: "Release and delay alerts for games you follow" },
  { icon: Library, label: "A library of what you own, play and finish" },
  { icon: Sparkles, label: "Picks that explain why they were picked" },
];

export function JoinCta() {
  const { user, loading, enabled } = useAuth();
  if (loading || user) return null;

  return (
    <section data-track-src="home:join" aria-labelledby="home-join-title" className="py-9 sm:py-12 lg:py-16">
      <Container>
        <Reveal>
          <div className="glass relative isolate overflow-hidden rounded-[28px] px-6 py-10 sm:px-12 sm:py-14 lg:flex lg:items-center lg:justify-between lg:gap-12 lg:px-14">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_0%_0%,color-mix(in_oklab,var(--color-brand)_22%,transparent),transparent_60%),radial-gradient(50%_70%_at_100%_100%,color-mix(in_oklab,var(--color-neon)_12%,transparent),transparent_60%)]"
            />
            <div className="max-w-xl">
              <h2 id="home-join-title" className="text-[28px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[36px]">
                Never miss the game you’re waiting for.
              </h2>
              <ul className="mt-5 space-y-2.5">
                {POINTS.map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-3 text-[15px] text-muted">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/12 text-brand-soft">
                      <Icon size={15} aria-hidden />
                    </span>
                    {label}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-8 flex flex-wrap gap-3 lg:mt-0 lg:shrink-0 lg:flex-col lg:items-stretch">
              <Button href={enabled ? "/signup" : "/browse"} size="lg" iconRight={<ArrowRight size={17} />}>
                {enabled ? "Create a free account" : "Start exploring"}
              </Button>
              {enabled && (
                <Button href="/login" size="lg" variant="secondary">
                  Sign in
                </Button>
              )}
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
