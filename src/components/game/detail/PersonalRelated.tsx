"use client";

import { useLayoutEffect, useMemo } from "react";
import { RecPosterCard } from "@/components/recs/RecCard";
import { useRecommendationsV2 } from "@/lib/recs/use-recommendations";
import type { GameSummary, RecommendedGame } from "@/lib/games/types";

const MAX = 16;

/** See `MoreLikeThis`. Renders nothing (and keeps the plain rail) until there's something personal to say. */
export default function PersonalRelated({
  related,
  gameId,
  gameName,
  onReady,
}: {
  related: GameSummary[];
  gameId: number;
  gameName: string;
  onReady: (ready: boolean) => void;
}) {
  const { view, hidden } = useRecommendationsV2();

  const picks = useMemo<RecommendedGame[] | null>(() => {
    if (view.status !== "ready") return null;
    const { data } = view;
    const reasons = new Map<number, RecommendedGame>();
    for (const rec of [...data.forYou, ...data.hiddenGems, ...data.newForYou, ...data.comingSoonForYou, ...data.onYourDevices]) {
      if (!reasons.has(rec.game.id)) reasons.set(rec.game.id, rec);
    }
    const seed = data.becauseYouLiked.find((group) => group.seed.id === gameId)?.games ?? [];
    // The engine's own list for this exact game leads; then similar games it
    // also rates for this reader; then the rest of the similar games.
    // Games already in the library, or dismissed, aren't suggestions.
    const similar = related.filter((game) => !hidden.has(game.id)).map((game) => reasons.get(game.id) ?? { game, score: 0, reasons: [] });
    const ordered = [...seed, ...similar.filter((rec) => rec.reasons.length > 0), ...similar.filter((rec) => rec.reasons.length === 0)];
    const seen = new Set<number>([gameId]);
    const out = ordered
      .filter((rec) => {
        if (seen.has(rec.game.id)) return false;
        seen.add(rec.game.id);
        return true;
      })
      // "Because you loved <this game>" is what the whole rail means here; say the next reason instead.
      .map((rec) => ({ ...rec, reasons: rec.reasons.filter((reason) => !(reason.kind === "seed" && reason.text.endsWith(gameName))) }));
    // Nothing personal to add: keep the plain rail rather than relabel it.
    if (seed.length === 0 && !out.some((rec) => rec.reasons.length > 0) && out.length === related.length) return null;
    return out.slice(0, MAX);
  }, [view, related, gameId, gameName, hidden]);

  const ready = Boolean(picks && picks.length > 0);
  useLayoutEffect(() => {
    onReady(ready);
  }, [ready, onReady]);

  if (!picks || picks.length === 0) return null;
  return (
    <ul className="snap-rail rail-gutter relative -my-4 gap-3.5 py-4 sm:gap-4 lg:gap-5">
      {picks.map((rec) => (
        <li key={rec.game.id} className="w-[42vw] max-w-[220px] sm:w-52 lg:w-56 xl:w-60">
          <RecPosterCard rec={rec} sizes="(max-width: 640px) 42vw, 240px" />
        </li>
      ))}
    </ul>
  );
}
