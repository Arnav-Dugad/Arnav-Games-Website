import type { Metadata } from "next";
import { AuthGate } from "@/components/auth/AuthGate";
import { ProfileView } from "@/components/auth/ProfileView";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = {
  title: "Your profile",
  description: "Your Arnav Games account, review history and preferences.",
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Your profile"
        description="Your reviews, your tracked games and your account settings."
      />
      <AuthGate>
        <ProfileView />
      </AuthGate>
    </>
  );
}
