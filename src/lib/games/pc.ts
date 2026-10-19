/**
 * PC-specific facts for a Steam game: Steam Deck compatibility, ProtonDB's
 * Linux rating and achievement rarity — assembled for `/api/game/[id]/pc`.
 *
 * Each source is independent and failure-isolated: a dead one nulls its own
 * field. All three change slowly, so every fetch is cached for a day. URLs
 * are built from a validated appid against fixed hosts only.
 */

import type { AchievementStats, GamePcInfo, ProtonTier } from "./types";
import { deckStatusFromCategory, rarityBands } from "./market-rules";
import { steamFullDetails } from "./steam-store";
import { parsePcRequirements } from "./pc-requirements";

const DAY = 60 * 60 * 24;
const TIMEOUT_MS = 3500;
const PROTON_TIERS = new Set<ProtonTier>(["platinum", "gold", "silver", "bronze", "borked", "pending", "native"]);

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: DAY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Valve's own rating. Null when Valve has no report for the app. */
async function deckStatus(appid: number): Promise<GamePcInfo["deck"]> {
  const json = await getJson<{ success?: number; results?: { resolved_category?: number } | [] }>(
    `https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${appid}&l=english`,
  );
  // Apps Valve has never looked at answer `results: []`.
  if (json?.success !== 1 || !json.results || Array.isArray(json.results)) return null;
  return deckStatusFromCategory(json.results.resolved_category);
}

async function protonSummary(appid: number): Promise<GamePcInfo["proton"]> {
  const json = await getJson<{ tier?: string; total?: number; confidence?: string }>(
    `https://www.protondb.com/api/v1/reports/summaries/${appid}.json`,
  );
  const tier = json?.tier?.toLowerCase() as ProtonTier | undefined;
  if (!tier || !PROTON_TIERS.has(tier)) return null;
  return {
    tier,
    reports: typeof json?.total === "number" && json.total >= 0 ? json.total : 0,
    confidence: json?.confidence?.trim() || null,
  };
}

const httpsUrl = (raw: string | undefined) => {
  if (!raw) return null;
  try {
    const url = new URL(raw.replace(/^http:/, "https:"));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/**
 * Totals and showcase icons from the store record; rarity from Steam's global
 * unlock percentages. Hidden achievements are left out of the showcase —
 * their names are often ending spoilers.
 */
async function achievements(
  appid: number,
  record: ReturnType<typeof steamFullDetails>,
): Promise<AchievementStats | null> {
  const [details, global] = await Promise.all([
    record,
    getJson<{ achievementpercentages?: { achievements?: Array<{ percent?: string | number }> } }>(
      `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`,
    ),
  ]);
  const percents = (global?.achievementpercentages?.achievements ?? [])
    .map((row) => Number(row.percent))
    .filter((p) => Number.isFinite(p));
  const total = details?.achievements?.total ?? percents.length;
  if (!total || total <= 0) return null;

  const highlighted = (details?.achievements?.highlighted ?? [])
    .filter((item) => !item.hidden && item.name)
    .map((item) => ({ name: item.name!.trim(), icon: httpsUrl(item.path) }))
    .filter((item): item is { name: string; icon: string } => Boolean(item.icon))
    .slice(0, 10);

  return { total, highlighted, ...rarityBands(percents) };
}

/**
 * The store record is read once and shared by achievements and requirements
 * (a parallel second read would be a second request on a cold cache).
 */
export async function pcInfoFor(appid: number): Promise<GamePcInfo> {
  const details = steamFullDetails(appid).catch(() => null);
  const [deck, proton, stats, record] = await Promise.all([
    deckStatus(appid).catch(() => null),
    protonSummary(appid).catch(() => null),
    achievements(appid, details).catch(() => null),
    details,
  ]);
  return { deck, proton, achievements: stats, requirements: parsePcRequirements(record?.pc_requirements) };
}
