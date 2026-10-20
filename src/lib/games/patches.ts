/**
 * The latest Steam patch posts for one game, condensed (`patch-notes.ts`),
 * plus every recent post for the updates timeline, for `/insights`.
 *
 * One request normally: the developer-announcement feed, 25 posts deep so a
 * game that posts merch and events between patches still yields five. Only a
 * game with no announcements at all costs a second request (the unfiltered
 * feed). Cached for an hour — patch posts don't change after publishing.
 */

import type { PatchNote, UpdatePost } from "./types";
import { steamFeedFrom, type SteamNewsItem } from "./patch-notes";

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

/**
 * Up to five patch posts and the twelve latest posts of any kind (the
 * updates timeline), newest first, from the same one or two requests; null
 * when Steam couldn't be reached.
 */
export async function steamUpdates(appid: number): Promise<{ patches: PatchNote[]; posts: UpdatePost[] } | null> {
  if (!Number.isInteger(appid) || appid <= 0) return { patches: [], posts: [] };
  let items = await newsFeed(appid, "&feeds=steam_community_announcements");
  if (items && items.length === 0) items = await newsFeed(appid, "");
  return items ? steamFeedFrom(items, 5, 12) : null;
}

