"use client";

/**
 * Closing call-to-action.
 *
 * Auth-aware: pitching "create your account" to someone already signed in is
 * the clearest possible signal that a site isn't paying attention, so signed-in
 * visitors get a route back into their own library instead.
 *
 * While auth is still resolving it renders the neutral half of the copy rather
 * than flashing the wrong message and correcting itself a moment later.
 */

import { ArrowRight, Bookmark, Compass, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { Button } from "@/components/ui/Button";
import { Container, Section } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { Aurora, GridLines } from "@/components/motion/Aurora";

export function JoinCta() {
  const { user, loading, enabled } = useAuth();
  const { entries } = useWatchlist();

  const signedIn = Boolean(user);
  const firstName = user?.displayName?.trim().split(/\s+/)[0];

  const eyebrow = signedIn ? "Your library" : "Free, forever";

  const heading = signedIn
    ? firstName
      ? `Welcome back, ${firstName}`
      : "Pick up where you left off"
    : "Never miss a release you’ve been waiting for";

  const body = signedIn
    ? entries.length > 0
      ? `You're tracking ${entries.length} ${entries.length === 1 ? "game" : "games"}. Check what's landing next, or keep exploring.`
      : "Your watchlist is empty. Find something worth waiting for."
    : "Create an account to build a watchlist, track what you’re playing and rate the games you finish.";

  return (
    <Section>
      <Container>
        <Reveal>
          <div className="noise relative isolate overflow-hidden rounded-[28px] border border-line px-6 py-14 text-center sm:px-12 lg:py-20">
            <Aurora intensity="normal" className="-z-10" />
            <GridLines className="-z-10 opacity-50" />

            <p className="flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-brand-soft">
              <Sparkles size={13} />
              {eyebrow}
            </p>
            <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-black leading-[1.05] sm:text-4xl lg:text-5xl">
              {heading}
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-muted">{body}</p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {signedIn ? (
                <>
                  <Button href="/watchlist" size="lg" icon={<Bookmark size={17} />}>
                    Your watchlist
                  </Button>
                  <Button href="/upcoming" size="lg" variant="secondary" icon={<Compass size={17} />}>
                    What&rsquo;s coming next
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    href={enabled ? "/signup" : "/browse"}
                    size="lg"
                    loading={loading}
                    iconRight={<ArrowRight size={17} />}
                  >
                    {enabled ? "Create your account" : "Start exploring"}
                  </Button>
                  <Button href="/browse" size="lg" variant="secondary">
                    Explore the database
                  </Button>
                </>
              )}
            </div>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
