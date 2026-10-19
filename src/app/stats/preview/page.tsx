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
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatsDashboard, type HoursStatus } from "@/components/stats/StatsDashboard";
import { SAMPLE_BENCHMARK, sampleLibrary } from "@/components/stats/preview-sample";
import { Container } from "@/components/ui/SectionHeading";
import { buildPersonalAnalytics } from "@/lib/games/stats";

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
    <Container className="py-8 lg:py-12">
      <p className="mb-5 rounded-2xl border border-gold/30 bg-gold/[0.06] px-4 py-3 text-xs leading-relaxed text-muted">
        <span className="font-semibold text-text">Dev preview.</span> Sample library of {entries.length} games, rendered through the real analytics pipeline. This route 404s outside <code>next dev</code>.
      </p>
      <StatsDashboard
        analytics={analytics}
        benchmark={single("benchmark") === "off" ? null : SAMPLE_BENCHMARK}
        hoursStatus={hoursStatus}
      />
    </Container>
  );
}
