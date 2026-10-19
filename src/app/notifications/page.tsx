import type { Metadata } from "next";
import { AuthGate } from "@/components/auth/AuthGate";
import { NotificationsView } from "@/components/notifications/NotificationsView";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Release reminders for the games you follow.",
  robots: { index: false, follow: false },
};

export default function NotificationsPage() {
  return (
    <>
      <PageHeader title="Notifications" className="pb-4 sm:pb-6 lg:pb-8" />
      <AuthGate>
        <NotificationsView />
      </AuthGate>
    </>
  );
}
