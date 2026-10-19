import type { Metadata } from "next";
import { Suspense } from "react";
import { BellRing, CalendarClock, ListChecks } from "lucide-react";
import { GamePassLeaving } from "@/components/library/GamePassLeaving";
import { CollectionGate } from "@/components/library/CollectionGate";
import { Container } from "@/components/ui/SectionHeading";
import { WatchlistView } from "@/components/game/WatchlistView";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = {
  title: "Your watchlist",
  description: "Games you're tracking, with release countdowns and play status.",
  robots: { index: false, follow: false },
};

export default function WatchlistPage() {
  return (
    <>
      <PageHeader title="Watchlist" description="Everything you're tracking, with the next release up top." />
      <CollectionGate
        title="Never miss a release"
        body="Save the games you're waiting for and the watchlist keeps count for you."
        points={[
          { icon: <CalendarClock size={18} />, title: "Live countdowns", body: "Every saved game with its real date, window or TBA — the soonest first." },
          { icon: <BellRing size={18} />, title: "Release and DLC alerts", body: "A reminder in the run-up to launch, and when new expansions are announced." },
          { icon: <ListChecks size={18} />, title: "Track your progress", body: "Want to play, playing, played — and where you're playing it." },
        ]}
      >
        <Container className="empty:hidden">
          <Suspense fallback={null}>
            <GamePassLeaving />
          </Suspense>
        </Container>
        <WatchlistView />
      </CollectionGate>
    </>
  );
}
