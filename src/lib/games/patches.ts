/**
 * The latest Steam patch posts for one game, condensed (`patch-notes.ts`),
 * for `/api/game/[id]/patches`.
 *
 * One request normally: the developer-announcement feed, 25 posts deep so a
 * game that posts merch and events between patches still yields five. Only a
 * game with no announcements at all costs a second request (the unfiltered
 * feed). Cached for an hour — patch posts don't change after publishing.
 */

import type { PatchNote } from "./types";
import { patchNotesFrom, type SteamNewsItem } from "./patch-notes";

const HOUR = 3600;
const TIMEOUT_MS = 5000;

async function newsFeed(appid: number, feeds: string): Promise<SteamNewsItem[] | null> {
  try {
    const res = await fetch(
      // `maxlength=0` is the raw markup; any truncation makes Steam strip
      // tags itself and the list structure is lost.
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=25&maxlength=0&format=json${feeds}`,
      { headers: { Accept: "application/json" }, next: { revalidate: HOUR }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { appnews?: { newsitems?: SteamNewsItem[] } };
    return json.appnews?.newsitems ?? [];
  } catch {
    return null;
  }
}

/** Up to five patch posts, newest first; null when Steam couldn't be reached. */
export async function steamPatchNotes(appid: number): Promise<PatchNote[] | null> {
  if (!Number.isInteger(appid) || appid <= 0) return [];
  let items = await newsFeed(appid, "&feeds=steam_community_announcements");
  if (items && items.length === 0) items = await newsFeed(appid, "");
  return items ? patchNotesFrom(items, 5) : null;
}
