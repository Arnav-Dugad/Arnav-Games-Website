import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WatchlistView } from "@/components/game/WatchlistView";
import { PageHeader } from "@/components/ui/PageHeader";
import { sampleLibrary, sampleWishlist } from "@/components/stats/preview-sample";

export const metadata: Metadata = {
  title: "Watchlist preview",
  robots: { index: false, follow: false },
};

/**
 * DEV PREVIEW ONLY. The watchlist against the shared illustrative sample, so
 * the signed-in controls can be screenshotted without an account. 404s
 * outside `next dev`.
 */
export default function WatchlistPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const { entries } = sampleLibrary();
  const wishlist = sampleWishlist();
  return (
    <>
      <PageHeader eyebrow="Dev preview · sample data" title="Watchlist" description="Everything you're tracking." />
      <WatchlistView
        previewEntries={[...entries.map((entry) => ({ ...entry, watchlisted: true })), ...wishlist.entries]}
        previewBudget={{ region: "US", prices: wishlist.prices, hours: wishlist.timeToBeat }}
      />
    </>
  );
}
