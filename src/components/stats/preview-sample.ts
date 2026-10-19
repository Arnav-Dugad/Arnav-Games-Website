/**
 * DEV PREVIEW ONLY — sample library for `/stats/preview`.
 *
 * Nothing here is ever shown to a real user: the preview route 404s outside
 * `next dev`. It exists so the stats charts can be screenshotted and reviewed
 * without signing in, by pushing realistic records through the exact same
 * `buildPersonalAnalytics` pipeline the live page uses. Titles and scores are
 * approximate and purely illustrative.
 */

import type { WatchStatus, WatchlistEntry } from "@/lib/firebase/db";
import type { TimeToBeatLike } from "@/lib/games/stats";
import type { BatchPrices, GamePassMatches } from "@/lib/games/types";

const G = {
  rpg: { id: 12, slug: "role-playing-rpg", name: "Role-playing (RPG)" },
  adventure: { id: 31, slug: "adventure", name: "Adventure" },
  shooter: { id: 5, slug: "shooter", name: "Shooter" },
  platform: { id: 8, slug: "platform", name: "Platform" },
  puzzle: { id: 9, slug: "puzzle", name: "Puzzle" },
  racing: { id: 10, slug: "racing", name: "Racing" },
  strategy: { id: 15, slug: "strategy", name: "Strategy" },
  indie: { id: 32, slug: "indie", name: "Indie" },
  fighting: { id: 4, slug: "fighting", name: "Fighting" },
  hack: { id: 25, slug: "hack-and-slash-beat-em-up", name: "Hack and slash/Beat 'em up" },
  simulator: { id: 13, slug: "simulator", name: "Simulator" },
  tactical: { id: 24, slug: "tactical", name: "Tactical" },
  sport: { id: 14, slug: "sport", name: "Sport" },
} as const;

type GenreKey = keyof typeof G;

/** [name, released, metacritic, genres, status, ownedOn, play platform, added (YYYY-MM), hours "normally"] */
type Row = [string, string | null, number | null, GenreKey[], WatchStatus, string[], string | null, string, number | null];

const ROWS: Row[] = [
  ["The Witcher 3: Wild Hunt", "2015-05-19", 93, ["rpg", "adventure"], "played", ["steam"], "steam", "2023-01", 51],
  ["Elden Ring", "2022-02-25", 95, ["rpg", "adventure"], "played", ["ps5"], "ps5", "2023-02", 60],
  ["Hollow Knight", "2017-02-24", 87, ["platform", "adventure", "indie"], "played", ["switch"], "switch", "2023-03", 27],
  ["Hades", "2020-09-17", 93, ["rpg", "hack", "indie"], "played", ["steam", "switch"], "switch", "2023-04", 23],
  ["Celeste", "2018-01-25", 92, ["platform", "indie"], "played", ["steam"], null, "2023-06", 8],
  ["Doom Eternal", "2020-03-20", 88, ["shooter"], "played", ["xbox-series"], "xbox-series", "2023-07", 14],
  ["Forza Horizon 5", "2021-11-09", 92, ["racing", "simulator"], "playing", ["xbox-series"], "xbox-series", "2023-09", 22],
  ["Disco Elysium", "2019-10-15", 91, ["rpg", "adventure", "indie"], "want", ["steam"], null, "2023-11", 24],
  ["Persona 5 Royal", "2020-10-31", 95, ["rpg"], "played", ["ps5"], "ps5", "2024-01", 103],
  ["Baldur's Gate 3", "2023-08-03", 96, ["rpg", "strategy", "tactical"], "played", ["steam"], "steam", "2024-02", 75],
  ["Final Fantasy VII Rebirth", "2024-02-29", 92, ["rpg", "adventure"], "playing", ["ps5"], "ps5", "2024-03", 47],
  ["Into the Breach", "2018-02-27", 90, ["strategy", "tactical", "indie"], "played", ["switch"], "switch", "2024-04", 9],
  ["XCOM 2", "2016-02-05", 88, ["strategy", "tactical"], "none", ["steam", "epic"], null, "2024-05", 38],
  ["Divinity: Original Sin 2", "2017-09-14", 93, ["rpg", "strategy", "tactical"], "want", ["steam"], null, "2024-06", 70],
  ["Tekken 8", "2024-01-26", 90, ["fighting"], "playing", ["ps5"], "ps5", "2024-07", null],
  ["Street Fighter 6", "2023-06-02", 92, ["fighting"], "none", ["ps5"], null, "2024-08", 9],
  ["Metaphor: ReFantazio", "2024-10-11", 94, ["rpg", "adventure"], "want", ["xbox-series"], null, "2024-10", 70],
  ["Balatro", "2024-02-20", 90, ["strategy", "puzzle", "indie"], "played", ["steam", "appstore"], "appstore", "2024-11", 12],
  ["Astro Bot", "2024-09-06", 94, ["platform"], "played", ["ps5"], "ps5", "2025-01", 12],
  ["Animal Well", "2024-05-09", 91, ["platform", "puzzle", "indie"], "want", ["steam"], null, "2025-02", 9],
  ["Clair Obscur: Expedition 33", "2025-04-24", 92, ["rpg", "tactical"], "played", ["ps5"], "ps5", "2025-04", 30],
  ["Split Fiction", "2025-03-06", 91, ["platform", "adventure", "puzzle"], "played", ["steam"], "steam", "2025-03", 14],
  ["Mario Kart World", "2025-06-05", 86, ["racing"], "playing", ["switch-2"], "switch-2", "2025-06", 15],
  ["Hollow Knight: Silksong", "2025-09-04", 91, ["platform", "adventure", "indie"], "playing", ["switch-2", "steam"], null, "2025-09", 40],
  ["Ghost of Yōtei", "2025-10-02", 87, ["adventure", "hack"], "want", ["ps5"], null, "2025-10", 32],
  ["Hades II", "2025-09-25", 95, ["rpg", "hack", "indie"], "played", ["switch-2"], "switch-2", "2025-11", 30],
  ["Civilization VII", "2025-02-11", 79, ["strategy"], "none", ["steam"], null, "2026-01", 30],
  ["Blue Prince", "2025-04-10", 92, ["puzzle", "indie"], "played", ["xbox-series"], "xbox-series", "2026-02", 26],
  ["Death Stranding 2", "2025-06-26", 90, ["adventure", "shooter"], "want", ["ps5"], null, "2026-03", 48],
  ["Kingdom Come: Deliverance II", "2025-02-04", 88, ["rpg", "adventure"], "none", ["steam"], null, "2026-04", 60],
  ["Super Mario Galaxy", "2007-11-01", 97, ["platform"], "played", ["physical"], "switch", "2026-05", 16],
  ["Half-Life 2", "2004-11-16", 96, ["shooter"], "played", ["steam"], "steam", "2026-06", 13],
  ["Chrono Trigger", "1995-03-11", 92, ["rpg"], "played", ["physical"], null, "2026-07", 23],
  ["Grand Theft Auto VI", null, null, ["adventure", "shooter", "racing"], "want", [], null, "2026-08", null],
  ["The Elder Scrolls VI", null, null, ["rpg", "adventure"], "none", [], null, "2026-09", null],
  ["Baldur's Gate II: Shadows of Amn", "2000-09-24", 95, ["rpg", "strategy"], "none", ["gog"], null, "2026-09", 70],
  ["Tony Hawk's Pro Skater 2", "2000-09-20", 98, ["sport"], "none", ["physical"], null, "2026-09", 6],
];

export function sampleLibrary(limit = ROWS.length): { entries: WatchlistEntry[]; timeToBeat: Record<number, TimeToBeatLike> } {
  const timeToBeat: Record<number, TimeToBeatLike> = {};
  const entries = ROWS.slice(0, limit).map(([name, released, metacritic, genres, status, ownedOn, platform, added, hours], index): WatchlistEntry => {
    const gameId = 900_000 + index;
    if (hours !== null) timeToBeat[gameId] = { hastily: Math.round(hours * 0.7), normally: hours, completely: Math.round(hours * 1.8) };
    const addedAt = Date.parse(`${added}-15T12:00:00Z`);
    return {
      gameId,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      name,
      image: null,
      imageFallback: null,
      released,
      releaseWindow: released ? null : "TBA",
      tba: !released,
      metacritic,
      following: status === "want",
      watchlisted: status === "want" || status === "none",
      metadataVersion: 3,
      metadataUpdatedAt: addedAt,
      status,
      platform,
      startedAt: status === "playing" || status === "played" ? addedAt : null,
      finishedAt: status === "played" ? addedAt + 30 * 86_400_000 : null,
      genreIds: genres.map((key) => G[key].id),
      genres: genres.map((key) => G[key]),
      platformSlugs: [],
      ownedOn,
      subscriptionAccess: [],
      followedReleases: [],
      addedAt,
    };
  });
  return { entries, timeToBeat };
}

/** A plausible benchmark shape; the live page computes the real one from IGDB. */
export const SAMPLE_BENCHMARK = { average: 84, sample: 200 };

/* ---------------------------------------------------------------------------
 * Market samples for the collection previews. Same rules as above: dev-only,
 * illustrative, never shown to a real reader (the routes 404 in production).
 * The sample ids are fake, so the live price and Game Pass routes can't
 * answer for them — these stand in.
 * ------------------------------------------------------------------------ */

/** Illustrative Game Pass overlap for `/library/preview`, keyed by sample id. */
export function sampleGamePass(entries: WatchlistEntry[]): GamePassMatches {
  const id = (name: string) => String(entries.find((entry) => entry.name === name)?.gameId ?? "");
  const out: GamePassMatches = {
    [id("Metaphor: ReFantazio")]: { console: true, pc: true, leavingSoon: true, recentlyAdded: false },
    [id("Forza Horizon 5")]: { console: true, pc: true, leavingSoon: true, recentlyAdded: false },
    [id("Disco Elysium")]: { console: true, pc: true, leavingSoon: false, recentlyAdded: false },
    [id("XCOM 2")]: { console: false, pc: true, leavingSoon: false, recentlyAdded: true },
    [id("Civilization VII")]: { console: false, pc: true, leavingSoon: false, recentlyAdded: false },
  };
  delete out[""];
  return out;
}

/** [name, released, metacritic, hours, price ¢, initial ¢ | null, store] — a wishlist of games not owned. */
type WishRow = [string, string, number, number | null, number | null, number | null, "steam" | "microsoft"];

const WISHLIST: WishRow[] = [
  ["Cyberpunk 2077", "2020-12-10", 86, 25, 2999, 5999, "steam"],
  ["Sekiro: Shadows Die Twice", "2019-03-22", 90, 30, 5999, null, "steam"],
  ["Outer Wilds", "2019-05-28", 85, 17, 2499, null, "steam"],
  ["Hi-Fi Rush", "2023-01-25", 89, 11, 899, 2999, "microsoft"],
  ["Pentiment", "2022-11-15", 86, 18, 1999, null, "microsoft"],
  ["Return of the Obra Dinn", "2018-10-18", 89, 10, 999, 1999, "steam"],
  ["Lies of P", "2023-09-19", 80, 35, 2999, 5999, "steam"],
  ["Starfield", "2023-09-06", 83, 40, 6999, null, "microsoft"],
  ["Tunic", "2022-03-16", 85, 12, 2999, null, "steam"],
  ["Vampire Survivors", "2022-10-20", 86, 15, 499, null, "steam"],
  ["Alan Wake 2", "2023-10-27", 89, 18, null, null, "steam"],
];

/** Wishlisted, released, unowned sample games plus US store prices, for `/watchlist/preview`. */
export function sampleWishlist(): {
  entries: WatchlistEntry[];
  prices: BatchPrices;
  timeToBeat: Record<number, TimeToBeatLike>;
} {
  const prices: BatchPrices = {};
  const timeToBeat: Record<number, TimeToBeatLike> = {};
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const entries = WISHLIST.map(([name, released, metacritic, hours, price, initial, store], index): WatchlistEntry => {
    const gameId = 950_000 + index;
    const addedAt = Date.parse(`2026-0${(index % 9) + 1}-10T12:00:00Z`);
    if (hours !== null) timeToBeat[gameId] = { hastily: Math.round(hours * 0.7), normally: hours, completely: Math.round(hours * 1.8) };
    prices[String(gameId)] = price === null ? null : {
      store,
      country: "US",
      currency: "USD",
      price,
      initial,
      discount: initial ? Math.round((1 - price / initial) * 100) : 0,
      formatted: usd.format(price / 100),
      url: store === "steam" ? "https://store.steampowered.com/" : "https://www.xbox.com/games/store",
    };
    return {
      gameId,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      name,
      image: null,
      imageFallback: null,
      released,
      releaseWindow: null,
      tba: false,
      metacritic,
      following: false,
      watchlisted: true,
      metadataVersion: 3,
      metadataUpdatedAt: addedAt,
      status: "want",
      platform: null,
      startedAt: null,
      finishedAt: null,
      genreIds: [],
      genres: [],
      platformSlugs: [],
      ownedOn: [],
      subscriptionAccess: [],
      followedReleases: [],
      addedAt,
    };
  });
  return { entries, prices, timeToBeat };
}
