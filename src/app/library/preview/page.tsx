import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LibraryView } from "@/components/library/LibraryView";
import { PageHeader } from "@/components/ui/PageHeader";
import { sampleGamePass, sampleLibrary } from "@/components/stats/preview-sample";

export const metadata: Metadata = {
  title: "Library preview",
  robots: { index: false, follow: false },
};

/**
 * DEV PREVIEW ONLY. Renders the library (hero, smart groups, roulette, all
 * three views) against the shared illustrative sample — the same one
 * `/stats/preview` uses — so the signed-in UI can be screenshotted without an
 * account. 404s outside `next dev`, so no real reader can land on sample data.
 */
export default function LibraryPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const { entries, timeToBeat } = sampleLibrary();
  return (
    <>
      <PageHeader eyebrow="Dev preview · sample data" title="Library" description="Everything you own, on every store." />
      <LibraryView previewEntries={entries} previewHours={timeToBeat} previewGamePass={sampleGamePass(entries)} />
    </>
  );
}
