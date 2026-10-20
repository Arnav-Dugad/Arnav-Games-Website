import { NextResponse } from "next/server";
import { serviceAccount } from "@/lib/firebase/server/credentials";
import { verifyIdToken } from "@/lib/firebase/server/id-token";
import { FetchBudget } from "@/lib/games/fetch-budget";
import { igdbConfigured, listGamesByIds } from "@/lib/games/providers/igdb";
import { igdbIdsForSteamApps, timeToBeatFor } from "@/lib/games/providers/igdb-extras";
import { ownedGames, playerSummary, resolveVanity, steamApiKey } from "@/lib/games/steam-web-api";
import {
  MATCH_PAGE,
  parseAppids,
  parseSteamProfile,
  rankOwnedGames,
  type SteamImportFailure,
  type SteamImportResponse,
  type SteamMatch,
} from "@/lib/personal/steam-import";

/**
 * Steam library import, for a signed-in reader.
 *
 *   GET  /api/steam/import                      → { configured }
 *   POST /api/steam/import   Authorization: Bearer <Firebase ID token>
 *        { profile: "https://steamcommunity.com/id/…" }   first call
 *        { appids: number[] }  (≤ 100)                     each following page
 *
 * The first call resolves the profile, reads the owned games (most played
 * first, capped at `IMPORT_MAX`) and matches the first 100 to IGDB; the
 * review sheet then pages through the rest with `appids`, so no single
 * invocation does more than one page of matching. Nothing is written here —
 * the browser writes the reviewed rows to the reader's own Firestore
 * documents, under the usual rules.
 *
 * Outbound requests per call (cold caches): Google signing keys ≤ 2, Steam
 * ≤ 3 (vanity, summary, owned games; first call only), IGDB ≤ 5 (token,
 * external ids, summaries, logos, time to beat) — ≤ 10, well inside the
 * Workers Free 50. IGDB answers are cached (catalogue data); the reader's
 * Steam data never is, and none of it is logged.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

const MESSAGES: Record<SteamImportFailure, string> = {
  "not-configured": "Steam import isn't switched on for this site yet.",
  "signed-out": "Sign in again to import your Steam library.",
  "bad-input": "That doesn't look like a Steam profile. Paste your profile link, custom URL name or SteamID64.",
  "not-found": "Steam doesn't know that profile. Check the link or custom URL name.",
  private: "Steam won't share this library because its game details are private.",
  empty: "Steam returned no games for this profile. If you own games, your game details are probably private.",
  "steam-down": "Steam or the game catalogue didn't answer. Try again in a minute.",
  "rate-limited": "Steam is asking us to slow down. Try again in a minute.",
};

function fail(reason: SteamImportFailure, status = 200) {
  const body: SteamImportResponse = { ok: false, reason, message: MESSAGES[reason] };
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET() {
  const configured = Boolean(await steamApiKey()) && igdbConfigured();
  return NextResponse.json({ configured }, { headers: { "Cache-Control": "public, max-age=300" } });
}

/** One page of appids → catalogue matches. Null when IGDB couldn't be asked. */
async function matchPage(appids: number[]): Promise<{ matches: SteamMatch[]; matched: number[] } | null> {
  const ids = await igdbIdsForSteamApps(appids);
  if (!ids) return null;
  const gameIds = [...new Set(ids.values())];
  const [games, ttb] = await Promise.all([
    gameIds.length ? listGamesByIds(gameIds).catch(() => null) : Promise.resolve([]),
    gameIds.length ? timeToBeatFor(gameIds) : Promise.resolve(new Map()),
  ]);
  if (!games) return null;
  const byId = new Map(games.map((game) => [game.id, game]));
  const matches: SteamMatch[] = [];
  for (const appid of appids) {
    const game = byId.get(ids.get(appid) ?? -1);
    if (!game) continue;
    const hours = ttb.get(game.id);
    matches.push({
      appid,
      id: game.id,
      slug: game.slug,
      name: game.name,
      image: game.image,
      imageFallback: game.imageFallback,
      released: game.released,
      releaseWindow: game.releaseWindow,
      tba: game.tba,
      metacritic: game.metacritic,
      genres: game.genres.map(({ id, slug, name }) => ({ id, slug, name })),
      platformSlugs: game.parentPlatforms.map((platform) => platform.slug),
      hours: hours?.normally ?? hours?.hastily ?? null,
    });
  }
  return { matches, matched: appids };
}

export async function POST(request: Request) {
  const key = await steamApiKey();
  if (!key || !igdbConfigured()) return fail("not-configured");

  const budget = new FetchBudget(12);
  const projectId = (await serviceAccount())?.projectId ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? null;
  if (!projectId) return fail("not-configured");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const user = await verifyIdToken(token, projectId, budget);
  if (!user) return fail("signed-out", 401);

  let body: { profile?: unknown; appids?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("bad-input", 400);
  }

  // A following page: catalogue matching only.
  if (body.appids !== undefined) {
    const appids = parseAppids(body.appids);
    if (!appids) return fail("bad-input", 400);
    const page = await matchPage(appids);
    if (!page) return fail("steam-down", 503);
    const response: SteamImportResponse = { ok: true, ...page };
    return NextResponse.json(response, { headers: NO_STORE });
  }

  const ref = typeof body.profile === "string" ? parseSteamProfile(body.profile) : null;
  if (!ref) return fail("bad-input", 400);

  let steamId: string;
  if (ref.kind === "vanity") {
    const resolved = await resolveVanity(ref.name, key, budget);
    if (resolved === "missing") return fail("not-found");
    if (resolved === "down" || resolved === "rate-limited") return fail(resolved === "down" ? "steam-down" : "rate-limited", 503);
    steamId = resolved;
  } else {
    steamId = ref.id;
  }

  const [summary, owned] = await Promise.all([playerSummary(steamId, key, budget), ownedGames(steamId, key, budget)]);
  if (summary === "missing") return fail("not-found");
  if (summary === "rate-limited" || owned === "rate-limited") return fail("rate-limited", 503);
  if (summary === "down" || owned === "down") return fail("steam-down", 503);
  if (owned.length === 0) return fail(summary.public ? "empty" : "private");

  const games = rankOwnedGames(owned);
  const page = await matchPage(games.slice(0, MATCH_PAGE).map((game) => game.appid));
  if (!page) return fail("steam-down", 503);

  const response: SteamImportResponse = {
    ok: true,
    account: { steamId, name: summary.name, avatar: summary.avatar },
    games,
    ...page,
  };
  return NextResponse.json(response, { headers: NO_STORE });
}
