"use client";

/**
 * "For your devices": the recommendation engine's picks that run on the
 * systems the reader owns games on, one tab per device.
 *
 * The picks come from recommendations v2 (`onYourDevices`, topped up from
 * "For you"), the same cached answer the home page and /for-you use — so
 * this shelf costs no request of its own. Each tab keeps only games on that
 * device's exact IGDB platforms (a PlayStation 5 tab never suggests a Switch
 * exclusive), and every card says why it was picked.
 */

import { useMemo, useState } from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { RecPosterCard } from "@/components/recs/RecCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { haptic } from "@/lib/haptics";
import { useRecommendationsV2 } from "@/lib/recs/use-recommendations";
import { RailTabs, SmartRail } from "./SmartRail";
import type { WatchlistEntry } from "@/lib/firebase/db";
import type { RecommendedGame } from "@/lib/games/types";

interface Device {
  id: string;
  label: string;
  icon: string | null;
  /** IGDB platform slugs a game must be on to count for this device. */
  igdb: string[];
  owned: number;
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
    devices.push({ id: "pc", label: onlyDeck ? "Steam Deck" : deck ? "PC & Steam Deck" : "PC", icon: "steam", igdb: ["win"], owned: pc });
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

const PER_DEVICE = 14;

export default function DeviceRecommendations({ entries }: { entries: WatchlistEntry[] }) {
  const owned = useMemo(() => entries.filter((entry) => (entry.ownedOn ?? []).length > 0), [entries]);
  const devices = useMemo(() => devicesFor(owned), [owned]);
  const [picked, setPicked] = useState<string | null>(null);
  const device = devices.find((item) => item.id === picked) ?? devices[0];
  const { view } = useRecommendationsV2({ enabled: devices.length > 0 });

  const picks = useMemo<RecommendedGame[]>(() => {
    if (view.status !== "ready" || !device) return [];
    const wanted = new Set(device.igdb);
    const seen = new Set<number>();
    return [...view.data.onYourDevices, ...view.data.forYou]
      .filter((rec) => {
        if (seen.has(rec.game.id) || !rec.game.platforms.some((platform) => wanted.has(platform.slug))) return false;
        seen.add(rec.game.id);
        return true;
      })
      .slice(0, PER_DEVICE);
  }, [view, device]);

  if (!device || view.status === "off" || view.status === "error") return null;

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

  if (view.status === "loading") {
    return (
      <SmartRail title={title} header={tabs} itemClassName="w-[140px] sm:w-[176px]">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="aspect-[3/4] w-full rounded-2xl" />
        ))}
      </SmartRail>
    );
  }

  if (picks.length === 0) {
    return (
      <SmartRail title={title} header={tabs} seeAllHref="/for-you" itemClassName="w-full">
        <p className="py-6 text-[15px] text-muted">No new picks for {device.label} right now.</p>
      </SmartRail>
    );
  }

  return (
    <SmartRail title={title} header={tabs} seeAllHref="/for-you" itemClassName="w-[140px] sm:w-[176px]">
      {picks.map((rec) => (
        <RecPosterCard key={rec.game.id} rec={rec} skip={["platform"]} />
      ))}
    </SmartRail>
  );
}
