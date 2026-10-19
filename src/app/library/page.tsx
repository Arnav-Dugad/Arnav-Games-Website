import type { Metadata } from "next";
import { Suspense } from "react";
import { Dices, Layers3, Timer } from "lucide-react";
import { GamePassLeaving } from "@/components/library/GamePassLeaving";
import { CollectionGate } from "@/components/library/CollectionGate";
import { LibraryView } from "@/components/library/LibraryView";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";

export const metadata: Metadata = {
  title: "Your library",
  description: "Every game you own, across every storefront, with smart groups, backlog hours and a shelf you can play with.",
  // A personal page has nothing to offer a crawler.
  robots: { index: false, follow: false },
};

export default function LibraryPage() {
  return (
    <>
      <PageHeader eyebrow="Library" title="Games you own" description="Everything you own, on every store, and what to play next." />
      <CollectionGate
        title="Your whole collection, in one place"
        body="Record where you own each game and the library does the rest."
        points={[
          { icon: <Layers3 size={18} />, title: "Every store, one list", body: "Steam, PlayStation, Xbox, Switch, physical copies — owned twice counts as one game." },
          { icon: <Timer size={18} />, title: "Know your backlog", body: "See how many hours are waiting, grouped by where you can play them." },
          { icon: <Dices size={18} />, title: "Can't decide?", body: "Backlog roulette picks your next game by mood, length and platform." },
        ]}
      >
        {/* Only appears when one of the reader's games is leaving Game Pass. */}
        <Container className="empty:hidden">
          <Suspense fallback={null}>
            <GamePassLeaving />
          </Suspense>
        </Container>
        <LibraryView />
      </CollectionGate>
    </>
  );
}
