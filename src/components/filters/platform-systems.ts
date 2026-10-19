/**
 * Individual systems, grouped under the platform families the catalogue
 * filters on.
 *
 * The browse filter accepts either a family ("playstation") or an exact IGDB
 * platform slug ("ps5") — `platformIdsForFamilies` matches both — so these
 * slugs are real filter values, not display aliases. Each one was checked
 * against a live `/browse?platforms=<slug>` count. Newest system first in each
 * family, because that's the one most people are shopping for.
 *
 * The original Xbox is deliberately absent: its IGDB slug is "xbox", which is
 * also the family key, so a tile for it would silently show the whole family.
 */

import type { PlatformKey } from "@/lib/utils/format";

export interface PlatformSystem {
  slug: string;
  name: string;
}

export interface PlatformGroup {
  /** Family filter value and icon key. */
  family: PlatformKey;
  name: string;
  /** Tile hue — close to each brand's own colour so a family reads at a glance. */
  hue: number;
  systems: PlatformSystem[];
}

export const PLATFORM_GROUPS: PlatformGroup[] = [
  {
    family: "playstation",
    name: "PlayStation",
    hue: 222,
    systems: [
      { slug: "ps5", name: "PlayStation 5" },
      { slug: "ps4--1", name: "PlayStation 4" },
      { slug: "ps3", name: "PlayStation 3" },
      { slug: "ps2", name: "PlayStation 2" },
      { slug: "ps", name: "PlayStation" },
      { slug: "psvita", name: "PS Vita" },
      { slug: "psp", name: "PSP" },
    ],
  },
  {
    family: "xbox",
    name: "Xbox",
    hue: 128,
    systems: [
      { slug: "series-x-s", name: "Xbox Series X|S" },
      { slug: "xboxone", name: "Xbox One" },
      { slug: "xbox360", name: "Xbox 360" },
    ],
  },
  {
    family: "nintendo",
    name: "Nintendo",
    hue: 2,
    systems: [
      { slug: "switch-2", name: "Switch 2" },
      { slug: "switch", name: "Switch" },
      { slug: "3ds", name: "Nintendo 3DS" },
      { slug: "wiiu", name: "Wii U" },
      { slug: "wii", name: "Wii" },
      { slug: "nds", name: "Nintendo DS" },
    ],
  },
  {
    family: "pc",
    name: "PC",
    hue: 262,
    systems: [
      { slug: "win", name: "Windows" },
      { slug: "mac", name: "Mac" },
      { slug: "linux", name: "Linux" },
    ],
  },
  {
    family: "mobile",
    name: "Mobile",
    hue: 192,
    systems: [
      { slug: "ios", name: "iPhone & iPad" },
      { slug: "android", name: "Android" },
    ],
  },
];

/** slug → display name, for filter pills when a system (not a family) is chosen. */
export const SYSTEM_NAMES: ReadonlyMap<string, string> = new Map(
  PLATFORM_GROUPS.flatMap((group) => group.systems.map((system) => [system.slug, system.name] as const)),
);
