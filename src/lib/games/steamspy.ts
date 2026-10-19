/**
 * SteamSpy: user tags with vote counts, owner estimates and yesterday's peak
 * concurrents for a Steam app, plus "best apps with this tag" lists for the
 * recommender. SteamSpy is one volunteer's service and asks for at most one
 * request a second, so everything here is cached for a day or more and only
 * ever fetched one app at a time.
 */

import { unstable_cache } from "next/cache";
import { parseSteamSpy, topTaggedApps } from "./external-rules";
import { politeJson } from "./polite";
import type { SteamSpyData } from "./types";

const API = "https://steamspy.com/api.php";
const DAY = 60 * 60 * 24;

const cachedApp = unstable_cache(
  async (appid: number): Promise<SteamSpyData | null> => parseSteamSpy(await politeJson(`${API}?request=appdetails&appid=${appid}`, 5000), appid),
  ["steamspy-app-v1"],
  { revalidate: DAY, tags: ["steamspy"] },
);

/** Null when SteamSpy has no record of the app or can't be reached. 1 request cold. */
export async function steamSpyFor(appid: number): Promise<SteamSpyData | null | undefined> {
  if (!Number.isInteger(appid) || appid <= 0) return null;
  try {
    return await cachedApp(appid);
  } catch (err) {
    console.warn("[steamspy] app failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

/** Steam tags are short words; anything else never reaches the URL. */
const SAFE_TAG = /^[\w &'+.-]{2,40}$/;

const cachedTag = unstable_cache(
  async (tag: string): Promise<number[]> => {
    // ~0.5 MB per tag; parsed once a week and reduced to 60 appids.
    const apps = topTaggedApps(await politeJson(`${API}?request=tag&tag=${encodeURIComponent(tag)}`, 8000), 60);
    if (apps.length === 0) throw new Error("steamspy tag: empty");
    return apps;
  },
  ["steamspy-tag-v1"],
  { revalidate: DAY * 7, tags: ["steamspy"] },
);

/** The best-received Steam apps carrying a tag (≤ 60 appids). Empty on failure. */
export async function steamSpyTagApps(tag: string): Promise<number[]> {
  if (!SAFE_TAG.test(tag)) return [];
  try {
    return await cachedTag(tag);
  } catch (err) {
    console.warn("[steamspy] tag failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
