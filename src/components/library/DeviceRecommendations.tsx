"use client";

/**
 * "For your devices": recommendations split by the systems the reader
 * actually owns games on.
 *
 * Each tab sends the same anonymous taste shape the home page uses (top genre
 * ids, ids to exclude) plus that device's exact IGDB platform slugs, so a
 * PlayStation 5 tab never suggests a Switch exclusive. Results are filtered
 * on the client as well: when the profile is too thin the route falls back to
 * an unfiltered top-rated list, and a platform-blind fallback must not be
 * presented as "for your PS5".
 *
 * Steam Deck: ownership records do distinguish a Deck ("steam-deck"), so a
 * reader who has one gets the PC picks re-ordered Verified → Playable → the
 * rest, using Valve's own rating per game. Without a Deck, PC picks are left
 * in taste order and no Deck chips are shown.
 */

import { useEffect, useMemo, useState } from "react";
import { GameCard } from "@/components/game/GameCard";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { Skeleton } from "@/components/ui/Skeleton";
import { buildTasteProfile, MIN_TASTE_STRENGTH } from "@/lib/games/taste";
import { haptic } from "@/lib/haptics";
import { RailTabs, SmartRail } from "./SmartRail";
import type { WatchlistEntry } from "@/lib/firebase/db";
import type { DeckStatus, GamePcInfo, GameSummary } from "@/lib/games/types";

interface Device {
  id: string;
  label: string;
  icon: string | null;
  /** IGDB platform slugs a game must be on to count for this device. */
  igdb: string[];
  owned: number;
  deck?: boolean;
}

const PC_STORES = new Set(["steam", "epic", "gog", "xbox-pc", "battlenet", "ea", "ubisoft", "itch", "amazon-games", "rockstar", "direct-pc"]);

/**
 * Ownership slugs → device families. Newer consoles include their
 * predecessor's library (PS5 plays PS4 games, Series X|S plays Xbox One), so
 * they ask for both; an older console only asks for itself.
 */
function devicesFor(owned: WatchlistEntry[]): Device[] {
  const has = (slug: string) => owned.filter((entry) => (entry.ownedOn ?? []).includes(slug)).length;
  const count = (test: (slug: string) => boolean) => owned.filter((entry) => (entry.ownedOn ?? []).some(test)).length;
  const devices: Device[] = [];

  const deck = has("steam-deck") > 0;
  const pc = count((slug) => PC_STORES.has(slug) || slug === "steam-deck");
  if (pc > 0) {
    const onlyDeck = deck && count((slug) => PC_STORES.has(slug)) === 0;
    devices.push({ id: "pc", label: onlyDeck ? "Steam Deck" : deck ? "PC & Steam Deck" : "PC", icon: "steam", igdb: ["win"], owned: pc, deck });
  }

  const ps5 = has("ps5");
  const ps4 = has("ps4");
  const psAny = count((slug) => slug === "ps5" || slug === "ps4" || slug === "playstation");
  if (psAny > 0) {
    devices.push(
      ps5 > 0
        ? { id: "ps", label: "PlayStation 5", icon: "playstation", igdb: ["ps5", "ps4--1"], owned: psAny }
        : ps4 > 0
          ? { id: "ps", label: "PlayStation 4", icon: "playstation", igdb: ["ps4--1"], owned: psAny }
          : { id: "ps", label: "PlayStation", icon: "playstation", igdb: ["ps5", "ps4--1"], owned: psAny },
    );
  }

  const series = has("xbox-series");
  const xboxAny = count((slug) => slug === "xbox-series" || slug === "xbox-one" || slug === "xbox");
  if (xboxAny > 0) {
    devices.push(
      series > 0 || has("xbox") > 0
        ? { id: "xbox", label: series > 0 ? "Xbox Series X|S" : "Xbox", icon: "xbox", igdb: ["series-x-s", "xboxone"], owned: xboxAny }
        : { id: "xbox", label: "Xbox One", icon: "xbox", igdb: ["xboxone"], owned: xboxAny },
    );
  }

  const switch2 = has("switch-2");
  const nintendoAny = count((slug) => slug === "switch-2" || slug === "switch" || slug === "nintendo");
  if (nintendoAny > 0) {
    devices.push(
      switch2 > 0
        ? { id: "nintendo", label: "Switch 2", icon: "nintendo", igdb: ["switch-2", "switch"], owned: nintendoAny }
        : { id: "nintendo", label: "Switch", icon: "nintendo", igdb: ["switch"], owned: nintendoAny },
    );
  }

  const mobile = count((slug) => slug === "googleplay" || slug === "appstore");
  if (mobile > 0) {
    const ios = has("appstore") > 0;
    const android = has("googleplay") > 0;
    devices.push({
      id: "mobile",
      label: ios && !android ? "iPhone & iPad" : android && !ios ? "Android" : "Mobile",
      icon: null,
      igdb: [...(ios ? ["ios"] : []), ...(android ? ["android"] : [])],
      owned: mobile,
    });
  }

  return devices.sort((a, b) => b.owned - a.owned);
}

const DECK_ORDER: Record<DeckStatus, number> = { verified: 0, playable: 1, unknown: 2, unsupported: 3 };

type Result = { key: string; games: GameSummary[]; deck: Record<number, DeckStatus | null> | null };

export default function DeviceRecommendations({ entries }: { entries: WatchlistEntry[] }) {
  const owned = useMemo(() => entries.filter((entry) => (entry.ownedOn ?? []).length > 0), [entries]);
  const devices = useMemo(() => devicesFor(owned), [owned]);
  const [picked, setPicked] = useState<string | null>(null);
  const device = devices.find((item) => item.id === picked) ?? devices[0];

  const profile = useMemo(
    () =>
      buildTasteProfile(
        entries.map((entry) => ({
          gameId: entry.gameId,
          genreIds: entry.genreIds ?? [],
          platformSlugs: entry.platformSlugs ?? [],
          status: entry.status,
          platform: entry.platform ?? null,
          addedAt: entry.addedAt,
          finishedAt: entry.finishedAt ?? null,
        })),
      ),
    [entries],
  );
  const usable = profile.strength >= MIN_TASTE_STRENGTH && profile.genreIds.length > 0;
  const known = useMemo(() => new Set(entries.map((entry) => entry.gameId)), [entries]);

  const key = usable && device
    ? [device.id, device.igdb.join(","), profile.genreIds.join(","), profile.excludeIds.slice(0, 40).join(","), device.deck ? "deck" : ""].join("|")
    : "";
  const [results, setResults] = useState<Record<string, Result>>({});

  useEffect(() => {
    if (!key || !device || results[key]) return;
    const controller = new AbortController();
    const [, platforms, genres, exclude, deckFlag] = key.split("|");
    const wanted = new Set(platforms.split(","));
    const params = new URLSearchParams({ genres, platforms, exclude, limit: "16" });

    void (async () => {
      try {
        const response = await fetch(`/api/recommendations?${params}`, { signal: controller.signal });
        const body = (response.ok ? await response.json() : { results: [] }) as { results?: GameSummary[] };
        const games = (Array.isArray(body.results) ? body.results : [])
          .filter((game) => !known.has(game.id) && game.platforms.some((platform) => wanted.has(platform.slug)))
          .slice(0, 12);

        let deck: Result["deck"] = null;
        if (deckFlag && games.length > 0) {
          // Valve's per-game rating; cached at the edge for a day, so a
          // revisit costs nothing. A miss is "unknown", never "unsupported".
          const statuses = await Promise.all(
            games.map((game) =>
              fetch(`/api/game/${game.id}/pc`, { signal: controller.signal })
                .then((r) => (r.ok ? (r.json() as Promise<GamePcInfo>) : null))
                .then((info) => [game.id, info?.deck ?? null] as const)
                .catch(() => [game.id, null] as const),
            ),
          );
          deck = Object.fromEntries(statuses);
          const rank = (id: number) => DECK_ORDER[deck?.[id] ?? "unknown"];
          games.sort((a, b) => rank(a.id) - rank(b.id));
        }
        setResults((current) => ({ ...current, [key]: { key, games, deck } }));
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setResults((current) => ({ ...current, [key]: { key, games: [], deck: null } }));
        }
      }
    })();
    return () => controller.abort();
  }, [key, device, known, results]);

  if (!usable || !device) return null;
  const current = results[key];
  const tabs = devices.length > 1 ? (
    <RailTabs
      label="Device"
      value={device.id}
      onChange={(next) => {
        haptic("selection");
        setPicked(next);
      }}
      options={devices.map((item) => ({
        value: item.id,
        label: item.label,
        icon: item.icon ? <BrandIcon name={item.icon} size={13} title={null} /> : undefined,
      }))}
    />
  ) : undefined;

  const title = devices.length > 1 ? "For your devices" : `For your ${device.label}`;

  if (!current) {
    return (
      <SmartRail title={title} header={tabs} itemClassName="w-[140px] sm:w-[176px]">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="aspect-[3/4] w-full rounded-2xl" />
        ))}
      </SmartRail>
    );
  }

  if (current.games.length === 0) {
    return (
      <SmartRail title={title} header={tabs} itemClassName="w-full">
        <p className="py-6 text-[15px] text-muted">No new picks for {device.label} right now.</p>
      </SmartRail>
    );
  }

  return (
    <SmartRail title={title} header={tabs} itemClassName="w-[140px] sm:w-[176px]">
      {current.games.map((game) => {
        const deck = current.deck?.[game.id] ?? null;
        return (
          <div key={game.id} className="relative">
            <GameCard game={game} sizes="176px" showOwnership={false} />
            {(deck === "verified" || deck === "playable") && (
              <span className="pointer-events-none absolute inset-x-0 top-0 aspect-[3/4]">
                <span
                  className={
                    deck === "verified"
                      ? "absolute bottom-2 left-2 rounded-full bg-mint px-2 py-0.5 text-[11px] font-semibold text-black shadow-lg"
                      : "absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur"
                  }
                >
                  {deck === "verified" ? "Deck Verified" : "Deck Playable"}
                </span>
              </span>
            )}
          </div>
        );
      })}
    </SmartRail>
  );
}
