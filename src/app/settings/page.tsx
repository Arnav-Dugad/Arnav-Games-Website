import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsView } from "@/components/settings/SettingsView";

export const metadata: Metadata = {
  title: "Settings",
  description: "Notification, motion, account and data preferences for Arnav Games.",
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Control notifications, motion, account access, and data connectivity."
      />
      <SettingsView />
    </>
  );
}
