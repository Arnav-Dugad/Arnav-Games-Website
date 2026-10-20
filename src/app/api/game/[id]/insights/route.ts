import { NextResponse } from "next/server";
import { antiCheatStatus } from "@/lib/games/anticheat";
import { geForceNowFor } from "@/lib/games/cloud";
import { gogLocalPrice } from "@/lib/games/gog";
import { liveDataFor } from "@/lib/games/live";
import { marketFor, resolveMarketIds } from "@/lib/games/market";
import { pcInfoFor } from "@/lib/games/pc";
import { steamUpdates } from "@/lib/games/patches";
import { settle } from "@/lib/games/polite";
import { twitchIdFor } from "@/lib/games/twitch-history";
import type { GameInsights, GameLiveData, LowestEverPrice } from "@/lib/games/types";

/**
 * Everything the game page needs from the server after first paint, in ONE
 * Worker request (it used to be eight: /live, /market, /players, /pc,
 * /patches, /reviews, /twitch, /scores). Our own history series aren't here
 * at all — the browser reads them straight from Firestore. The slower,
 * below-the-fold sources (SteamSpy, PCGamingWiki, speedrun.com, mods,
 * people) are a second, lazy request: `/api/game/[id]/extras`.
 *
 *   GET /api/game/119133/insights?cc=IN&steam=1245620&twitch=512953&name=Elden%20Ring
 *   GET /api/game/367520/insights?cc=GB&steam=367520&name=…     (Steam-only title)
 *
 * `[id]` is the IGDB id, with the same optional `steam` / `ms` / `twitch`
 * hints as `/live` and `/market` (validated; only ever used to build URLs on
 * fixed hosts). `cc` is the price country (ISO 3166-1 alpha-2, default US).
 * `name` feeds the title-matched sources (Twitch fallback, CheapShark, GOG,
 * GeForce NOW and anti-cheat when there's no Steam app). The regional price
 * comparison stays opt-in on `/market?regional=1`, and live refreshes poll
 * the lighter `/live`.
 *
 * Outbound requests (Workers Free allows 50 per invocation), all caches cold:
 * IGDB ids ≤ 2, Twitch category lookup ≤ 1 (only when IGDB has no link),
 * live ≤ 16 (Steam players/reviews/30-day histogram/news ≤ 5, Twitch ≤ 4, CheapShark ≤ 4,
 * Game Pass ≤ 3), market ≤ 8 (Steam + Microsoft prices, GOG search + price,
 * the free check, the Firestore history read and, after the response, at
 * most one Firestore commit), PC ≤ 4, patches + updates timeline ≤ 2 (one
 * feed), GeForce NOW 1, anti-cheat 1 — about 35 at worst (live includes the
 * Steam 30-day review histogram), 3–6 warm.
 */

const COUNTRY = /^[A-Z]{2}$/;
const MAX_NAME = 120;
/** NVIDIA's and AreWeAntiCheatYet's lists are ~0.4 MB; past this the page renders without them. */
const LIST_MS = 6000;

const badRequest = (error: string) =>
  NextResponse.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });

/**
 * CheapShark's all-time low (dollars) as the labelled historic marker, with
 * that low as a discount off the highest retail price its stores list today
 * (the buying tip compares discounts, which travel across currencies).
 */
function lowestEverFrom(deals: GameLiveData["deals"]): LowestEverPrice | null {
  const low = deals?.historicalLow;
  if (!low || !Number.isFinite(low.price) || low.price < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(low.date)) return null;
  const retail = Math.max(0, ...(deals?.stores ?? []).map((deal) => (Number.isFinite(deal.retail) ? deal.retail : 0)));
  const deepestDiscount = retail > 0 && low.price <= retail ? Math.round((1 - low.price / retail) * 100) : null;
  return {
    price: Math.round(low.price * 100),
    currency: "USD",
    date: low.date,
    label: "Lowest ever (US, all stores)",
    source: "cheapshark",
    deepestDiscount,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;

  const cc = (search.get("cc")?.trim() || "US").toUpperCase();
  if (!COUNTRY.test(cc) || cc === "XX" || cc === "T1") return badRequest("cc must be an ISO 3166-1 alpha-2 country");
  const nameRaw = search.get("name")?.trim() || null;
  const name = nameRaw ? nameRaw.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_NAME).trim() || null : null;

  const ids = await resolveMarketIds(id, search);
  if (typeof ids === "string") return badRequest(ids);
  // IGDB doesn't link every game to Twitch; Twitch's own mapping fills in (cached a day).
  const twitch = ids.twitch ?? (ids.igdbId ? await twitchIdFor(ids.igdbId).catch(() => null) : null);

  const unavailable: GameInsights["unavailable"] = [];
  const [live, market, pc, patches, geforceNow, antiCheat] = await Promise.all([
    liveDataFor({ igdbId: ids.igdbId, steam: ids.steam, twitch, microsoft: ids.microsoft, name }),
    // A game with no Steam/Microsoft listing only gets a market when GOG sells
    // it, so the price-history read isn't spent on console-only titles. (The
    // second GOG lookup inside marketFor is a data-cache hit.)
    (ids.steam || ids.microsoft ? Promise.resolve(true) : name ? gogLocalPrice(name, cc).then(Boolean) : Promise.resolve(false)).then((priced) =>
      priced
        ? marketFor({ ...ids, twitch }, cc, { regional: false, name }).catch((err: unknown) => {
            console.error("[api/insights] market failed", err);
            unavailable.push("market");
            return null;
          })
        : null,
    ),
    ids.steam
      ? pcInfoFor(ids.steam).catch(() => {
          unavailable.push("pc");
          return null;
        })
      : null,
    ids.steam
      ? steamUpdates(ids.steam).then((feed) => {
          if (feed === null) unavailable.push("patches");
          return feed;
        })
      : null,
    ids.steam || name ? settle(geForceNowFor({ steam: ids.steam, name }), null, LIST_MS) : null,
    ids.steam || name ? settle(antiCheatStatus({ steam: ids.steam, name }), undefined, LIST_MS) : null,
  ]);
  if ((ids.steam || name) && geforceNow === null) unavailable.push("cloud");
  if (antiCheat === undefined) unavailable.push("antiCheat");

  // `lowestEver` rides along from the live deals lookup: no extra request.
  const marketBody = market ? { ...market, lowestEver: lowestEverFrom(live.deals) } : null;

  const body: GameInsights = {
    ids: { key: ids.key, igdbId: ids.igdbId, steam: ids.steam, microsoft: ids.microsoft, twitch },
    live,
    market: marketBody,
    pc,
    patches: patches?.patches ?? null,
    updates: patches?.posts ?? null,
    unavailable,
    cloud: { geforceNow },
    antiCheat: antiCheat ?? null,
  };
  return NextResponse.json(body, {
    headers: {
      // `max-age` lets the browser reuse the answer on back/forward and quick
      // reloads without another Worker request. (On workers.dev Cloudflare
      // doesn't edge-cache Worker responses, so `s-maxage` only matters if a
      // custom domain with a cache rule is ever put in front.)
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
