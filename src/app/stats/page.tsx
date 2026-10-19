import type { Metadata } from "next";
import { BarChart3, Clock3, Radar } from "lucide-react";
import { CollectionGate } from "@/components/library/CollectionGate";
import { StatsSkeleton, StatsView } from "@/components/stats/StatsView";
import { PageHeader } from "@/components/ui/PageHeader";
import { browseGames, getGenres } from "@/lib/games/source";
import { catalogueBenchmark } from "@/lib/games/stats";

export const metadata: Metadata = {
  title: "Your game stats",
  description: "A private, game-level view of your collection, progress, platforms, genres, and play history.",
  robots: { index: false, follow: false },
};

/** Size of the catalogue sample the library's critic average is compared to. */
const BENCHMARK_SAMPLE = 200;

export default async function StatsPage() {
  // Both are public catalogue queries cached by the provider layer; nothing
  // personal is fetched on the server. The library itself loads client-side
  // behind the auth gate.
  const [{ data: genres }, benchmarkPage] = await Promise.all([
    getGenres(),
    browseGames({ ordering: "-reviews", metacritic: "1,100", pageSize: BENCHMARK_SAMPLE }).catch(() => null),
  ]);
  const benchmark = benchmarkPage ? catalogueBenchmark(benchmarkPage.data.results) : null;

  return (
    <>
      <PageHeader
        title="Your stats"
        description="Your taste, your time and your backlog, from your own library. Every chart says what it's based on."
      />
      <CollectionGate
        title="Your gaming, decoded"
        body="Track and rate games and this page turns them into an honest picture of how you play."
        skeleton={<StatsSkeleton />}
        points={[
          { icon: <BarChart3 size={18} />, title: "Finish rate and backlog", body: "How much of what you own you've actually played, and how long the rest would take." },
          { icon: <Radar size={18} />, title: "The shape of your taste", body: "Your genre radar, and how your mix has shifted over time." },
          { icon: <Clock3 size={18} />, title: "Where your time goes", body: "Estimated hours by platform, from IGDB's real completion times." },
        ]}
      >
        <StatsView genreDirectory={genres} benchmark={benchmark} />
      </CollectionGate>
    </>
  );
}
