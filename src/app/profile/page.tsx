import type { Metadata } from "next";
import { Star, Trophy, UserRound } from "lucide-react";
import { CollectionGate } from "@/components/library/CollectionGate";
import { ProfileView } from "@/components/auth/ProfileView";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = {
  title: "Your profile",
  description: "Your Arnav Games account: milestones, favourites, recent activity and reviews.",
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Profile" />
      <CollectionGate
        title="Your player profile"
        body="One place for who you are as a player — built from the games you track."
        points={[
          { icon: <Trophy size={18} />, title: "Milestones you earn", body: "Collector, Finisher, Critic and more, from what you actually own and play." },
          { icon: <Star size={18} />, title: "Favourites and reviews", body: "Rate games and your best ones become your showcase." },
          { icon: <UserRound size={18} />, title: "Where you play", body: "Your platforms and subscriptions, with your library behind them." },
        ]}
      >
        <ProfileView />
      </CollectionGate>
    </>
  );
}
