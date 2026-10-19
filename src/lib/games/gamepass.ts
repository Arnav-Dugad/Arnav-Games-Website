/**
 * Xbox Game Pass, from Microsoft's public catalogue.
 *
 * `catalog.gamepass.com/sigls` publishes each Game Pass list ("sigl") as an
 * array of Microsoft Store BigIds — no key, no account. BigIds join to IGDB
 * through `external_games` (source 11 = Microsoft), and the stragglers that
 * IGDB hasn't linked yet (typically the newest additions, which is exactly
 * what a "recently added" shelf is) are matched by exact title via the store's
 * display catalogue.
 *
 * Lists refresh every six hours; Microsoft rotates them weekly at most.
 */

import type { GameSummary } from "./types";
import { listGamesByIds } from "./providers/igdb";
import { igdbIdsForMicrosoft, igdbIdsForTitles, normaliseStoreTitle } from "./providers/igdb-extras";

export const GAME_PASS_SIGLS = {
  console: "f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e",
  pc: "fdd9e2a7-0fee-49f6-ad69-4354098401ff",
  leavingSoon: "393f05bf-e596-4ef6-9487-6d4fa0eab987",
  recentlyAdded: "f13cf6b4-57e6-4459-89df-6aec18cf0538",
} as const;

export type GamePassList = keyof typeof GAME_PASS_SIGLS;

const SIX_HOURS = 60 * 60 * 6;
const BIG_ID = /^[0-9A-Z]{12}$/;

/** BigIds on one list, in Microsoft's order; null when the catalogue is unreachable. */
export async function gamePassList(list: GamePassList): Promise<string[] | null> {
  try {
    const res = await fetch(
      `https://catalog.gamepass.com/sigls/v2?id=${GAME_PASS_SIGLS[list]}&language=en-us&market=US`,
      { next: { revalidate: SIX_HOURS, tags: ["gamepass"] }, signal: AbortSignal.timeout(3500) },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ id?: string; siglId?: string }>;
    // The first row is the list's own header (`siglId`, title, art), not a game.
    return [...new Set(rows.map((row) => row.id?.toUpperCase()).filter((id): id is string => Boolean(id && BIG_ID.test(id))))];
  } catch {
    return null;
  }
}

/** Store titles for BigIds, for the title-matching fallback. */
async function storeTitles(bigIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < bigIds.length; i += 20) {
    const part = bigIds.slice(i, i + 20);
    try {
      const res = await fetch(
        `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${part.join(",")}&market=US&languages=en-us`,
        { next: { revalidate: SIX_HOURS, tags: ["gamepass"] }, signal: AbortSignal.timeout(3500) },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        Products?: Array<{ ProductId?: string; LocalizedProperties?: Array<{ ProductTitle?: string }> }>;
      };
      for (const product of json.Products ?? []) {
        const title = product.LocalizedProperties?.[0]?.ProductTitle;
        if (product.ProductId && title) out.set(product.ProductId.toUpperCase(), title);
      }
    } catch {
      // A missing chunk only means fewer title matches.
    }
  }
  return out;
}

/** BigId → IGDB id for every game on a list that can be matched. */
async function matchList(bigIds: string[]): Promise<Map<string, number>> {
  const matched = await igdbIdsForMicrosoft(bigIds);
  const unmatched = bigIds.filter((id) => !matched.has(id));
  if (unmatched.length > 0) {
    const titles = await storeTitles(unmatched);
    const byTitle = await igdbIdsForTitles([...titles.values()]);
    for (const [bigId, title] of titles) {
      const id = byTitle.get(normaliseStoreTitle(title));
      if (id) matched.set(bigId, id);
    }
  }
  return matched;
}

/**
 * A Game Pass list as IGDB games, in Microsoft's order. Null when the
 * catalogue itself is unreachable; an empty array when it answered but
 * nothing could be matched.
 */
export async function gamePassShelf(list: GamePassList): Promise<GameSummary[] | null> {
  const bigIds = await gamePassList(list);
  if (!bigIds) return null;
  if (bigIds.length === 0) return [];
  const matched = await matchList(bigIds);
  const order = [...new Set(bigIds.map((id) => matched.get(id)).filter((id): id is number => typeof id === "number"))];
  if (order.length === 0) return [];
  const rank = new Map(order.map((id, index) => [id, index]));
  const games = await listGamesByIds(order);
  return games.sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999));
}

/**
 * Which Game Pass lists a game is on. Membership is by BigId; the two short
 * lists are also checked by IGDB id, so a game IGDB hasn't linked to its
 * BigId still shows up as leaving or newly added. Null when the catalogue is
 * unreachable.
 */
export async function gamePassMembership(
  igdbId: number | null,
  bigId: string | null,
): Promise<{ console: boolean; pc: boolean; leavingSoon: boolean; recentlyAdded: boolean } | null> {
  const id = bigId?.toUpperCase() ?? null;
  const [consoleIds, pcIds, leaving, recent] = await Promise.all([
    gamePassList("console"),
    gamePassList("pc"),
    gamePassList("leavingSoon"),
    gamePassList("recentlyAdded"),
  ]);
  if (!consoleIds && !pcIds) return null;

  const onShortList = async (ids: string[] | null) => {
    if (!ids) return false;
    if (id && ids.includes(id)) return true;
    if (!igdbId) return false;
    // Matching is cached for six hours but costs several upstream calls when
    // cold. Within a live request it gets 2.5 s; past that the BigId answer
    // stands, and the match keeps running to warm the cache for next time.
    const matched = await Promise.race([
      matchList(ids),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    return Boolean(matched && [...matched.values()].includes(igdbId));
  };

  const [leavingSoon, recentlyAdded] = await Promise.all([onShortList(leaving), onShortList(recent)]);
  // Without a BigId the full lists can't be checked, so "not on Game Pass"
  // would be a guess. Say nothing unless a short list placed it.
  if (!id && !leavingSoon && !recentlyAdded) return null;
  return {
    console: Boolean(id && consoleIds?.includes(id)),
    pc: Boolean(id && pcIds?.includes(id)),
    leavingSoon,
    recentlyAdded,
  };
}
