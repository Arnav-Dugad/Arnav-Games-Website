import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfilePreview } from "./ProfilePreview";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = {
  title: "Profile preview",
  robots: { index: false, follow: false },
};

/**
 * DEV PREVIEW ONLY. The signed-in profile against the shared illustrative
 * library sample, so it can be reviewed without an account. 404s outside
 * `next dev`; nothing here touches Firebase.
 */
export default function ProfilePreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <>
      <PageHeader eyebrow="Dev preview · sample data" title="Profile" />
      <ProfilePreview />
    </>
  );
}
