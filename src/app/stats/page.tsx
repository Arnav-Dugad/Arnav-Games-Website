import type { Metadata } from "next";
import { BarChart3, Clock3, Radar, Sparkles } from "lucide-react";
import { CollectionGate } from "@/components/library/CollectionGate";
import { StatsSkeleton, StatsView } from "@/components/stats/StatsView";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { HypeScatter } from "@/components/stats/charts/HypeScatter";
import { analyseHype } from "@/lib/games/hype-reality";
import { hypeRealityRows } from "@/lib/games/providers/igdb-extras";
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
  const [{ data: genres }, benchmarkPage, hypeRows] = await Promise.all([
    getGenres(),
    browseGames({ ordering: "-reviews", metacritic: "1,100", pageSize: BENCHMARK_SAMPLE }).catch(() => null),
    // Site-wide, not personal: one IGDB query, cached for 12 hours.
    hypeRealityRows(),
  ]);
  const benchmark = benchmarkPage ? catalogueBenchmark(benchmarkPage.data.results) : null;
  const analysed = hypeRows ? analyseHype(hypeRows) : null;
  // The chart only needs covers for the labelled outliers and no percentile
  // table: trimming them keeps the page payload small.
  const hype = analysed
    ? {
        ...analysed,
        model: { ...analysed.model, hypes: [] },
        points: analysed.points.map((point) => (point.tag ? point : { ...point, image: null, slug: point.slug })),
      }
    : null;

  return (
    <>
      <PageHeader
        title="Your stats"
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
      {/* Everyone's, not yours: shown signed in or out, below the personal stats. */}
      {hype && (
        <Container className="pb-12 lg:pb-16">
          <section aria-labelledby="hype-title" className="glass rounded-[1.75rem] p-5 sm:p-6">
            <h2 id="hype-title" className="flex items-center gap-2 font-display text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">
              <Sparkles size={18} className="text-brand-soft" aria-hidden /> Hype vs reality
            </h2>
            <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted">
              Did the games people followed hardest before launch turn out best? Every recent release with a pre-launch following and a settled score.
            </p>
            <div className="mt-5">
              <HypeScatter data={hype} />
            </div>
          </section>
        </Container>
      )}
    </>
  );
}
