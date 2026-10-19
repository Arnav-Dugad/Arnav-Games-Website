"use client";

/**
 * The game page's similar-games rail, personalised once we know the reader.
 *
 * Everyone gets the server-rendered rail (IGDB's similar games) at once. For
 * a signed-in reader with enough taste, `PersonalRelated` then swaps in the
 * same idea seen through their profile: picks the engine made *because they
 * liked this game* first, then the similar games, minus anything already in
 * their library or dismissed, each with its reasons. The swap happens before
 * paint (layout effect), so the rail never shows twice.
 */

import dynamic from "next/dynamic";
import { useState } from "react";
import { GameRail } from "@/components/game/GameRail";
import { useAuth } from "@/lib/firebase/AuthProvider";
import type { GameSummary } from "@/lib/games/types";

const PersonalRelated = dynamic(() => import("./PersonalRelated"), { ssr: false });

export function MoreLikeThis({ related, gameId, gameName }: { related: GameSummary[]; gameId: number; gameName: string }) {
  const { user } = useAuth();
  const [personal, setPersonal] = useState(false);
  return (
    <>
      {!personal && <GameRail games={related} />}
      {user && <PersonalRelated related={related} gameId={gameId} gameName={gameName} onReady={setPersonal} />}
    </>
  );
}
