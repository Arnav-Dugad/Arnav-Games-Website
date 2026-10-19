"use client";

/**
 * "Play in the cloud": the reader's own games (owned, playing, or wanted)
 * that GeForce NOW can stream or Game Pass includes — one tab each.
 *
 * Game Pass keeps the urgency of the shelf it replaces ("Play next on Game
 * Pass"): leaving soon first, then by critic score; a game in progress only
 * joins when it's leaving. GeForce NOW streams games you own on a supported
 * store, so games you already own on one of NVIDIA's listed stores lead
 * ("Ready"), and the rest say where to get them.
 *
 * One `POST /api/cloud/match` covers both (shared with every other caller
 * through `useCloudMatches`). Unknown (loading or unavailable) renders
 * nothing rather than a guess.
 */

import { useMemo, useState } from "react";
import { Cloud } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { PosterTile } from "@/components/game/PosterTile";
import { haptic } from "@/lib/haptics";
import { useCloudMatches } from "@/lib/cloud/use-cloud-matches";
import { RailTabs, SmartRail } from "./SmartRail";
import { isBacklog } from "./backlog";
import type { WatchlistEntry } from "@/lib/firebase/db";
import type { CloudMatches, GamePassMatch, GamePassMatches, GeForceNowMembership } from "@/lib/games/types";
import type { TimeToBeatLike } from "@/lib/games/stats";

/** NVIDIA's store names (normalised) → our ownership slugs. */
const GFN_STORE: Record<string, string> = {
  steam: "steam",
  epic: "epic",
  epicgamesstore: "epic",
  gog: "gog",
  goggalaxy: "gog",
  xbox: "xbox-pc",
  microsoftstore: "xbox-pc",
  ubisoftconnect: "ubisoft",
  ubisoft: "ubisoft",
  eaapp: "ea",
  origin: "ea",
  battlenet: "battlenet",
};
const norm = (store: string) => store.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The library games worth asking about: owned, in progress, or wanted. */
export function cloudCandidates(entries: WatchlistEntry[]): number[] {
  return entries
    .filter((entry) => (entry.ownedOn ?? []).length > 0 || entry.status === "want" || entry.status === "playing")
    .map((entry) => entry.gameId);
}

type Tab = "gfn" | "gamepass";

export default function CloudPlay({
  entries,
  hours,
  preview,
}: {
  entries: WatchlistEntry[];
  hours: Record<number, TimeToBeatLike> | null;
  /** Dev preview only: illustrative Game Pass matches for the sample library's fake ids. */
  preview?: GamePassMatches;
}) {
  const ids = useMemo(() => cloudCandidates(entries), [entries]);
  const asked = useMemo(() => new Set(ids), [ids]);
  const state = useCloudMatches(preview ? null : ids);
  const matches: CloudMatches | null = useMemo(() => {
    if (preview) return Object.fromEntries(Object.entries(preview).map(([id, gamePass]) => [id, { gamePass, geforceNow: null }]));
    return state.status === "ready" ? state.data.matches : null;
  }, [preview, state]);

  const gfn = useMemo(() => {
    if (!matches) return [];
    return entries
      .map((entry) => ({ entry, match: matches[String(entry.gameId)]?.geforceNow ?? null }))
      .filter((row): row is { entry: WatchlistEntry; match: GeForceNowMembership } => Boolean(row.match && row.match.status !== "not-listed"))
      .filter((row) => asked.has(row.entry.gameId))
      .map((row) => ({ ...row, ready: readyStore(row.entry, row.match) }))
      // In progress first, then games still to play (finished ones last), each
      // with the ones you can stream right now ahead of those you'd need to buy.
      .sort((a, b) =>
        Number(b.entry.status === "playing") - Number(a.entry.status === "playing")
        || Number(a.entry.status === "played") - Number(b.entry.status === "played")
        || Number(Boolean(b.ready)) - Number(Boolean(a.ready))
        || (b.entry.metacritic ?? 0) - (a.entry.metacritic ?? 0)
        || a.entry.name.localeCompare(b.entry.name),
      );
  }, [entries, matches, asked]);

  const gamePass = useMemo(() => {
    if (!matches) return [];
    return entries
      .filter((entry) => isBacklog(entry) || entry.status === "playing")
      .map((entry) => ({ entry, match: matches[String(entry.gameId)]?.gamePass ?? null }))
      .filter((row): row is { entry: WatchlistEntry; match: GamePassMatch } =>
        Boolean(row.match && (row.match.console || row.match.pc)) && (row.entry.status !== "playing" || row.match!.leavingSoon),
      )
      .sort((a, b) =>
        Number(b.match.leavingSoon) - Number(a.match.leavingSoon)
        || (b.entry.metacritic ?? 0) - (a.entry.metacritic ?? 0)
        || a.entry.name.localeCompare(b.entry.name),
      );
  }, [entries, matches]);

  const leaving = gamePass.filter((row) => row.match.leavingSoon).length;
  const [picked, setPicked] = useState<Tab | null>(null);
  // Something leaving Game Pass is the more urgent story; otherwise GeForce NOW.
  const preferred: Tab = leaving > 0 || gfn.length === 0 ? "gamepass" : "gfn";
  const tab: Tab = picked && (picked === "gfn" ? gfn.length : gamePass.length) > 0 ? picked : preferred;

  if (!matches || (gfn.length === 0 && gamePass.length === 0)) return null;

  const tabs =
    gfn.length > 0 && gamePass.length > 0 ? (
      <RailTabs<Tab>
        label="Service"
        value={tab}
        onChange={(next) => {
          haptic("selection");
          setPicked(next);
        }}
        options={[
          { value: "gfn", label: "GeForce NOW", icon: <Cloud size={13} aria-hidden />, count: gfn.length },
          { value: "gamepass", label: "Game Pass", icon: <BrandIcon name="xbox" size={13} title={null} />, count: gamePass.length },
        ]}
      />
    ) : undefined;

  const readyCount = gfn.filter((row) => row.ready).length;
  const subtitle =
    tab === "gamepass"
      ? leaving > 0
        ? <span className="text-gold">{leaving} leaving Game Pass soon</span>
        : undefined
      : readyCount > 0
        ? `${readyCount} ready to stream on GeForce NOW`
        : undefined;

  return (
    <SmartRail title={gfn.length > 0 ? "Play in the cloud" : "Play next on Game Pass"} subtitle={subtitle} header={tabs}>
      {tab === "gfn"
        ? gfn.map(({ entry, match, ready }) => (
            <div key={entry.gameId} className="relative">
              <PosterTile entry={entry} badge={ready ? `Ready · ${ready}` : `On ${match.stores.slice(0, 2).join(", ") || match.store || "GeForce NOW"}`} />
              <CoverChip tone={match.status === "available" ? "dark" : "gold"}>
                {match.status === "available" ? "GeForce NOW" : match.status === "maintenance" ? "Maintenance" : "Updating"}
              </CoverChip>
            </div>
          ))
        : gamePass.map(({ entry, match }) => (
            <div key={entry.gameId} className="relative">
              <PosterTile entry={entry} badge={entry.status === "playing" ? "Playing now" : caption(match, hours?.[entry.gameId])} />
              {(match.leavingSoon || match.recentlyAdded) && (
                <CoverChip tone={match.leavingSoon ? "gold" : "dark"}>{match.leavingSoon ? "Leaving soon" : "New"}</CoverChip>
              )}
            </div>
          ))}
    </SmartRail>
  );
}

/** The store you own it on that GeForce NOW streams from, by NVIDIA's name; null when none. */
function readyStore(entry: WatchlistEntry, match: GeForceNowMembership): string | null {
  const owned = new Set(entry.ownedOn ?? []);
  return match.stores.find((store) => owned.has(GFN_STORE[norm(store)] ?? "")) ?? null;
}

/** Sits over the cover's bottom edge; the cover is the tile's 3:4 top. */
function CoverChip({ tone, children }: { tone: "gold" | "dark"; children: string }) {
  return (
    <span className="pointer-events-none absolute inset-x-0 top-0 aspect-[3/4]">
      <span
        className={
          tone === "gold"
            ? "absolute bottom-2 left-2 rounded-full bg-gold px-2 py-0.5 text-[11px] font-semibold text-black shadow-lg"
            : "absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur"
        }
      >
        {children}
      </span>
    </span>
  );
}

/** Where it's included, plus length when IGDB knows it. The chip carries the urgency. */
function caption(match: GamePassMatch, ttb: TimeToBeatLike | undefined): string {
  const where = match.console && match.pc ? "Console & PC" : match.pc ? "PC" : "Console";
  const hours = ttb?.normally ?? ttb?.hastily ?? null;
  return `${where}${hours ? ` · ${Math.round(hours)} h` : ""}`;
}
