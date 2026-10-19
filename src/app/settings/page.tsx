import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsView } from "@/components/settings/SettingsView";

export const metadata: Metadata = {
  title: "Settings",
  description: "Account, appearance, price region, notification and motion preferences for Arnav Games.",
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsView />
    </>
  );
}
