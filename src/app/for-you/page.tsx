import type { Metadata } from "next";
import { ForYouView } from "@/components/recs/lazy";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = {
  title: "For you",
  description: "Games picked from what you play, each with the reason it was chosen.",
  // Personal to each reader, rendered in the browser: nothing for a crawler.
  robots: { index: false, follow: true },
};

export default function ForYouPage() {
  return (
    <>
      <PageHeader title="For you" />
      <ForYouView />
    </>
  );
}
