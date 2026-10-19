/**
 * Pure parsing and matching for the round-5 sources: NVIDIA GeForce NOW,
 * AreWeAntiCheatYet, SteamSpy, PCGamingWiki, speedrun.com, Thunderstore, the
 * Epic free-games feed and GOG. No I/O lives here — the fetching modules hand
 * raw JSON/wikitext in and get compact, typed values out — so every rule that
 * decides "is this the same game?" or "is this free right now?" can be pinned
 * down in `scripts/check-providers.ts` without a network.
 *
 * Matching policy, shared by every source: a store id (Steam appid) first,
 * then an *exact* title after normalisation. Fuzzy matching would put a
 * badge on the wrong game, and a missing badge is the honest failure.
 */

import type {
  AntiCheatState,
  AntiCheatStatus,
  GeForceNowMembership,
  PcgwFeatureKey,
  PcgwFeatures,
  PcgwSupport,
  SpeedrunRecords,
  SteamSpyData,
  ThunderstoreMod,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/* ---------------------------------------------------------------------------
 * Titles
 * ------------------------------------------------------------------------ */

/**
 * A comparison key for game titles across stores: case, trademark marks,
 * punctuation, "&"/"and" and runs of whitespace don't distinguish games.
 * Digits and roman numerals are kept — "Doom" and "Doom II" are different.
 */
export function normaliseTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Edition suffixes a store may add to the same base game. */
const EDITION_SUFFIX =
  /^(remastered|game of the year( edition)?|goty( edition)?|complete( edition)?|definitive( edition)?|enhanced( edition)?|directors cut|deluxe( edition)?|standard( edition)?|ultimate( edition)?|gold( edition)?)$/;

/**
 * True when `storeTitle` is `name` exactly, or `name` plus a known edition
 * suffix ("The Witcher 3: Wild Hunt — Remastered").
 */
export function sameGameTitle(storeTitle: string, name: string): "exact" | "edition" | null {
  const a = normaliseTitle(storeTitle);
  const b = normaliseTitle(name);
  if (!a || !b) return null;
  if (a === b) return "exact";
  if (a.startsWith(`${b} `) && EDITION_SUFFIX.test(a.slice(b.length + 1))) return "edition";
  return null;
}

/** Steam appid from a store URL ("https://store.steampowered.com/app/1358020"). */
export function steamAppFromUrl(url: unknown): number | null {
  const match = typeof url === "string" ? /store\.steampowered\.com\/app\/(\d{1,10})/.exec(url) : null;
  const id = match ? Number(match[1]) : 0;
  return id > 0 ? id : null;
}

/* ---------------------------------------------------------------------------
 * GeForce NOW
 * ------------------------------------------------------------------------ */

/** [normalised title, steam appid or 0, store, optimized 0/1, status code]. */
export type GfnRow = [string, number, string, 0 | 1, 0 | 1 | 2];
const GFN_STATUS = ["available", "maintenance", "patching"] as const;

/**
 * NVIDIA's ~400 KB catalogue → ~60 KB of rows. Entries with an unknown status
 * are dropped rather than guessed at.
 */
export function compactGfn(raw: unknown): GfnRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: GfnRow[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const title = str(item.title);
    const status = GFN_STATUS.indexOf(String(item.status ?? "").toLowerCase() as (typeof GFN_STATUS)[number]);
    if (!title || status < 0) continue;
    rows.push([
      normaliseTitle(title),
      steamAppFromUrl(item.steamUrl) ?? 0,
      str(item.store) ?? "",
      item.isFullyOptimized === true ? 1 : 0,
      status as 0 | 1 | 2,
    ]);
  }
  return rows;
}

export interface GfnLookup {
  bySteam: Map<number, GfnRow[]>;
  byTitle: Map<string, GfnRow[]>;
}

/** Built once per request; ~1.5k rows. */
export function gfnLookup(rows: GfnRow[]): GfnLookup {
  const bySteam = new Map<number, GfnRow[]>();
  const byTitle = new Map<string, GfnRow[]>();
  for (const row of rows) {
    if (row[1]) bySteam.set(row[1], [...(bySteam.get(row[1]) ?? []), row]);
    byTitle.set(row[0], [...(byTitle.get(row[0]) ?? []), row]);
  }
  return { bySteam, byTitle };
}

export const GFN_NOT_LISTED: GeForceNowMembership = {
  available: false,
  store: null,
  stores: [],
  optimized: false,
  status: "not-listed",
  matchedBy: null,
};

/**
 * Steam appid first; otherwise an exact normalised title. A Steam match also
 * collects same-titled rows, because NVIDIA lists the Epic/Ubisoft copies of a
 * game as separate entries without a Steam link.
 */
export function gfnMembership(lookup: GfnLookup, game: { steam: number | null; name: string | null }): GeForceNowMembership {
  let rows = game.steam ? lookup.bySteam.get(game.steam) ?? [] : [];
  const matchedBy: GeForceNowMembership["matchedBy"] = rows.length > 0 ? "steam" : game.name ? "title" : null;
  const title = rows[0]?.[0] ?? (game.name ? normaliseTitle(game.name) : "");
  const sameTitle = title ? lookup.byTitle.get(title) ?? [] : [];
  // A title-only row tied to a *different* Steam app is another game of the same name.
  rows = [...new Set([...rows, ...sameTitle.filter((row) => !row[1] || !game.steam || row[1] === game.steam)])];
  if (rows.length === 0) return GFN_NOT_LISTED;
  const best = rows.find((row) => row[4] === 0) ?? rows[0];
  return {
    available: rows.some((row) => row[4] === 0),
    store: best[2] || null,
    stores: [...new Set(rows.map((row) => row[2]).filter(Boolean))],
    optimized: rows.some((row) => row[3] === 1),
    status: GFN_STATUS[best[4]],
    matchedBy,
  };
}

/* ---------------------------------------------------------------------------
 * AreWeAntiCheatYet
 * ------------------------------------------------------------------------ */

/** [normalised name, steam appid or 0, status, anticheats, native 0/1, updated, slug]. */
export type AntiCheatRow = [string, number, AntiCheatState, string[], 0 | 1, string | null, string];
const AC_STATES: AntiCheatState[] = ["supported", "running", "planned", "broken", "denied"];

export function compactAntiCheat(raw: unknown): AntiCheatRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: AntiCheatRow[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = str(item.name);
    const status = String(item.status ?? "").toLowerCase() as AntiCheatState;
    const slug = str(item.slug);
    if (!name || !slug || !AC_STATES.includes(status)) continue;
    const steam = isRecord(item.storeIds) ? Number(item.storeIds.steam) : 0;
    rows.push([
      normaliseTitle(name),
      Number.isInteger(steam) && steam > 0 ? steam : 0,
      status,
      Array.isArray(item.anticheats) ? item.anticheats.filter((a): a is string => typeof a === "string").slice(0, 4) : [],
      item.native === true ? 1 : 0,
      str(item.dateChanged),
      slug,
    ]);
  }
  return rows;
}

export function antiCheatFor(rows: AntiCheatRow[], game: { steam: number | null; name: string | null }): AntiCheatStatus | null {
  const title = game.name ? normaliseTitle(game.name) : "";
  const row =
    (game.steam ? rows.find((r) => r[1] === game.steam) : undefined) ??
    // By title only when the row has no Steam id of its own to contradict us.
    (title ? rows.find((r) => r[0] === title && (!r[1] || !game.steam)) : undefined);
  if (!row) return null;
  return {
    status: row[2],
    anticheats: row[3],
    native: row[4] === 1,
    updated: row[5],
    url: `https://areweanticheatyet.com/game/${encodeURIComponent(row[6])}`,
  };
}

/* ---------------------------------------------------------------------------
 * SteamSpy
 * ------------------------------------------------------------------------ */

/** "20,000,000 .. 50,000,000" → { low, high }. */
export function parseOwners(raw: unknown): { low: number; high: number } | null {
  const match = typeof raw === "string" ? /^([\d,]+)\s*\.\.\s*([\d,]+)$/.exec(raw.trim()) : null;
  if (!match) return null;
  const low = Number(match[1].replace(/,/g, ""));
  const high = Number(match[2].replace(/,/g, ""));
  return Number.isFinite(low) && Number.isFinite(high) && high > 0 && high >= low ? { low, high } : null;
}

/** Minutes → hours (one decimal); 0 means "not published", so null. */
const minutesToHours = (value: unknown) => {
  const minutes = num(value);
  return minutes && minutes > 0 ? Math.round((minutes / 60) * 10) / 10 : null;
};

export function parseSteamSpy(raw: unknown, appId: number): SteamSpyData | null {
  if (!isRecord(raw) || Number(raw.appid) !== appId || !str(raw.name)) return null;
  const tags = isRecord(raw.tags)
    ? Object.entries(raw.tags)
        .map(([name, votes]) => ({ name, votes: num(votes) ?? 0 }))
        .filter((tag) => tag.name && tag.votes > 0)
        .sort((a, b) => b.votes - a.votes)
        .slice(0, 20)
    : [];
  const ccu = num(raw.ccu);
  return {
    appId,
    tags,
    owners: parseOwners(raw.owners),
    ccu: ccu !== null && ccu >= 0 ? ccu : null,
    playtime: {
      average: minutesToHours(raw.average_forever),
      median: minutesToHours(raw.median_forever),
      average2Weeks: minutesToHours(raw.average_2weeks),
      median2Weeks: minutesToHours(raw.median_2weeks),
    },
    positive: Math.max(0, num(raw.positive) ?? 0),
    negative: Math.max(0, num(raw.negative) ?? 0),
  };
}

/**
 * A SteamSpy `request=tag` answer (every app with that tag, ~0.5 MB) → the
 * best-received appids with real audiences, best first. Score is the lower
 * bound of a simple positive-share estimate, so 40/40 doesn't outrank
 * 95k/100k.
 */
export function topTaggedApps(raw: unknown, limit: number): number[] {
  if (!isRecord(raw)) return [];
  const scored: Array<{ appid: number; score: number }> = [];
  for (const value of Object.values(raw)) {
    if (!isRecord(value)) continue;
    const appid = num(value.appid);
    const positive = num(value.positive) ?? 0;
    const negative = num(value.negative) ?? 0;
    const total = positive + negative;
    if (!appid || total < 200) continue;
    const share = positive / total;
    scored.push({ appid, score: share - 1.65 * Math.sqrt((share * (1 - share)) / total) + Math.log10(total) * 0.01 });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.appid - b.appid)
    .slice(0, limit)
    .map((entry) => entry.appid);
}

/* ---------------------------------------------------------------------------
 * PCGamingWiki
 * ------------------------------------------------------------------------ */

/** `{{Template` → its `|field = value` lines, until the template's closing braces. */
export function wikiTemplateFields(wikitext: string, template: string): Map<string, string> {
  const out = new Map<string, string>();
  const start = wikitext.search(new RegExp(`\\{\\{\\s*${template}\\s*\\n`, "i"));
  if (start < 0) return out;
  const lines = wikitext.slice(start).split("\n").slice(1);
  for (const line of lines) {
    if (/^\s*\}\}/.test(line)) break;
    const match = /^\s*\|\s*([^=|]+?)\s*=\s*(.*)$/.exec(line);
    if (match) out.set(match[1].toLowerCase(), match[2].trim());
  }
  return out;
}

/** "true<ref>…</ref>" → "true"; "unknown" and blanks → null. */
export function pcgwSupport(raw: string | undefined): PcgwSupport | null {
  const value = (raw ?? "").replace(/<ref[\s\S]*$/i, "").replace(/\{\{[\s\S]*$/, "").trim().toLowerCase();
  if (value === "true" || value === "false" || value === "limited" || value === "hackable" || value === "n/a") return value;
  if (value === "always on") return "always on";
  return null;
}

const PCGW_FIELDS: Array<[PcgwFeatureKey, "Video" | "Input" | "Audio", string]> = [
  ["ultrawide", "Video", "ultrawidescreen"],
  ["4k", "Video", "4k ultra hd"],
  ["hdr", "Video", "hdr"],
  ["fov", "Video", "fov"],
  ["borderless", "Video", "borderless windowed"],
  ["fps60", "Video", "60 fps"],
  ["fps120", "Video", "120 fps"],
  ["upscaling", "Video", "upscaling"],
  ["frameGen", "Video", "framegen"],
  ["rayTracing", "Video", "ray tracing"],
  ["vsync", "Video", "vsync"],
  ["colorBlind", "Video", "color blind"],
  ["keyRemap", "Input", "key remap"],
  ["controller", "Input", "controller support"],
  ["fullController", "Input", "full controller"],
  ["controllerRemap", "Input", "controller remap"],
  ["playstationControllers", "Input", "playstation controllers"],
  ["touchscreen", "Input", "touchscreen"],
  ["subtitles", "Audio", "subtitles"],
  ["closedCaptions", "Audio", "closed captions"],
  ["separateVolume", "Audio", "separate volume"],
  ["surround", "Audio", "surround sound"],
  ["monoAudio", "Audio", "mono audio"],
];

/** Display labels, for the UI (client-safe: this module has no I/O). */
export const PCGW_LABELS: Record<PcgwFeatureKey, string> = {
  ultrawide: "Ultrawide",
  "4k": "4K",
  hdr: "HDR",
  fov: "Field of view slider",
  borderless: "Borderless window",
  fps60: "60 FPS",
  fps120: "120+ FPS",
  upscaling: "Upscaling",
  frameGen: "Frame generation",
  rayTracing: "Ray tracing",
  vsync: "V-sync",
  colorBlind: "Colour-blind mode",
  keyRemap: "Key remapping",
  controller: "Controller support",
  fullController: "Full controller support",
  controllerRemap: "Controller remapping",
  playstationControllers: "PlayStation controllers",
  touchscreen: "Touchscreen",
  subtitles: "Subtitles",
  closedCaptions: "Closed captions",
  separateVolume: "Separate volume controls",
  surround: "Surround sound",
  monoAudio: "Mono audio",
};

/** The subset the UI should present as "Accessibility". */
export const PCGW_ACCESSIBILITY: PcgwFeatureKey[] = [
  "subtitles",
  "closedCaptions",
  "colorBlind",
  "keyRemap",
  "controllerRemap",
  "fullController",
  "separateVolume",
  "monoAudio",
  "fov",
];

export function parsePcgwWikitext(wikitext: string, page: string): PcgwFeatures {
  const templates = {
    Video: wikiTemplateFields(wikitext, "Video"),
    Input: wikiTemplateFields(wikitext, "Input"),
    Audio: wikiTemplateFields(wikitext, "Audio"),
  };
  const values: PcgwFeatures["values"] = {};
  for (const [key, template, field] of PCGW_FIELDS) {
    const value = pcgwSupport(templates[template].get(field));
    if (value) values[key] = value;
  }
  const tech = (templates.Video.get("upscaling tech") ?? "").replace(/<ref[\s\S]*$/i, "");
  const upscaling = [...new Set(tech.split(/[,;]/).map((part) => part.replace(/\[\[|\]\]|'''?/g, "").trim()).filter((part) => /^[\w .+-]{2,24}$/.test(part)))].slice(0, 6);
  return {
    page,
    url: `https://www.pcgamingwiki.com/wiki/${encodeURIComponent(page.replace(/ /g, "_"))}`,
    values,
    upscaling,
  };
}

/** Steam appids an article's infobox declares (`|steam appid = 504230`, sides comma-separated). */
export function pcgwSteamAppids(wikitext: string): number[] {
  const out: number[] = [];
  for (const match of wikitext.matchAll(/\|\s*steam appid(?: side)?\s*=\s*([\d,\s]+)/gi)) {
    for (const part of match[1].split(",")) {
      const id = Number(part.trim());
      if (Number.isInteger(id) && id > 0) out.push(id);
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * speedrun.com
 * ------------------------------------------------------------------------ */

/** 1488.843 → "24:48.843"; 3723 → "1:02:03". */
export function formatRunTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return ms > 0 ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

/** speedrun.com's game search → the id of the game whose name matches exactly. */
export function pickSpeedrunGame(raw: unknown, name: string): { id: string; name: string; url: string } | null {
  const data = isRecord(raw) && Array.isArray(raw.data) ? raw.data : [];
  const key = normaliseTitle(name);
  for (const item of data) {
    if (!isRecord(item) || !isRecord(item.names)) continue;
    const names = [item.names.international, item.names.twitch].filter((n): n is string => typeof n === "string");
    const id = str(item.id);
    const url = str(item.weblink);
    if (id && url && names.some((n) => normaliseTitle(n) === key)) {
      return { id, name: str(item.names.international) ?? name, url };
    }
  }
  return null;
}

/** `/games/{id}/records?top=1&embed=players,category` → world records, main categories first. */
export function parseSpeedrunRecords(raw: unknown, limit = 5): SpeedrunRecords["records"] {
  const data = isRecord(raw) && Array.isArray(raw.data) ? raw.data : [];
  const out: SpeedrunRecords["records"] = [];
  for (const board of data) {
    if (!isRecord(board) || !Array.isArray(board.runs)) continue;
    const category = isRecord(board.category) && isRecord(board.category.data) ? board.category.data : null;
    const first = board.runs.find((entry) => isRecord(entry) && entry.place === 1);
    const run = isRecord(first) && isRecord(first.run) ? first.run : null;
    const times = run && isRecord(run.times) ? run.times : null;
    const seconds = num(times?.primary_t);
    const categoryName = category ? str(category.name) : null;
    const runUrl = run ? str(run.weblink) : null;
    if (!category || !categoryName || !run || !runUrl || seconds === null || seconds <= 0) continue;

    // Embedded players arrive in the same order as `run.players`; guests have a name, no page.
    const players = isRecord(board.players) && Array.isArray(board.players.data) ? board.players.data : [];
    const runIds = Array.isArray(run.players) ? run.players.filter(isRecord) : [];
    const runners = runIds
      .map((ref) => {
        const player = players.find((p) => isRecord(p) && (ref.id ? p.id === ref.id : p.name === ref.name));
        if (!isRecord(player)) return ref.name && typeof ref.name === "string" ? { name: ref.name, url: null } : null;
        const name = (isRecord(player.names) ? str(player.names.international) : null) ?? str(player.name);
        return name ? { name, url: str(player.weblink) } : null;
      })
      .filter((runner): runner is { name: string; url: string | null } => runner !== null);

    const videos = isRecord(run.videos) && Array.isArray(run.videos.links) ? run.videos.links : [];
    const video = videos.map((v) => (isRecord(v) ? str(v.uri) : null)).find((uri) => uri?.startsWith("https://")) ?? null;
    out.push({
      category: categoryName,
      url: str(category.weblink) ?? str(board.weblink) ?? runUrl,
      seconds,
      time: formatRunTime(seconds),
      date: str(run.date),
      runners,
      runUrl,
      video,
      misc: category.miscellaneous === true,
    });
  }
  // Stable: main categories keep speedrun.com's order, misc ones follow.
  return [...out.filter((r) => !r.misc), ...out.filter((r) => r.misc)].slice(0, limit);
}

/* ---------------------------------------------------------------------------
 * Thunderstore
 * ------------------------------------------------------------------------ */

/** [identifier, normalised name, display name]. */
export type CommunityRow = [string, string, string];

export function compactCommunities(raw: unknown): CommunityRow[] {
  const results = isRecord(raw) && Array.isArray(raw.results) ? raw.results : [];
  const rows: CommunityRow[] = [];
  for (const item of results) {
    if (!isRecord(item)) continue;
    const id = str(item.identifier);
    const name = str(item.name);
    if (id && name && /^[a-z0-9-]{1,80}$/.test(id)) rows.push([id, normaliseTitle(name), name]);
  }
  return rows;
}

export function matchCommunity(rows: CommunityRow[], name: string): CommunityRow | null {
  const key = normaliseTitle(name);
  return key ? rows.find((row) => row[1] === key) ?? null : null;
}

/** Thunderstore's listing → its most-downloaded live packages (no NSFW/deprecated). */
export function parseThunderstoreListing(raw: unknown, community: string, limit = 8): { total: number; top: ThunderstoreMod[] } {
  const results = isRecord(raw) && Array.isArray(raw.results) ? raw.results : [];
  const top: ThunderstoreMod[] = [];
  for (const item of results) {
    if (!isRecord(item) || item.is_nsfw === true || item.is_deprecated === true) continue;
    const name = str(item.name);
    const owner = str(item.namespace);
    if (!name || !owner) continue;
    const icon = str(item.icon_url);
    top.push({
      name: name.replace(/_/g, " "),
      owner,
      description: (str(item.description) ?? "").slice(0, 240),
      downloads: Math.max(0, num(item.download_count) ?? 0),
      rating: Math.max(0, num(item.rating_count) ?? 0),
      icon: icon?.startsWith("https://") ? icon : null,
      url: `https://thunderstore.io/c/${community}/p/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/`,
      updated: str(item.last_updated),
      categories: Array.isArray(item.categories)
        ? item.categories.map((c) => (isRecord(c) ? str(c.name) : null)).filter((c): c is string => Boolean(c)).slice(0, 4)
        : [],
      pinned: item.is_pinned === true,
    });
    if (top.length >= limit) break;
  }
  return { total: Math.max(top.length, num(isRecord(raw) ? raw.count : null) ?? 0), top };
}

/* ---------------------------------------------------------------------------
 * Epic Games Store free games
 * ------------------------------------------------------------------------ */

export interface EpicPromoRow {
  id: string;
  title: string;
  url: string;
  image: string | null;
  imageWide: string | null;
  start: string;
  end: string;
  originalPrice: string | null;
  /** "current" when the free window is open now, else "upcoming". */
  when: "current" | "upcoming";
}

interface EpicWindow {
  startDate?: string;
  endDate?: string;
  discountSetting?: { discountPercentage?: number };
}

/**
 * Free-to-keep promotions from Epic's `freeGamesPromotions` feed. A promotion
 * is "free" when its discount setting is 0 % *of the price* (Epic's own
 * encoding for 100 % off); ordinary sales in the same feed are dropped.
 * "Current" additionally requires the window to be open at `now`, so a cached
 * feed never shows yesterday's freebie as live.
 */
export function parseEpicPromotions(raw: unknown, now: number): EpicPromoRow[] {
  const elements = (raw as { data?: { Catalog?: { searchStore?: { elements?: unknown[] } } } })?.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) return [];
  const out: EpicPromoRow[] = [];
  for (const el of elements) {
    if (!isRecord(el)) continue;
    const title = str(el.title);
    const id = str(el.id);
    const promos = isRecord(el.promotions) ? el.promotions : null;
    if (!title || !id || !promos) continue;
    const windows = (key: string) =>
      (Array.isArray(promos[key]) ? (promos[key] as unknown[]) : [])
        .flatMap((group) => (isRecord(group) && Array.isArray(group.promotionalOffers) ? (group.promotionalOffers as EpicWindow[]) : []))
        .filter((w) => w?.discountSetting?.discountPercentage === 0 && w.startDate && w.endDate);

    const live = windows("promotionalOffers").find((w) => Date.parse(w.startDate!) <= now && now < Date.parse(w.endDate!));
    const next = windows("upcomingPromotionalOffers").find((w) => Date.parse(w.endDate!) > now);
    const window = live ?? next;
    if (!window) continue;

    const mapping = [...(Array.isArray(el.offerMappings) ? el.offerMappings : []), ...(isRecord(el.catalogNs) && Array.isArray(el.catalogNs.mappings) ? el.catalogNs.mappings : [])]
      .filter(isRecord)
      .find((m) => m.pageType === "productHome" && str(m.pageSlug));
    const slug = (mapping ? str(mapping.pageSlug) : null) ?? str(el.productSlug)?.replace(/\/home$/, "") ?? null;
    const images = Array.isArray(el.keyImages) ? el.keyImages.filter(isRecord) : [];
    const image = (type: string) => {
      const url = str(images.find((k) => k.type === type)?.url);
      return url?.startsWith("https://") ? url : null;
    };
    const price = isRecord(el.price) && isRecord(el.price.totalPrice) ? el.price.totalPrice : null;
    const fmt = price && isRecord(price.fmtPrice) ? str(price.fmtPrice.originalPrice) : null;
    out.push({
      id,
      title,
      url: slug && /^[a-z0-9-]{1,120}$/i.test(slug) ? `https://store.epicgames.com/en-US/p/${slug}` : "https://store.epicgames.com/en-US/free-games",
      image: image("OfferImageTall") ?? image("Thumbnail"),
      imageWide: image("OfferImageWide") ?? image("DieselStoreFrontWide"),
      start: new Date(Date.parse(window.startDate!)).toISOString(),
      end: new Date(Date.parse(window.endDate!)).toISOString(),
      originalPrice: fmt && fmt !== "0" ? fmt : null,
      when: live ? "current" : "upcoming",
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/* ---------------------------------------------------------------------------
 * GOG
 * ------------------------------------------------------------------------ */

export interface GogProduct {
  id: string;
  title: string;
  url: string;
}

/** The catalogue search's best product for a game name: exact title first, then an edition of it. */
export function pickGogProduct(raw: unknown, name: string): GogProduct | null {
  const products = isRecord(raw) && Array.isArray(raw.products) ? raw.products.filter(isRecord) : [];
  const candidates = products
    .map((p) => ({
      id: str(p.id),
      title: str(p.title),
      url: str(p.storeLink),
      type: str(p.productType),
    }))
    .filter((p): p is { id: string; title: string; url: string; type: string | null } =>
      Boolean(p.id && /^\d{1,12}$/.test(p.id) && p.title && p.url?.startsWith("https://www.gog.com/")) && p.type !== "dlc",
    );
  const exact = candidates.find((p) => sameGameTitle(p.title, name) === "exact");
  const edition = candidates.find((p) => sameGameTitle(p.title, name) === "edition");
  const pick = exact ?? edition;
  return pick ? { id: pick.id, title: pick.title, url: pick.url } : null;
}

/**
 * `api.gog.com/products/{id}/prices?countryCode=` → GOG's default price for
 * that country: the first entry, which is the local currency where GOG has
 * one and USD where it doesn't. Amounts arrive as minor units ("2499 USD").
 */
export function parseGogPrices(raw: unknown): { currency: string; price: number; initial: number; discount: number } | null {
  const prices = isRecord(raw) && isRecord(raw._embedded) && Array.isArray(raw._embedded.prices) ? raw._embedded.prices : [];
  const first = prices.find(isRecord);
  if (!first) return null;
  const currency = isRecord(first.currency) ? str(first.currency.code) : null;
  const parse = (value: unknown) => {
    const match = typeof value === "string" ? /^(\d+)\s+([A-Z]{3})$/.exec(value.trim()) : null;
    return match && match[2] === currency ? Number(match[1]) : null;
  };
  const price = parse(first.finalPrice);
  const initial = parse(first.basePrice);
  if (!currency || !/^[A-Z]{3}$/.test(currency) || price === null || initial === null) return null;
  return { currency, price, initial, discount: initial > 0 ? Math.max(0, Math.round((1 - price / initial) * 100)) : 0 };
}
