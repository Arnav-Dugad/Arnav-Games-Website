import { localReleaseFor, regionForCountry } from "@/lib/games/regions";
import { isDelay } from "@/lib/games/release-value";
import { formatDate, parseISO } from "@/lib/utils/format";
import type { GameDetail, ReleaseChange, ReleaseEvent } from "@/lib/games/types";

/**
 * Release facts for one reader: which date applies where they are, and how
 * the date has moved since we started watching it. Pure, server-side.
 */

export interface LocalRelease {
  /** The ISO day that applies to this reader (their region, else the game's). */
  date: string | null;
  /** Their release row's region, when it decided the date. */
  region: string | null;
  /** Readable country name for the visitor, when known. */
  countryName: string | null;
  /** True when the reader's region has a different day than the headline one. */
  differs: boolean;
}

export function countryName(iso2: string | null): string | null {
  if (!iso2) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(iso2) ?? null;
  } catch {
    return null;
  }
}

export function localRelease(game: Pick<GameDetail, "released" | "releases">, country: string | null): LocalRelease {
  const row = country ? localReleaseFor(game.releases, country) : null;
  const date = row?.date ?? game.released;
  return {
    date,
    region: row ? row.region ?? "Worldwide" : null,
    countryName: countryName(country),
    differs: Boolean(row?.date && game.released && row.date !== game.released),
  };
}

/** The IGDB region the visitor's country resolves to, among this game's rows. */
export function visitorRegion(releases: ReleaseEvent[], country: string | null): string | null {
  if (!country) return null;
  const present = new Set(releases.map((release) => release.region ?? "Worldwide"));
  return regionForCountry(country).find((region) => present.has(region)) ?? null;
}

/** "2026-11-14" → "Nov 14, 2026"; windows ("Q4 2026") and "TBA" pass through. */
export function releaseValueLabel(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value;
}

export function delayCount(changes: ReleaseChange[] | undefined): number {
  return (changes ?? []).filter((change) => isDelay(change.from, change.to)).length;
}

/** Signed days between two ISO days, or null if either is a window. */
export function slipDays(from: string, to: string): number | null {
  const a = /^\d{4}-\d{2}-\d{2}$/.test(from) ? parseISO(from) : null;
  const b = /^\d{4}-\d{2}-\d{2}$/.test(to) ? parseISO(to) : null;
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export interface RegionGroup {
  region: string;
  rows: { label: string; date: string | null; platforms: string[] }[];
}

/**
 * Releases grouped by region, and within a region by day, so "Feb 25, 2022 —
 * PC, PS4, PS5, Xbox One, Series X|S" is one row rather than five identical
 * ones. Worldwide leads; the rest follow alphabetically.
 */
export function groupReleases(releases: ReleaseEvent[]): RegionGroup[] {
  const byRegion = new Map<string, Map<string, { label: string; date: string | null; platforms: string[] }>>();
  for (const release of releases) {
    const region = release.region ?? "Worldwide";
    const rows = byRegion.get(region) ?? new Map();
    byRegion.set(region, rows);
    const key = release.date ?? release.human;
    const row = rows.get(key) ?? { label: release.date ? formatDate(release.date) : release.human, date: release.date, platforms: [] };
    if (release.platform && !row.platforms.includes(release.platform)) row.platforms.push(release.platform);
    rows.set(key, row);
  }
  return [...byRegion.entries()]
    .sort(([a], [b]) => (a === "Worldwide" ? -1 : b === "Worldwide" ? 1 : a.localeCompare(b)))
    .map(([region, rows]) => ({
      region,
      rows: [...rows.values()].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999")),
    }));
}

/** Short platform names for dense rows. */
export function shortPlatform(name: string): string {
  return name
    .replace("PC (Microsoft Windows)", "PC")
    .replace(/^PlayStation (\d)$/, "PS$1")
    .replace("Xbox Series X|S", "Xbox Series")
    .replace("Nintendo Switch", "Switch");
}
