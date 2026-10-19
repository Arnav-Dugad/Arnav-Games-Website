import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { DataSourceNotice } from "@/components/ui/DataSourceNotice";
import { getSteamCharts } from "@/lib/games/source";
import { SteamCharts, type ChartData } from "./_components/SteamCharts";

/**
 * Steam's own charts, refreshed daily by IGDB's popularity feed.
 *
 * Dynamic rather than daily: the underlying data moves once a day, but on an
 * unpredictable schedule, and a stale "most played right now" is the one
 * thing this page cannot afford.
 */
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Steam charts",
  description:
    "What Steam is playing, buying and wishlisting right now — most played, global top sellers and the most-wishlisted upcoming games.",
};

/** Our wording for each chart; the provider's keys are the contract. */
const CHART_COPY: Record<string, { title: string; short: string; measure: string }> = {
  peak: { title: "Most played", short: "Most played", measure: "Peak players in the last 24 hours" },
  sellers: { title: "Top sellers", short: "Top sellers", measure: "Worldwide revenue" },
  wishlisted: { title: "Most wishlisted", short: "Wishlisted", measure: "Upcoming games, by wishlists" },
};

export default async function SteamPage() {
  const { data, source } = await getSteamCharts(15);

  const charts: ChartData[] = data
    .filter((chart) => chart.games.length > 0)
    .map((chart) => ({
      key: chart.key,
      games: chart.games,
      ...(CHART_COPY[chart.key] ?? { title: chart.title, short: chart.title, measure: chart.description }),
    }));

  return (
    <>
      <PageHeader title="Steam charts" className="pb-4 sm:pb-6 lg:pb-8" />

      <Container className="pb-12 lg:pb-16">
        {source === "unavailable" || charts.length === 0 ? (
          <DataSourceNotice source="unavailable" />
        ) : (
          <>
            <SteamCharts charts={charts} />
            {/* Steam has no public chart API; saying where the ranks come from
                is the honest minimum. */}
            <p className="mt-10 text-[13px] text-faint">Rankings from Steam, via IGDB. Updated daily.</p>
          </>
        )}
      </Container>
    </>
  );
}
