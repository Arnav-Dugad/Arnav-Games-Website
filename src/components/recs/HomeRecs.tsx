"use client";

/**
 * The home page's picks, under the reader's own library shelf: the top of
 * the engine's "For you" list as wide cards (reasons and feedback inline),
 * with everything else one tap away on /for-you. Signed-in readers with
 * enough taste only — signed-out visitors get the page's join card instead.
 */

import { useRecommendationsV2 } from "@/lib/recs/use-recommendations";
import { RecRail } from "./RecShelves";
import { RecRailSkeleton } from "./RecSkeleton";

export default function HomeRecs() {
  const { view } = useRecommendationsV2();
  if (view.status === "off" || view.status === "error") return null;
  if (view.status === "loading") return <RecRailSkeleton variant="feature" className="mt-10 sm:mt-12" />;
  return (
    <RecRail
      id="home-picks"
      className="mt-10 sm:mt-12"
      title="Picked for you"
      recs={view.data.forYou.slice(0, 10)}
      variant="feature"
      level="h3"
      href="/for-you"
    />
  );
}
