"use client";

/**
 * "Play next on Game Pass": the reader's own backlog, intersected with the
 * Game Pass catalogue.
 *
 * The question it answers is urgency — a game you meant to play through the
 * subscription is about to disappear — so anything leaving soon leads with a
 * gold chip, then the rest by critic score (the closest thing we have to
 * "most worth your evening"). A game already in progress joins only when
 * it's leaving — "finish it before it goes" is the same urgency. Only
 * anonymous IGDB ids are sent to the match route; the Game Pass lists
 * themselves are public.
 *
 * Honesty: a backlog with no Game Pass overlap says so in one line, but only
 * for readers who show some sign of using Xbox or Game Pass — everyone else
 * would just be told about a subscription they don't have.
 */

import { useEffect, useMemo, useState } from "react";
import { Gamepad } from "lucide-react";
import { PosterTile } from "@/components/game/PosterTile";
import { Container } from "@/components/ui/SectionHeading";
import { SmartRail } from "./SmartRail";
import { isBacklog } from "./backlog";
import type { WatchlistEntry } from "@/lib/firebase/db";
import type { GamePassMatch, GamePassMatches } from "@/lib/games/types";
import type { TimeToBeatLike } from "@/lib/games/stats";

type MatchState = { key: string; matches: GamePassMatches | null } | null;

const XBOX_SIGNALS = new Set(["xbox-pc", "xbox-series", "xbox-one", "xbox-360", "xbox"]);

export default function GamePassNext({
  entries,
  hours,
  preview,
}: {
  entries: WatchlistEntry[];
  hours: Record<number, TimeToBeatLike> | null;
  /** Dev preview only: illustrative matches for the sample library's fake ids. */
  preview?: GamePassMatches;
}) {
  const backlog = useMemo(() => entries.filter((entry) => isBacklog(entry) || entry.status === "playing"), [entries]);
  // Only IGDB ids can match a Microsoft listing; Steam-only records are skipped.
  const key = useMemo(() => backlog.map((entry) => entry.gameId).filter((id) => id > 0).sort((a, b) => a - b).join(","), [backlog]);
  const [state, setState] = useState<MatchState>(null);

  useEffect(() => {
    if (preview || !key) return;
    const controller = new AbortController();
    const ids = key.split(",").map(Number).slice(0, 300);
    fetch("/api/gamepass/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? (response.json() as Promise<GamePassMatches>) : null))
      .then((matches) => setState({ key, matches: matches && typeof matches === "object" ? matches : null }))
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setState({ key, matches: null });
      });
    return () => controller.abort();
  }, [key, preview]);

  const matches = preview ?? (state?.key === key ? state.matches : null);

  const ranked = useMemo(() => {
    if (!matches) return [];
    return backlog
      .map((entry) => ({ entry, match: matches[String(entry.gameId)] }))
      .filter((row): row is { entry: WatchlistEntry; match: GamePassMatch } =>
        Boolean(row.match) && (row.entry.status !== "playing" || row.match.leavingSoon),
      )
      .sort((a, b) =>
        Number(b.match.leavingSoon) - Number(a.match.leavingSoon)
        || (b.entry.metacritic ?? 0) - (a.entry.metacritic ?? 0)
        || a.entry.name.localeCompare(b.entry.name),
      );
  }, [backlog, matches]);

  // Unknown (loading or route unavailable): render nothing rather than a guess.
  if (!matches || backlog.length === 0) return null;

  if (ranked.length === 0) {
    const usesXbox = entries.some(
      (entry) =>
        (entry.ownedOn ?? []).some((slug) => XBOX_SIGNALS.has(slug))
        || (entry.subscriptionAccess ?? []).some((access) => access.service === "game-pass"),
    );
    if (!usesXbox) return null;
    return (
      <Container>
        <p className="flex items-center gap-2.5 text-[13px] text-muted">
          <Gamepad size={15} aria-hidden className="shrink-0 text-faint" />
          None of your backlog matched the Game Pass catalogue.
        </p>
      </Container>
    );
  }

  const leaving = ranked.filter((row) => row.match.leavingSoon).length;

  return (
    <SmartRail
      title="Play next on Game Pass"
      count={ranked.length}
      subtitle={leaving > 0 ? <span className="text-gold">{leaving} leaving soon</span> : undefined}
    >
      {ranked.map(({ entry, match }) => (
        <div key={entry.gameId} className="relative">
          <PosterTile entry={entry} badge={entry.status === "playing" ? "Playing now" : caption(match, hours?.[entry.gameId])} />
          {/* Sits over the cover's bottom edge; the cover is the tile's 3:4 top. */}
          {(match.leavingSoon || match.recentlyAdded) && (
            <span className="pointer-events-none absolute inset-x-0 top-0 aspect-[3/4]">
              <span
                className={
                  match.leavingSoon
                    ? "absolute bottom-2 left-2 rounded-full bg-gold px-2 py-0.5 text-[11px] font-semibold text-black shadow-lg"
                    : "absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur"
                }
              >
                {match.leavingSoon ? "Leaving soon" : "New"}
              </span>
            </span>
          )}
        </div>
      ))}
    </SmartRail>
  );
}

/** Where it's included, plus length when IGDB knows it. The chip carries the urgency. */
function caption(match: GamePassMatch, ttb: TimeToBeatLike | undefined): string {
  const where = match.console && match.pc ? "Console & PC" : match.pc ? "PC" : "Console";
  const hours = ttb?.normally ?? ttb?.hastily ?? null;
  return `${where}${hours ? ` · ${Math.round(hours)} h` : ""}`;
}
