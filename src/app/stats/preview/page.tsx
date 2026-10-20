/**
 * DEV PREVIEW — not a product page.
 *
 * Renders the stats dashboard from a fixed sample library so the charts can
 * be reviewed and screenshotted without signing in (the real /stats sits
 * behind the auth gate). It 404s in every build except `next dev`, and the
 * sample data never touches Firebase.
 *
 * Query options:
 *   ?games=N        only the first N sample games (try 3 for the low-data states)
 *   ?hours=loading  | unavailable — the time-to-beat states
 *   ?benchmark=off  the catalogue benchmark missing
 *   ?deep=off       without the deeper cards (finish rates, taste map, heatmap, money)
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { HoursStatus } from "@/components/stats/StatsDashboard";
import { StatsPreviewClient } from "@/components/stats/StatsPreviewClient";
import { SAMPLE_BENCHMARK, SAMPLE_NOW, sampleDeep, sampleLibrary } from "@/components/stats/preview-sample";
import { Container } from "@/components/ui/SectionHeading";
import { PageHeader } from "@/components/ui/PageHeader";
import { buildPersonalAnalytics } from "@/lib/games/stats";
import { backlogForecast } from "@/lib/games/forecast";

export const metadata: Metadata = {
  title: "Stats preview (dev)",
  robots: { index: false, follow: false },
};

export default async function StatsPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  const params = await searchParams;
  const single = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const limit = Number(single("games"));
  const hoursParam = single("hours");
  const hoursStatus: HoursStatus = hoursParam === "loading" || hoursParam === "unavailable" ? hoursParam : "ready";

  const { entries, timeToBeat } = sampleLibrary(Number.isInteger(limit) && limit > 0 ? limit : undefined);
  const analytics = buildPersonalAnalytics(entries, { timeToBeat: hoursStatus === "ready" ? timeToBeat : null });

  return (
    <>
      <PageHeader eyebrow={`Dev preview · sample library of ${entries.length} games`} title="Your stats" />
      <Container className="pb-8 lg:pb-12">
        <StatsPreviewClient
          entries={entries}
          deep={single("deep") === "off" ? null : sampleDeep(entries, SAMPLE_NOW)}
          analytics={analytics}
          benchmark={single("benchmark") === "off" ? null : SAMPLE_BENCHMARK}
          hoursStatus={hoursStatus}
          forecast={hoursStatus === "ready" ? backlogForecast(entries, timeToBeat) : null}
        />
      </Container>
    </>
  );
}
