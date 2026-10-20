/**
 * Fast-moving data for one game, assembled for `/api/game/[id]/live`.
 *
 * Each source is independent, time-boxed (3.5 s) and failure-isolated: a dead
 * source nulls its own field and nothing else. Every URL fetched here is
 * built from validated ids against a fixed host — callers never supply a URL.
 *
 * Response caching is the route's job (`s-maxage=120`); the per-source
 * `revalidate` values here only keep slower-moving lookups (store lists,
 * CheapShark id joins) from being re-fetched on every miss.
 */

import type { GameLiveData } from "./types";
import { igdbAppAuth } from "./providers/igdb";
import { stripNewsMarkup } from "./news-text";
import { gamePassMembership } from "./gamepass";
import { recentFromHistogram } from "./score-spread";

const TIMEOUT_MS = 3500;
/** CheapShark asks every client to identify itself. */
const USER_AGENT = "ArnavGames/1.0 (https://arnav-games.arnavrival12.workers.dev; arnavrival12@gmail.com)";

export interface LiveIds {
  igdbId: number | null;
  steam: number | null;
  twitch: string | null;
  microsoft: string | null;
  name: string | null;
}

async function getJson<T>(url: string, revalidate: number, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      next: { revalidate },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Steam
 * ------------------------------------------------------------------------ */

export async function steamPlayers(appid: number): Promise<number | null> {
  const json = await getJson<{ response?: { player_count?: number; result?: number } }>(
    `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
    120,
  );
  const count = json?.response?.result === 1 ? json.response.player_count : undefined;
  return typeof count === "number" && count >= 0 ? count : null;
}

/**
 * The last 30 days of reviews. `appreviews` only ever summarises all time
 * (its `day_range` doesn't touch the summary), but the store's histogram —
 * the chart on every store page — has one row per day for the last 30,
 * across all languages. ~8 KB; cached three hours, since a day's reviews
 * barely move a 30-day share.
 */
async function steamRecentReviews(appid: number): Promise<NonNullable<GameLiveData["steamReviews"]>["recent"]> {
  const json = await getJson<{ success?: number; results?: { recent?: Array<{ recommendations_up?: number; recommendations_down?: number }> } }>(
    `https://store.steampowered.com/appreviewhistogram/${appid}?l=english&review_score_preference=0`,
    3 * 3600,
  );
  return json?.success === 1 ? recentFromHistogram(json.results?.recent) : null;
}

export async function steamReviews(appid: number): Promise<GameLiveData["steamReviews"]> {
  const [json, recent] = await Promise.all([
    getJson<{
      success?: number;
      query_summary?: { review_score_desc?: string; total_positive?: number; total_negative?: number; total_reviews?: number };
    }>(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`, 3600),
    steamRecentReviews(appid),
  ]);
  const summary = json?.success === 1 ? json.query_summary : undefined;
  const positive = summary?.total_positive ?? 0;
  const negative = summary?.total_negative ?? 0;
  const total = summary?.total_reviews ?? positive + negative;
  if (!summary || total <= 0) return null;
  return {
    description: summary.review_score_desc ?? "",
    positive,
    negative,
    total,
    percent: Math.round((positive / Math.max(1, positive + negative)) * 100),
    recent,
  };
}

type NewsItem = { title?: string; url?: string; date?: number; feedlabel?: string; feedname?: string; contents?: string };

/** Steam news URLs are sometimes unescaped (spaces, Cyrillic); normalise or drop. */
function safeNewsUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.replace(/^http:/, "https:"));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The four latest posts, official announcements first. Without the feed
 * filter Steam mixes in syndicated press in any language, which reads as
 * noise on an English page; it is only the fallback for games whose
 * developers never post announcements.
 */
export async function steamNews(appid: number): Promise<GameLiveData["news"]> {
  // `maxlength=0` returns the raw markup. Any truncation makes Steam strip
  // tags itself — without leaving spaces, so headings run into the text.
  const fetchFeed = (feeds: string) =>
    getJson<{ appnews?: { newsitems?: NewsItem[] } }>(
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=4&maxlength=0&format=json${feeds}`,
      3600,
    );
  let items = (await fetchFeed("&feeds=steam_community_announcements"))?.appnews?.newsitems ?? [];
  if (items.length === 0) items = (await fetchFeed(""))?.appnews?.newsitems ?? [];

  return items
    .map((item) => ({ item, url: safeNewsUrl(item.url) }))
    .filter((entry): entry is { item: NewsItem & { title: string }; url: string } => Boolean(entry.item.title && entry.url))
    .slice(0, 4)
    .map(({ item, url }) => ({
      title: stripNewsMarkup(item.title, 160),
      url,
      date: new Date((item.date ?? 0) * 1000).toISOString(),
      source: item.feedlabel?.trim() || "Steam",
      excerpt: stripNewsMarkup(item.contents ?? "", 280),
    }));
}

/* ---------------------------------------------------------------------------
 * Twitch
 * ------------------------------------------------------------------------ */

interface HelixStream {
  user_login?: string;
  user_name?: string;
  title?: string;
  viewer_count?: number;
  thumbnail_url?: string;
  language?: string;
}

/**
 * Viewers and streams across the top 300 live channels (3 Helix pages).
 * Helix has no total-count endpoint, and the long tail beyond 300 is
 * single-digit audiences, so these are faithful for all but the very biggest
 * titles — where they are a slight undercount, never an inflation.
 */
export async function twitchActivity(twitchGameId: string | null, name: string | null): Promise<GameLiveData["twitch"]> {
  const auth = await igdbAppAuth();
  if (!auth) return null;
  const headers = { "Client-ID": auth.clientId, Authorization: `Bearer ${auth.token}` };
  const deadline = Date.now() + TIMEOUT_MS;

  const helix = async <T>(path: string): Promise<T | null> => {
    const remaining = deadline - Date.now();
    if (remaining <= 100) return null;
    try {
      const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(remaining),
      });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  };

  let gameId = twitchGameId;
  if (!gameId && name) {
    const found = await helix<{ data?: Array<{ id?: string }> }>(`games?name=${encodeURIComponent(name)}`);
    gameId = found?.data?.[0]?.id ?? null;
  }
  if (!gameId || !/^\d+$/.test(gameId)) return null;

  const streams: HelixStream[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const json = await helix<{ data?: HelixStream[]; pagination?: { cursor?: string } }>(
      `streams?game_id=${gameId}&first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
    );
    if (!json) {
      if (page === 0) return null;
      break;
    }
    streams.push(...(json.data ?? []));
    cursor = json.pagination?.cursor;
    // Helix pages can come back short while more remain; the cursor decides.
    if (!cursor) break;
  }

  const ranked = streams
    .filter((stream) => stream.user_login && /^[a-z0-9_]{1,25}$/i.test(stream.user_login))
    .sort((a, b) => (b.viewer_count ?? 0) - (a.viewer_count ?? 0));
  return {
    viewers: ranked.reduce((sum, stream) => sum + (stream.viewer_count ?? 0), 0),
    streams: ranked.length,
    top: ranked.slice(0, 4).map((stream) => ({
      user: stream.user_name || stream.user_login!,
      title: (stream.title ?? "").trim(),
      viewers: stream.viewer_count ?? 0,
      thumbnail: (stream.thumbnail_url ?? "").replace("{width}", "440").replace("{height}", "248"),
      url: `https://twitch.tv/${stream.user_login!.toLowerCase()}`,
      // ISO 639-1 ("en"), or "other"; anything else is dropped rather than shown.
      language: stream.language && /^[a-z]{2}$/.test(stream.language) ? stream.language : null,
    })),
  };
}

/* ---------------------------------------------------------------------------
 * CheapShark
 * ------------------------------------------------------------------------ */

type Deal = NonNullable<GameLiveData["deals"]>["stores"][number];

async function cheapSharkStores(): Promise<Map<string, string>> {
  const rows = await getJson<Array<{ storeID?: string; storeName?: string }>>(
    "https://www.cheapshark.com/api/1.0/stores",
    60 * 60 * 24 * 7,
    { "User-Agent": USER_AGENT },
  );
  return new Map((rows ?? []).filter((row) => row.storeID && row.storeName).map((row) => [row.storeID!, row.storeName!]));
}

const normaliseTitle = (value: string) => value.toLowerCase().replace(/[™®©]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function cheapSharkGameId(steam: number | null, name: string | null): Promise<string | null> {
  const headers = { "User-Agent": USER_AGENT };
  if (steam) {
    const rows = await getJson<Array<{ gameID?: string }>>(
      `https://www.cheapshark.com/api/1.0/games?steamAppID=${steam}`,
      60 * 60 * 24 * 7,
      headers,
    );
    if (rows?.[0]?.gameID) return rows[0].gameID;
  }
  if (name) {
    // Title search is fuzzy, so only an exact (normalised) title is accepted.
    const rows = await getJson<Array<{ gameID?: string; external?: string }>>(
      `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(name)}&limit=10`,
      60 * 60 * 24,
      headers,
    );
    const match = rows?.find((row) => row.external && normaliseTitle(row.external) === normaliseTitle(name));
    if (match?.gameID) return match.gameID;
  }
  return null;
}

export async function cheapSharkDeals(steam: number | null, name: string | null): Promise<GameLiveData["deals"]> {
  const [gameId, stores] = await Promise.all([cheapSharkGameId(steam, name), cheapSharkStores()]);
  if (!gameId || !/^\d+$/.test(gameId)) return null;
  const json = await getJson<{
    cheapestPriceEver?: { price?: string; date?: number };
    deals?: Array<{ storeID?: string; dealID?: string; price?: string; retailPrice?: string; savings?: string }>;
  }>(`https://www.cheapshark.com/api/1.0/games?id=${gameId}`, 1800, { "User-Agent": USER_AGENT });
  if (!json) return null;

  const deals: Deal[] = (json.deals ?? [])
    .filter((deal) => deal.dealID && deal.storeID && Number.isFinite(Number(deal.price)))
    .map((deal) => ({
      store: stores.get(deal.storeID!) ?? `Store ${deal.storeID}`,
      price: Number(deal.price),
      retail: Number(deal.retailPrice ?? deal.price),
      savings: Math.round(Number(deal.savings ?? 0)),
      // Deal ids arrive already percent-encoded; encoding again breaks the redirect.
      url: `https://www.cheapshark.com/redirect?dealID=${/^[A-Za-z0-9%._~-]+$/.test(deal.dealID!) ? deal.dealID : encodeURIComponent(deal.dealID!)}`,
    }))
    .sort((a, b) => a.price - b.price);

  const low = json.cheapestPriceEver;
  return {
    cheapest: deals[0] ?? null,
    stores: deals,
    historicalLow:
      low && Number.isFinite(Number(low.price)) && typeof low.date === "number"
        ? { price: Number(low.price), date: new Date(low.date * 1000).toISOString().slice(0, 10) }
        : null,
  };
}

/* ---------------------------------------------------------------------------
 * Assembly
 * ------------------------------------------------------------------------ */

/** Never rejects; a hung source resolves to `fallback` at the deadline. */
function settle<T>(task: Promise<T>, fallback: T, ms = TIMEOUT_MS + 500): Promise<T> {
  return Promise.race([
    task.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function liveDataFor(ids: LiveIds): Promise<GameLiveData> {
  const [players, reviews, news, twitch, deals, gamePass] = await Promise.all([
    ids.steam ? settle(steamPlayers(ids.steam), null) : null,
    ids.steam ? settle(steamReviews(ids.steam), null) : null,
    ids.steam ? settle(steamNews(ids.steam), []) : [],
    ids.twitch || ids.name ? settle(twitchActivity(ids.twitch, ids.name), null) : null,
    ids.steam || ids.name ? settle(cheapSharkDeals(ids.steam, ids.name), null) : null,
    ids.microsoft || ids.igdbId ? settle(gamePassMembership(ids.igdbId, ids.microsoft), null) : null,
  ]);
  return {
    steamPlayers: players,
    steamReviews: reviews,
    twitch,
    deals,
    news,
    gamePass,
    fetchedAt: new Date().toISOString(),
  };
}
