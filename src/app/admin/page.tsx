import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { PageHeader } from "@/components/ui/PageHeader";

/*
 * Private owner dashboard. Kept out of search three ways: this noindex,
 * the robots.txt disallow, and `X-Robots-Tag` on the stats API. None of that
 * is the security boundary — the stats route's token check is.
 */
export const metadata: Metadata = {
  title: "Analytics",
  description: "Private site analytics.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AdminPage() {
  return (
    <>
      <PageHeader
        eyebrow="Private · owner only"
        title="Analytics"
        description="First-party and cookieless: pageviews, searches, follows and real-visitor Web Vitals."
      />
      {/* AdminDashboard reads `useSearchParams` (dev-only bypass flag). */}
      <Suspense fallback={null}>
        <AdminDashboard />
      </Suspense>
    </>
  );
}
