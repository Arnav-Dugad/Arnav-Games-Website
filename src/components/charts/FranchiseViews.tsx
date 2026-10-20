"use client";

/**
 * Franchise pages: the series as a constellation (the default — it shows the
 * shape of a series at a glance) or as the scored timeline. The choice is
 * per visit; both views get the same games.
 */

import dynamic from "next/dynamic";
import { useState } from "react";
import { SegmentedControl } from "@/components/filters";
import { Skeleton } from "@/components/ui/Skeleton";
import type { TimelineGame } from "@/lib/games/timeline";
import { ReleaseTimeline } from "./ReleaseTimeline";

// Browser-only geometry; kept out of the server render and the Worker bundle.
const FranchiseConstellation = dynamic(() => import("./FranchiseConstellation"), {
  ssr: false,
  loading: () => <Skeleton className="h-[340px] rounded-3xl sm:h-[420px]" />,
});

export function FranchiseViews({ games, subject, undatedCount }: { games: TimelineGame[]; subject: string; undatedCount: number }) {
  const [view, setView] = useState<"sky" | "timeline">("sky");
  return (
    <div>
      <SegmentedControl
        label="How to show the series"
        value={view}
        onChange={setView}
        fill={false}
        className="mb-4 w-fit sm:mb-5"
        segments={[
          { value: "sky", label: "Constellation" },
          { value: "timeline", label: "Timeline" },
        ]}
      />
      {view === "sky" ? (
        <FranchiseConstellation games={games} subject={subject} />
      ) : (
        <ReleaseTimeline games={games} subject={subject} undatedCount={undatedCount} />
      )}
    </div>
  );
}
