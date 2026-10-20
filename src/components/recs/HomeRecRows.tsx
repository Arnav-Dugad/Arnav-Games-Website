"use client";

/**
 * The recommendation engine's rows, woven through the homepage the way a
 * streaming service does it, instead of on a page of their own.
 *
 * Each slot is a few rows dropped between the public shelves:
 *
 *   top       Top picks (wide cards with reasons and feedback)
 *   because   the first two "Because you liked …" rows
 *   discover  Hidden gems · New for you
 *   later     Coming soon for you · On your devices · the remaining
 *             "Because you liked" rows
 *
 * Every slot reads the same cached answer (`useRecommendationsV2` keys it by
 * taste profile), so four slots still cost one request — and none at all
 * until a slot is near the screen. Signed-out visitors get the engine's
 * quality picks in the public slots (top, discover); rows that only make
 * sense with a library ("Because you liked", "On your devices") wait for one.
 */

import { useNearViewport } from "@/hooks";
import { useRecommendationsV2 } from "@/lib/recs/use-recommendations";
import type { RecommendationsV2 } from "@/lib/games/types";
import { RecRail } from "./RecShelves";
import { RecRailSkeleton } from "./RecSkeleton";

export type HomeRecSlot = "top" | "because" | "discover" | "later";

/** Slots that make sense without a library. */
const PUBLIC: ReadonlySet<HomeRecSlot> = new Set(["top", "discover"]);

/** "Because you liked" rows shown in the `because` slot; the rest go `later`. */
const EARLY_SEEDS = 2;

export default function HomeRecRows({ slot }: { slot: HomeRecSlot }) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const { view, personal } = useRecommendationsV2({ enabled: near, anonymous: PUBLIC.has(slot) });

  return (
    <div ref={ref} data-track-src={`home:recs-${slot}`}>
      {view.status === "loading" && slot === "top" ? (
        <RecRailSkeleton variant="feature" className="py-7 sm:py-9" />
      ) : view.status === "ready" ? (
        <Rows slot={slot} data={view.data} tuned={view.data.personalised && personal} />
      ) : null}
    </div>
  );
}

function Rows({ slot, data, tuned }: { slot: HomeRecSlot; data: RecommendationsV2; tuned: boolean }) {
  const row = "py-7 sm:py-9";

  if (slot === "top") {
    return (
      <RecRail
        id="home-top-picks"
        className={row}
        eyebrow={tuned ? "Picked for you" : undefined}
        title={tuned ? "Top picks" : "Highly rated"}
        recs={data.forYou.slice(0, 12)}
        variant="feature"
      />
    );
  }

  if (slot === "discover") {
    return (
      <>
        <RecRail id="home-hidden-gems" className={row} title="Hidden gems" recs={data.hiddenGems} />
        <RecRail id="home-new-for-you" className={row} title={tuned ? "New for you" : "New and well reviewed"} recs={data.newForYou} />
      </>
    );
  }

  // Everything below needs to know the reader.
  if (!tuned) return null;

  const seeds = slot === "because" ? data.becauseYouLiked.slice(0, EARLY_SEEDS) : data.becauseYouLiked.slice(EARLY_SEEDS);
  const because = seeds.map((group) => (
    <RecRail
      key={group.seed.id}
      id={`home-because-${group.seed.id}`}
      className={row}
      eyebrow="Because you liked"
      title={group.seed.name}
      href={`/game/${group.seed.slug}`}
      linkLabel="Open"
      recs={group.games}
    />
  ));

  if (slot === "because") return <>{because}</>;

  return (
    <>
      <RecRail id="home-coming-for-you" className={row} title="Coming soon for you" recs={data.comingSoonForYou} />
      <RecRail id="home-on-your-devices" className={row} title="On your devices" recs={data.onYourDevices} skip={["platform"]} />
      {because}
    </>
  );
}
