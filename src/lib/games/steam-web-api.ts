/**
 * The keyed Steam Web API (api.steampowered.com), for the library import.
 *
 * Steam's community pages (`/games/?tab=all`) now require a signed-in
 * session, so a keyless scrape no longer works; the official route is a free
 * Web API key (https://steamcommunity.com/dev/apikey) and three calls:
 *
 *   ISteamUser/ResolveVanityURL/v1     vanity name → SteamID64
 *   ISteamUser/GetPlayerSummaries/v2   display name, avatar, profile visibility
 *   IPlayerService/GetOwnedGames/v1    appid, name, minutes, last played
 *
 * The key is a server secret: read from `STEAM_API_KEY` (or the Worker
 * binding), never logged, never echoed, and never part of an error message —
 * failures report only Steam's HTTP status. A reader's library is personal
 * data: it is returned to them and nothing about it is logged or cached.
 */

import type { FetchBudget } from "./fetch-budget";
import type { SteamAccount, SteamOwnedGame } from "@/lib/personal/steam-import";

const API = "https://api.steampowered.com";
const TIMEOUT_MS = 8000;

let cachedKey: string | null | undefined;

/** The Web API key, or null when this deployment has none (the import then says "coming soon"). */
export async function steamApiKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;
  let raw = process.env.STEAM_API_KEY;
  if (!raw) {
    try {
      // Workers secrets are normally mirrored into process.env by OpenNext;
      // the binding object is the fallback.
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const { env } = await getCloudflareContext({ async: true });
      raw = (env as unknown as { STEAM_API_KEY?: string }).STEAM_API_KEY;
    } catch {
      // Not on Workers.
    }
  }
  const key = raw?.trim() ?? "";
  cachedKey = /^[A-F0-9]{32}$/i.test(key) ? key : null;
  return cachedKey;
}

export type SteamCallFailure = "down" | "rate-limited";

async function call<T>(path: string, params: Record<string, string>, key: string, budget: FetchBudget): Promise<T | SteamCallFailure> {
  if (!budget.take()) return "down";
  const query = new URLSearchParams({ ...params, key, format: "json" });
  try {
    const res = await fetch(`${API}/${path}?${query}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429) return "rate-limited";
    if (!res.ok) {
      console.warn(`[steam-api] ${path.split("/")[1]} answered ${res.status}`);
      return "down";
    }
    return (await res.json()) as T;
  } catch {
    // Deliberately no error text: a transport error can carry the URL, and the URL carries the key.
    console.warn(`[steam-api] ${path.split("/")[1]} unreachable`);
    return "down";
  }
}

/** Vanity name → SteamID64; "missing" when Steam knows no such name. */
export async function resolveVanity(name: string, key: string, budget: FetchBudget): Promise<string | "missing" | SteamCallFailure> {
  const body = await call<{ response?: { success?: number; steamid?: string } }>("ISteamUser/ResolveVanityURL/v1/", { vanityurl: name }, key, budget);
  if (typeof body === "string") return body;
  const id = body.response?.steamid;
  return body.response?.success === 1 && id && /^\d{17}$/.test(id) ? id : "missing";
}

export interface SteamProfileSummary extends SteamAccount {
  /** Steam's `communityvisibilitystate`: 3 is public; anything else hides the library. */
  public: boolean;
}

export async function playerSummary(steamId: string, key: string, budget: FetchBudget): Promise<SteamProfileSummary | "missing" | SteamCallFailure> {
  const body = await call<{ response?: { players?: Array<{ steamid?: string; personaname?: string; avatarfull?: string; avatarmedium?: string; communityvisibilitystate?: number }> } }>(
    "ISteamUser/GetPlayerSummaries/v2/",
    { steamids: steamId },
    key,
    budget,
  );
  if (typeof body === "string") return body;
  const player = body.response?.players?.find((item) => item.steamid === steamId);
  if (!player) return "missing";
  const avatar = player.avatarmedium ?? player.avatarfull ?? null;
  return {
    steamId,
    name: player.personaname?.slice(0, 64) ?? null,
    avatar: avatar && /^https:\/\/[a-z0-9.-]+\.(steamstatic|akamaihd)\.(com|net)\//i.test(avatar) ? avatar : null,
    public: player.communityvisibilitystate === 3,
  };
}

/**
 * Every app on the account with its playtime. An empty answer (no `games`)
 * is what Steam returns when "Game details" is private — indistinguishable
 * from an empty account, which the route words for.
 */
export async function ownedGames(steamId: string, key: string, budget: FetchBudget): Promise<SteamOwnedGame[] | SteamCallFailure> {
  const body = await call<{ response?: { games?: Array<{ appid?: number; name?: string; playtime_forever?: number; rtime_last_played?: number }> } }>(
    "IPlayerService/GetOwnedGames/v1/",
    { steamid: steamId, include_appinfo: "1", include_played_free_games: "1" },
    key,
    budget,
  );
  if (typeof body === "string") return body;
  return (body.response?.games ?? []).flatMap((game): SteamOwnedGame[] =>
    typeof game.appid === "number" && Number.isInteger(game.appid) && game.appid > 0
      ? [{
          appid: game.appid,
          name: (game.name ?? `App ${game.appid}`).slice(0, 200),
          minutes: Math.max(0, Math.round(game.playtime_forever ?? 0)),
          lastPlayed: Math.max(0, Math.round(game.rtime_last_played ?? 0)),
        }]
      : [],
  );
}
