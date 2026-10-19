import type { Metadata } from "next";
import { Suspense } from "react";
import { GamePassLeaving } from "@/components/library/GamePassLeaving";
import { Container } from "@/components/ui/SectionHeading";
import { AuthGate } from "@/components/auth/AuthGate";
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
      <PageHeader
        eyebrow="Your library"
        title="Watchlist"
        description="Everything you're tracking, with the next release up top."
      />
      <AuthGate>
        <Container className="pt-6 empty:hidden lg:pt-8">
          <Suspense fallback={null}>
            <GamePassLeaving />
          </Suspense>
        </Container>
        <WatchlistView />
      </AuthGate>
    </>
  );
}
