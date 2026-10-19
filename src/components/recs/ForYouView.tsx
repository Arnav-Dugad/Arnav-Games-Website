"use client";

/**
 * `/for-you`: every group the recommendation engine makes, each card saying
 * why it's there.
 *
 *  - Signed in with enough taste: For you (wide cards with inline feedback),
 *    one "Because you liked X" rail per seed, Hidden gems, New for you,
 *    Coming soon for you, On your devices.
 *  - Signed in, thin library: the engine's quality picks, plus one line on
 *    how to make them personal.
 *  - Signed out: the same quality picks with a gentle sign-in prompt. Their
 *    feedback still counts (it's kept on the device).
 *
 * The whole page is one cached answer (see `useRecommendationsV2`).
 */

import { Gamepad2, LogIn, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import { useRecommendationsV2 } from "@/lib/recs/use-recommendations";
import { RecRail } from "./RecShelves";
import { RecRailSkeleton } from "./RecSkeleton";

export default function ForYouView() {
  const { view, signedIn, personal } = useRecommendationsV2({ anonymous: true });

  if (view.status === "loading" || view.status === "off") {
    return (
      <div className="space-y-12 pb-12 sm:space-y-16">
        <RecRailSkeleton variant="feature" />
        <RecRailSkeleton />
        <RecRailSkeleton />
      </div>
    );
  }

  if (view.status === "error") {
    return (
      <Container className="pb-12">
        <EmptyState
          tone="unavailable"
          icon={<Sparkles size={24} />}
          title="Picks couldn’t load"
          body="The game database didn’t answer in time."
          action={{ onClick: view.retry, label: "Try again" }}
        />
      </Container>
    );
  }

  const { data } = view;
  const tuned = data.personalised && personal;
  const empty =
    data.forYou.length + data.hiddenGems.length + data.newForYou.length + data.comingSoonForYou.length + data.onYourDevices.length === 0 &&
    data.becauseYouLiked.length === 0;

  return (
    <div className="space-y-12 pb-12 sm:space-y-16" aria-busy={view.refreshing || undefined}>
      {!tuned && (
        <Container>
          <Prompt signedIn={signedIn} />
        </Container>
      )}

      {empty ? (
        <Container>
          <EmptyState
            icon={<RefreshCw size={22} />}
            title="You’ve seen everything we’d suggest"
            body="Follow or rate a few more games and new picks will appear."
            action={{ href: "/browse", label: "Browse games" }}
          />
        </Container>
      ) : (
        <>
          <RecRail id="for-you-top" title={tuned ? "Top picks" : "Highly rated"} recs={data.forYou.slice(0, 12)} variant="feature" />
          {data.becauseYouLiked.map((group) => (
            <RecRail
              key={group.seed.id}
              id={`because-${group.seed.id}`}
              eyebrow="Because you liked"
              title={group.seed.name}
              href={`/game/${group.seed.slug}`}
              linkLabel="Open"
              recs={group.games}
            />
          ))}
          <RecRail id="hidden-gems" title="Hidden gems" recs={data.hiddenGems} />
          <RecRail id="new-for-you" title={tuned ? "New for you" : "New and well reviewed"} recs={data.newForYou} />
          <RecRail id="coming-soon" title={tuned ? "Coming soon for you" : "Coming soon"} recs={data.comingSoonForYou} />
          <RecRail id="on-your-devices" title="On your devices" recs={data.onYourDevices} skip={["platform"]} />
        </>
      )}
    </div>
  );
}

function Prompt({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="glass relative isolate flex flex-col gap-4 overflow-hidden rounded-3xl p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_0%_0%,color-mix(in_oklab,var(--color-brand)_14%,transparent),transparent_55%)]"
      />
      <div className="min-w-0">
        <p className="text-[17px] font-semibold text-text">{signedIn ? "Make these yours" : "Picks that know your taste"}</p>
        <p className="mt-0.5 text-[15px] leading-snug text-muted">
          {signedIn ? "Mark a few games you’ve played or rate them." : "Sign in and they’ll follow what you play."}
        </p>
      </div>
      {signedIn ? (
        <Button href="/browse" size="sm" icon={<Gamepad2 size={15} />}>
          Find games
        </Button>
      ) : (
        <Button href="/login?next=%2Ffor-you" size="sm" icon={<LogIn size={15} />}>
          Sign in
        </Button>
      )}
    </div>
  );
}
