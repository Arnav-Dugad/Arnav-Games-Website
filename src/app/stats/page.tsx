import type { Metadata } from "next";
import { AuthGate } from "@/components/auth/AuthGate";
import { StatsView } from "@/components/stats/StatsView";
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
        eyebrow="Your collection, decoded"
        title="Personal stats"
        description="Your taste, your time and your backlog, calculated from your own library. Nothing here is guessed: every chart says what it's based on."
      />
      <AuthGate>
        <StatsView genreDirectory={genres} benchmark={benchmark} />
      </AuthGate>
    </>
  );
}
