"use client";

import { ProfileScreen } from "@/components/auth/ProfileView";
import { sampleLibrary } from "@/components/stats/preview-sample";
import type { Review } from "@/lib/firebase/db";

/** DEV PREVIEW ONLY — see the page. Saving and signing out are no-ops. */
export function ProfilePreview() {
  const { entries } = sampleLibrary();
  const review = (index: number, rating: number, body: string): Review => ({
    id: `preview-${index}`,
    gameId: entries[index].gameId,
    slug: entries[index].slug,
    gameName: entries[index].name,
    uid: "preview",
    author: "Sam",
    photoURL: null,
    rating,
    body,
    createdAt: entries[index].addedAt + 40 * 86_400_000,
    updatedAt: entries[index].addedAt + 40 * 86_400_000,
  });
  const reviews = [
    review(1, 10, "The open world is the point. Every ridge hides something."),
    review(9, 9, "A tabletop campaign that never runs out of surprises."),
    review(3, 9, "Tight, fast, and the music carries every run."),
    review(20, 8, "Gorgeous turn-based combat with real-time teeth."),
  ];
  return (
    <ProfileScreen
      data={{
        uid: "preview-user",
        email: "sam@example.com",
        photo: null,
        memberSince: Date.parse("2023-01-12T00:00:00Z"),
        draft: { name: "Sam Rivera", bio: "RPGs, roguelikes and the occasional racing game.", gamerTag: "samplays", ownedPlatforms: ["steam", "ps5", "switch"], activeSubscriptions: ["game-pass"], playStyle: "dedicated" },
        reviews,
        entries,
      }}
      onSave={async () => {}}
      onSignOut={async () => {}}
    />
  );
}
