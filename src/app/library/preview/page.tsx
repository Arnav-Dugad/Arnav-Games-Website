import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BacklogRoulette } from "@/components/library/BacklogRoulette";
import { LibraryView } from "@/components/library/LibraryView";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { sampleLibrary } from "@/components/stats/preview-sample";

export const metadata: Metadata = {
  title: "Library preview",
  robots: { index: false, follow: false },
};

/**
 * DEV PREVIEW ONLY. Renders the library and backlog roulette against the
 * shared illustrative sample (the same one `/stats/preview` uses) so the
 * signed-in UI can be screenshotted without an account. 404s outside
 * `next dev`, so no real reader can ever land on sample data.
 */
export default function LibraryPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  const { entries, timeToBeat } = sampleLibrary();
  const hours: Record<number, number> = {};
  for (const [id, ttb] of Object.entries(timeToBeat)) {
    if (typeof ttb.normally === "number") hours[Number(id)] = ttb.normally;
  }

  return (
    <>
      <PageHeader eyebrow="Dev preview · sample data" title="Games you own" />
      <Container className="py-8 lg:py-12">
        <BacklogRoulette preview={{ entries, hours }} />
        <LibraryView previewEntries={entries} />
      </Container>
    </>
  );
}
