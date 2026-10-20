/**
 * Self-checks for the pure logic in the data layer.
 *
 * These functions decide what date a user is shown and which provider owns a
 * slug, and they cannot be exercised against the live APIs from every
 * environment. Everything here is deterministic, so it is worth pinning down.
 *
 * Run with:  npx tsx scripts/check-providers.ts
 */

import { appidFromSlug, parseSteamDate, steamSlug } from "../src/lib/games/providers/steam";
import { sizedImage } from "../src/lib/games/image";
import { platformKey, releaseLabel, isUnreleased } from "../src/lib/utils/format";
import { stripHtml, slugify } from "../src/lib/utils/html";
import { classifyUrl, storeFromUrl } from "../src/lib/games/stores";
import { buildTasteProfile, MIN_TASTE_STRENGTH } from "../src/lib/games/taste";
import { buildDirectoryWhere, parseDirectorySearchParams } from "../src/lib/games/directory";
import { canonicalEntryHref, releaseNotifications } from "../src/lib/notifications/model";
import { groupSearchHits, hrefForSearchHit, type SearchHit } from "../src/lib/games/search";
import { buildDashboardSnapshot, daysUntilRelease } from "../src/lib/games/dashboard";
import { buildLibraryStats } from "../src/lib/games/stats";
import { releaseState } from "../src/lib/games/release-state";
import { fuzzyMatches, normaliseSearch, searchQueryVariants } from "../src/lib/games/fuzzy-search";
import { batchPatchForEntry, type WatchlistEntry } from "../src/lib/firebase/db";
import { localReleaseFor, regionForCountry } from "../src/lib/games/regions";
import { buildHypeIndex, hypeScore } from "../src/lib/games/hype";
import { stripNewsMarkup } from "../src/lib/games/news-text";
import { paletteFromPixels, logoToneFromPixels } from "../src/lib/games/palette-core";
import { decodePng } from "../src/lib/games/image-decode";
import { changesFromObservations, isDelay, releaseUpperBound, releaseValue } from "../src/lib/games/release-value";
import { normaliseStoreTitle } from "../src/lib/games/providers/igdb-extras";
import {
  choosePlayerSamples,
  convertMinor,
  currencyDigits,
  planPriceRequests,
  rotatingSlice,
  deckStatusFromCategory,
  downsamplePlayers,
  priceVerdict,
  rarityBands,
  reliabilityFromObservations,
  steamToMinor,
} from "../src/lib/games/market-rules";
import { microsoftPriceOf } from "../src/lib/games/ms-store";
import { valuePerHour } from "../src/lib/games/market-rules";
import { condensePatchPost, isPatchPost, parsePatchBody, patchNotesFrom, steamFeedFrom } from "../src/lib/games/patch-notes";
import { estimatedSteamSales, nextSteamSale, steamSalesFor } from "../src/lib/games/steam-sales";
import { buyingTip, publisherHabit, saleSentence } from "../src/lib/games/buying-tip";
import { recentFromHistogram, scoreSpread } from "../src/lib/games/score-spread";
import { confidenceLabel, releaseConfidence, usableStudioRecord } from "../src/lib/games/release-confidence";
import { summariseStudioGames } from "../src/lib/games/studio-record";
import {
  CPU_SUGGESTIONS,
  evaluateHardware,
  GPU_SUGGESTIONS,
  matchCpu,
  matchGpu,
  matchGpus,
  parsePcRequirements,
  typicalVram,
} from "../src/lib/games/hardware";
import { backlogForecast } from "../src/lib/games/forecast";
import { cleanRenderer } from "../src/lib/games/pc-detect";
import { cleanCustomTag, parseMyTags, topPlayerTags } from "../src/lib/games/community-tags";
import { downsampleTwitch, reviewVelocity, scoreTimeline, sumStreams } from "../src/lib/games/history-rules";
import { decodeFields, encodeFields, fieldPath } from "../src/lib/firebase/server/values";
import {
  expiredDays,
  expiredHours,
  observationRows,
  playerRows,
  priceRows,
  releaseShardPath,
  scoreRows,
  twitchRows,
} from "../src/lib/games/stats-docs";
import type { PricePoint } from "../src/lib/games/types";
import type { ReleaseEvent } from "../src/lib/games/types";
import {
  antiCheatFor,
  compactAntiCheat,
  compactCommunities,
  compactGfn,
  formatRunTime,
  gfnLookup,
  gfnMembership,
  GFN_NOT_LISTED,
  matchCommunity,
  normaliseTitle,
  parseEpicPromotions,
  parseGogPrices,
  parseOwners,
  parsePcgwWikitext,
  parseSpeedrunRecords,
  parseSteamSpy,
  parseThunderstoreListing,
  pcgwSteamAppids,
  pcgwSupport,
  pickGogProduct,
  pickSpeedrunGame,
  sameGameTitle,
  steamAppFromUrl,
  topTaggedApps,
} from "../src/lib/games/external-rules";
import {
  bayesianAverage,
  buildCorpus,
  cosine,
  denseDot,
  denseTaste,
  denseUnit,
  diversityOf,
  documentFrequency,
  normalise,
  sortedDot,
  featureId,
  featureKey,
  featureType,
  idf,
  lengthFit,
  mmr,
  popularity,
  qualityPrior,
  recencyDecay,
  scoreCandidate,
  sharedFeatures,
  tasteVector,
  tfidfVector,
} from "../src/lib/recs/rank";
import { buildTasteProfile as buildRecsProfile, hasEnoughTaste, normaliseOwnedPlatform, parseRecsProfile, ratingMultiplier } from "../src/lib/recs/profile";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n         expected ${b}\n         actual   ${a}`);
  }
}

console.log("\nSteam release-date parsing");
check("exact, day first", parseSteamDate("25 Feb, 2022"), {
  released: "2022-02-25",
  releaseWindow: null,
  tba: false,
});
check("exact, month first", parseSteamDate("Feb 25, 2022"), {
  released: "2022-02-25",
  releaseWindow: null,
  tba: false,
});
check("exact, full month name", parseSteamDate("3 September 2025"), {
  released: "2025-09-03",
  releaseWindow: null,
  tba: false,
});
check("quarter stays a window", parseSteamDate("Q4 2026"), {
  released: null,
  releaseWindow: "Q4 2026",
  tba: false,
});
check("month-year stays a window", parseSteamDate("March 2026"), {
  released: null,
  releaseWindow: "March 2026",
  tba: false,
});
check("bare year stays a window", parseSteamDate("2027"), {
  released: null,
  releaseWindow: "2027",
  tba: false,
});
check("marketing filler is TBA", parseSteamDate("Coming soon"), {
  released: null,
  releaseWindow: null,
  tba: true,
});
check("empty is TBA", parseSteamDate(undefined), {
  released: null,
  releaseWindow: null,
  tba: true,
});

console.log("\nSteam slug round-trip");
check("mints a readable slug", steamSlug("ELDEN RING", 1245620), "elden-ring-s1245620");
check("recovers the appid", appidFromSlug("elden-ring-s1245620"), 1245620);
check("punctuation is stripped", steamSlug("Baldur's Gate 3", 1086940), "baldurs-gate-3-s1086940");
check("recovers from punctuated slug", appidFromSlug("baldurs-gate-3-s1086940"), 1086940);
check("foreign slug is not claimed", appidFromSlug("the-witcher-3-wild-hunt"), null);
check("trailing digits alone are not an appid", appidFromSlug("half-life-2"), null);

console.log("\nPlatform vocabulary normalisation");
check("IGDB windows", platformKey("win"), "pc");
check("IGDB ps5", platformKey("ps5"), "playstation");
check("IGDB ps4 variant", platformKey("ps4--1"), "playstation");
check("IGDB series x|s", platformKey("series-x-s"), "xbox");
check("IGDB xbox one", platformKey("xboxone"), "xbox");
check("IGDB switch", platformKey("switch"), "nintendo");
check("IGDB n64", platformKey("n64"), "nintendo");
check("psp is playstation", platformKey("psp"), "playstation");
check("family slug maps to itself", platformKey("playstation"), "playstation");
check("mobile family", platformKey("mobile"), "mobile");
check("ios collapses to mobile", platformKey("ios"), "mobile");
check("unknown is dropped", platformKey("dreamcast"), null);

console.log("\nIGDB image resizing");
const cover = "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co4jni.jpg";
check(
  // 240px CSS is ~480px on a retina display, so the ladder deliberately stays
  // at the 528px asset rather than dropping to the 264px one.
  "card width keeps the retina-sized asset",
  sizedImage(cover, 240),
  "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co4jni.jpg",
);
check(
  "thumbnail width does drop to the small asset",
  sizedImage(cover, 96),
  "https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg",
);
check(
  "hero preserves the portrait cover transform",
  sizedImage(cover, 1920),
  "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co4jni.jpg",
);
check(
  "non-IGDB host is untouched",
  sizedImage("https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg", 1920),
  "https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg",
);
check("null stays null", sizedImage(null, 800), null);

console.log("\nRelease labelling");
check(
  "exact date formats",
  releaseLabel({ released: "2022-02-25", releaseWindow: null, tba: false }),
  "Feb 25, 2022",
);
check(
  "window prints verbatim",
  releaseLabel({ released: null, releaseWindow: "Q4 2026", tba: false }),
  "Q4 2026",
);
check(
  "nothing known reads as TBA",
  releaseLabel({ released: null, releaseWindow: null, tba: true }),
  "Date TBA",
);
check(
  "a future window counts as unreleased",
  isUnreleased({ released: null, releaseWindow: "Q4 2099", tba: false }),
  true,
);
check(
  "a past date is released",
  isUnreleased({ released: "2020-01-01", releaseWindow: null, tba: false }),
  false,
);
check(
  "explicit TBA counts as upcoming",
  releaseState({ released: null, releaseWindow: null, tba: true }, new Date("2026-08-12T12:00:00Z")),
  "upcoming",
);
check(
  "truly absent date data stays unknown",
  releaseState({ released: null, releaseWindow: null, tba: false }, new Date("2026-08-12T12:00:00Z")),
  "unknown",
);
check(
  "an expired release window is released",
  releaseState({ released: null, releaseWindow: "Q4 2020", tba: false }, new Date("2026-08-12T12:00:00Z")),
  "released",
);
check(
  "a confirmed future quarter is upcoming",
  releaseState({ released: null, releaseWindow: "Q4 2026", tba: false }, new Date("2026-08-12T12:00:00Z")),
  "upcoming",
);
check(
  "month-year is released from the first of that month",
  releaseState({ released: null, releaseWindow: "Aug 2026", tba: false }, new Date("2026-08-12T12:00:00Z")),
  "released",
);
check(
  "full month-year is released from the first of that month",
  releaseState({ released: null, releaseWindow: "August 2026", tba: false }, new Date("2026-08-01T00:00:00Z")),
  "released",
);

console.log("\nStore/link classification");
check(
  "steam store link yields the appid",
  classifyUrl("https://store.steampowered.com/app/1245620/ELDEN_RING/"),
  { slug: "steam", name: "Steam", domain: "store.steampowered.com", kind: "store", steamAppId: 1245620 },
);
check(
  "epic is a store",
  classifyUrl("https://store.epicgames.com/en-US/p/alan-wake-2")?.slug,
  "epic",
);
check("gog is a store", classifyUrl("https://www.gog.com/game/cyberpunk_2077")?.slug, "gog");
check(
  "playstation store",
  classifyUrl("https://store.playstation.com/en-us/product/UP9000-PPSA01284_00")?.slug,
  "playstation",
);
check("nintendo eshop", classifyUrl("https://www.nintendo.com/store/products/x/")?.slug, "nintendo");
check("youtube is social, not a store", classifyUrl("https://youtube.com/watch?v=x")?.kind, "social");
check("storeFromUrl rejects social links", storeFromUrl("https://twitter.com/fromsoftware"), null);
check("an official site matches nothing", classifyUrl("https://eldenring.bandainamco.com"), null);
check("garbage input is safe", classifyUrl("not a url"), null);

console.log("\nTaste profile");
{
  const now = Date.parse("2026-08-01T00:00:00Z");
  const recent = now - 1000 * 60 * 60 * 24 * 10;
  const old = now - 1000 * 60 * 60 * 24 * 900;

  const profile = buildTasteProfile(
    [
      // Finished recently — the strongest possible signal.
      { gameId: 1, genreIds: [12], platformSlugs: ["playstation"], status: "played",
        platform: "playstation", addedAt: recent, finishedAt: recent },
      { gameId: 2, genreIds: [12], platformSlugs: ["playstation"], status: "played",
        platform: "playstation", addedAt: recent, finishedAt: recent },
      // Wishlisted long ago — should barely register.
      { gameId: 3, genreIds: [15], platformSlugs: ["pc"], status: "want",
        platform: null, addedAt: old, finishedAt: null },
    ],
    { now },
  );
  check("strongest genre wins", profile.genreIds[0], 12);
  check("recorded play platform leads", profile.platformSlugs[0], "playstation");
  check("everything seen is excluded", profile.excludeIds.sort(), [1, 2, 3]);
  check("strength reflects real evidence", profile.strength > MIN_TASTE_STRENGTH, true);
}
{
  // A single stale wishlist entry is not a taste profile.
  const now = Date.parse("2026-08-01T00:00:00Z");
  const thin = buildTasteProfile(
    [
      {
        gameId: 9,
        genreIds: [4],
        platformSlugs: ["pc"],
        status: "want",
        platform: null,
        addedAt: now - 1000 * 60 * 60 * 24 * 1200,
        finishedAt: null,
      },
    ],
    { now },
  );
  check("thin evidence stays below the threshold", thin.strength < MIN_TASTE_STRENGTH, true);
}
check("no library yields no profile", buildTasteProfile([]).genreIds, []);

console.log("\nDirectory URL parsing");
check("defaults are stable", parseDirectorySearchParams({}), {
  query: "",
  page: 1,
  order: "name",
  letter: null,
});
check("search, page and descending sort", parseDirectorySearchParams({
  q: "  CD Projekt  ",
  page: "4",
  sort: "desc",
}), {
  query: "CD Projekt",
  page: 4,
  order: "-name",
  letter: null,
});
check("invalid page is bounded", parseDirectorySearchParams({ page: "not-a-page" }).page, 1);
check("negative page is bounded", parseDirectorySearchParams({ page: "-20" }).page, 1);
check("huge page is bounded", parseDirectorySearchParams({ page: "9000" }).page, 1000);
check(
  "directory text becomes a contains filter",
  buildDirectoryWhere("games != null", "Final Fantasy"),
  'games != null & name ~ *"Final Fantasy"*',
);
check(
  "directory operators cannot escape the filter",
  buildDirectoryWhere("games != null", 'Halo" | id > 0;'),
  'games != null & name ~ *"Halo id > 0"*',
);

console.log("\nNotification signals");
const notificationEntry = (overrides: Partial<WatchlistEntry> = {}): WatchlistEntry => ({
  gameId: 77,
  steamAppId: 124,
  slug: "signal-game",
  name: "Signal Game",
  image: null,
  imageFallback: null,
  released: "2026-08-15",
  releaseWindow: null,
  tba: false,
  metacritic: null,
  watchlisted: true,
  metadataVersion: 3,
  metadataUpdatedAt: 0,
  status: "want",
  platform: null,
  startedAt: null,
  finishedAt: null,
  genreIds: [],
  platformSlugs: [],
  ownedOn: [],
  addedAt: 0,
  ...overrides,
  following: overrides.following ?? true,
  subscriptionAccess: overrides.subscriptionAccess ?? [],
  followedReleases: overrides.followedReleases ?? [],
});
check(
  "release inside fourteen days alerts",
  releaseNotifications([notificationEntry()], Date.parse("2026-08-09T12:00:00Z"))[0]?.kind,
  "release-soon",
);
check(
  "distant release stays quiet",
  releaseNotifications([notificationEntry({ released: "2026-09-15" })], Date.parse("2026-08-09T12:00:00Z")),
  [],
);
check(
  "explicitly unfollowed games never alert",
  releaseNotifications([notificationEntry({ following: false })], Date.parse("2026-08-09T12:00:00Z")),
  [],
);
check(
  "a followed game's DLC alerts independently of the base release",
  releaseNotifications([notificationEntry({
    released: "2020-01-01",
    followedReleases: [{ gameId: 88, slug: "signal-dlc", name: "Signal DLC", kind: "dlc", released: "2026-08-10", releaseWindow: null, image: null, imageFallback: null }],
  })], Date.parse("2026-08-09T12:00:00Z"))[0]?.kind,
  "dlc-soon",
);
check(
  "Steam fallback entry routes to IGDB search",
  canonicalEntryHref(notificationEntry({ slug: "signal-game-s124" })),
  "/browse?search=Signal%20Game",
);

console.log("\nPersonal dashboard signals");
const dashboardNow = Date.parse("2026-08-09T12:00:00Z");
const dashboardSnapshot = buildDashboardSnapshot([
  notificationEntry({ gameId: 1, status: "want", released: "2026-08-25", addedAt: 10 }),
  notificationEntry({ gameId: 2, status: "playing", released: "2025-01-01", startedAt: 30, addedAt: 20, ownedOn: ["steam"] }),
  notificationEntry({ gameId: 3, status: "played", released: "2024-01-01", finishedAt: 40, addedAt: 30, ownedOn: ["physical"] }),
  notificationEntry({ gameId: 4, status: "none", released: null, releaseWindow: null, tba: true, addedAt: 40 }),
], dashboardNow);
check("currently playing leads the focus card", dashboardSnapshot.focus?.gameId, 2);
check("nearest future tracked release wins", dashboardSnapshot.nextRelease?.gameId, 1);
check("dashboard status counts are honest", [dashboardSnapshot.playing, dashboardSnapshot.played, dashboardSnapshot.wanted], [1, 1, 1]);
check("owned count ignores wishlist-only games", dashboardSnapshot.owned, 2);
check("thirty-day release window", dashboardSnapshot.releasesSoon, 1);
check("dashboard includes TBA in upcoming without using it as the next dated release", [dashboardSnapshot.upcoming.some((game) => game.gameId === 4), dashboardSnapshot.nextRelease?.gameId], [true, 1]);
check("release countdown is day-stable", daysUntilRelease("2026-08-25", dashboardNow), 16);

console.log("\nFirebase library statistics");
const libraryStats = buildLibraryStats([
  notificationEntry({ gameId: 10, name: "Cross-platform", ownedOn: ["steam", "playstation"], status: "played" }),
  notificationEntry({ gameId: 10, name: "Cross-platform", ownedOn: ["xbox"], status: "played", addedAt: 2 }),
  notificationEntry({ gameId: 11, name: "One copy", ownedOn: ["steam"], status: "want", addedAt: 3 }),
]);
check("duplicate records merge by game id", libraryStats.uniqueGames, 2);
check("multi-platform ownership counts once", libraryStats.ownedGames, 2);
check("platform copies remain a separate metric", libraryStats.platformCopies, 4);
const statusStats = buildLibraryStats([
  notificationEntry({ gameId: 20, status: "none", released: "2025-01-01" }),
  notificationEntry({ gameId: 21, status: "played", released: "2025-01-01" }),
  notificationEntry({ gameId: 22, status: "want", released: "2030-01-01" }),
]);
check("no-status games remain deliberately unclassified", statusStats.noStatus, 1);
check("unreleased games stay outside the completion base", [statusStats.unreleasedGames, statusStats.completionBase], [1, 2]);
check("completion denominator is every released game", statusStats.completionRate, 50);
const repairedReleaseStats = buildLibraryStats([
  notificationEntry({ gameId: 30, status: "none", released: null, releaseWindow: null, tba: false }),
  notificationEntry({ gameId: 31, status: "played", released: null, releaseWindow: null, tba: false }),
]);
check("unknown dates never inflate upcoming", repairedReleaseStats.unreleasedGames, 0);
check("unknown dates are reported separately", repairedReleaseStats.unknownReleaseGames, 1);
check("played history proves a stale undated record is released", repairedReleaseStats.releasedGames, 1);
check("explicit TBA is included in upcoming", buildLibraryStats([
  notificationEntry({ gameId: 32, released: null, releaseWindow: null, tba: true }),
]).tbaGames, 1);
check(
  "cleared personal records do not inflate statistics",
  buildLibraryStats([notificationEntry({ watchlisted: false, following: false, status: "none" })]).uniqueGames,
  0,
);

console.log("\nFirebase batch editing");
const batchEntry = notificationEntry({ ownedOn: ["steam"], watchlisted: false, following: true, startedAt: null });
check("adding ownership preserves existing copies", batchPatchForEntry(batchEntry, { kind: "ownership-add", value: "ps5" }).ownedOn, ["steam", "ps5"]);
check("adding the same ownership never duplicates it", batchPatchForEntry(batchEntry, { kind: "ownership-add", value: "steam" }).ownedOn, ["steam"]);
check("batch status stamps first playing transition", batchPatchForEntry(batchEntry, { kind: "status", value: "playing" }, 1234), { status: "playing", startedAt: 1234 });
check("batch watchlist change touches one field only", batchPatchForEntry(batchEntry, { kind: "watchlisted", value: true }), { watchlisted: true });

console.log("\nHuman-friendly game search");
check("accents and Roman sequels normalise", normaliseSearch("Pokémon II"), "pokemon 2");
check("GTA abbreviation expands", searchQueryVariants("gta 5").includes("grand theft auto 5"), true);
check("abbreviation finds the full game title", fuzzyMatches("Grand Theft Auto V", "gta 5"), true);
check("transposed typo finds Cyberpunk", fuzzyMatches("Cyberpunk 2077", "cybperunk 2077"), true);
check("word-order changes still match", fuzzyMatches("The Legend of Zelda: Breath of the Wild", "zelda wild breath"), true);
check("unrelated titles stay out", fuzzyMatches("Stardew Valley", "cyberpunk"), false);

console.log("\nUniversal discovery routing");
const searchHit = (kind: SearchHit["kind"], slug: string): SearchHit => ({
  kind,
  id: 1,
  name: "Result",
  slug,
  subtitle: null,
  image: null,
});
check("franchise has its own route", hrefForSearchHit(searchHit("franchise", "cyberpunk")), "/franchise/cyberpunk");
check("genre routes to a genre filter", hrefForSearchHit(searchHit("genre", "role-playing-rpg")), "/browse?genres=role-playing-rpg");
check("exact platform routes to a platform filter", hrefForSearchHit(searchHit("platform", "ps5")), "/browse?platforms=ps5");
const groupedSearch = groupSearchHits([
  searchHit("franchise", "cyberpunk"),
  searchHit("genre", "cyberpunk"),
]);
check("genres never masquerade as franchises", [
  groupedSearch.get("franchise")?.length,
  groupedSearch.get("genre")?.length,
], [1, 1]);

console.log("\nRelease regions");
check("GB is Europe", regionForCountry("GB"), ["Europe", "Worldwide"]);
check("lowercase input", regionForCountry("de"), ["Europe", "Worldwide"]);
check("US is North America", regionForCountry("US"), ["North America", "Worldwide"]);
check("JP is Japan, then Asia", regionForCountry("JP"), ["Japan", "Asia", "Worldwide"]);
check("AU", regionForCountry("AU"), ["Australia", "Worldwide"]);
check("BR", regionForCountry("BR"), ["Brazil", "Worldwide"]);
check("KR", regionForCountry("KR"), ["Korea", "Asia", "Worldwide"]);
check("CN", regionForCountry("CN"), ["China", "Asia", "Worldwide"]);
check("IN is Asia", regionForCountry("IN"), ["Asia", "Worldwide"]);
check("unknown is worldwide", regionForCountry("ZZ"), ["Worldwide"]);
check("empty is worldwide", regionForCountry(""), ["Worldwide"]);
{
  const rel = (date: string | null, human: string, region: string | null): ReleaseEvent => ({ date, human, region, platform: null });
  const releases = [
    rel("2026-03-20", "Mar 20, 2026", "Japan"),
    rel("2026-04-10", "Apr 10, 2026", "Worldwide"),
    rel("2026-04-02", "Apr 2, 2026", "Worldwide"),
    rel(null, "Q2 2026", "Europe"),
  ];
  check("Japan date beats worldwide for JP", localReleaseFor(releases, "JP")?.date, "2026-03-20");
  check("earliest worldwide for US", localReleaseFor(releases, "US")?.date, "2026-04-02");
  check("regional window wins over worldwide date", localReleaseFor(releases, "FR")?.human, "Q2 2026");
  check("no matching region is null", localReleaseFor([rel("2026-01-01", "x", "Japan")], "US"), null);
  check("unspecified region counts as worldwide", localReleaseFor([rel("2026-01-01", "x", null)], "US")?.date, "2026-01-01");
}

console.log("\nHype index");
{
  const base = { hypes: 0, wantToPlay: null, visits: null, playing: null, peakPlayers24h: null };
  check("no signal is no index", buildHypeIndex(base), null);
  check("zero signals score zero", hypeScore(base), 0);
  check("saturated signals score 100", hypeScore({ hypes: 5000, wantToPlay: 0.01, visits: 0.01, playing: 0.01, peakPlayers24h: 0.5 }), 100);
  const keys = ["hypes", "wantToPlay", "visits", "playing", "peakPlayers24h"] as const;
  const ladder: Record<(typeof keys)[number], number[]> = {
    hypes: [0, 1, 10, 100, 1000, 5000],
    wantToPlay: [0.000001, 0.00001, 0.0001, 0.001, 0.01],
    visits: [0.000001, 0.00001, 0.0001, 0.001, 0.01],
    playing: [0.000001, 0.00001, 0.0001, 0.001, 0.01],
    peakPlayers24h: [0.0000001, 0.00001, 0.001, 0.1],
  };
  for (const key of keys) {
    const scores = ladder[key].map((value) => hypeScore({ ...base, hypes: 20, [key]: value }));
    check(`monotonic in ${key}`, scores.every((score, i) => i === 0 || score >= scores[i - 1]), true);
    check(`${key} actually moves the score`, scores[scores.length - 1] > scores[0], true);
  }
  const er = hypeScore({ hypes: 96, wantToPlay: 0.00117, visits: 0.000343, playing: 0.00287, peakPlayers24h: 0.0054 });
  check("a heavyweight lands in the 70–95 band", er >= 70 && er <= 95, true);
}

console.log("\nNews text");
check(
  "BBCode stripped, link label kept",
  stripNewsMarkup("[h1]Patch 1.2[/h1][b]New:[/b] [url=https://x.y]read more[/url] [img]{STEAM_CLAN_IMAGE}/a/b.png[/img]"),
  "Patch 1.2 New: read more",
);
check("list bullets", stripNewsMarkup("[list][*]One[*]Two[/list]"), "One • Two");
check(
  "Steam's closed list items and paragraphs",
  stripNewsMarkup("[h3]Patch Notes[/h3][list][*][p]Added X[/p][/*][*][p]Fixed Y.[/p][/*][/list]"),
  "Patch Notes • Added X • Fixed Y.",
);
check("HTML and entities", stripNewsMarkup("<p>Fish &amp; chips&nbsp;&#8212; <a href='x'>now</a></p>"), "Fish & chips — now");
check("youtube previews dropped", stripNewsMarkup("Watch [previewyoutube=abc;full][/previewyoutube] it"), "Watch it");
check("bare urls dropped", stripNewsMarkup("See https://store.steampowered.com/app/1 today"), "See today");
check("truncates on a word", stripNewsMarkup("alpha beta gamma delta epsilon", 17), "alpha beta gamma…");

console.log("\nCover palette");
{
  // 10×11: 60 dark navy, 25 saturated orange, 15 dusty teal, 10 transparent.
  const width = 10;
  const height = 11;
  const data = new Uint8Array(width * height * 4);
  const paint = (from: number, to: number, rgba: [number, number, number, number]) => {
    for (let i = from; i < to; i++) data.set(rgba, i * 4);
  };
  paint(0, 60, [12, 18, 40, 255]);
  paint(60, 85, [240, 120, 20, 255]);
  paint(85, 100, [90, 130, 125, 255]);
  paint(100, 110, [255, 0, 255, 0]);
  check("dominant, vibrant and muted", paletteFromPixels(data, width, height), {
    dominant: "#0c1228",
    vibrant: "#f07814",
    muted: "#5a827d",
    isDark: true,
  });
  const light = new Uint8Array(16).fill(240);
  check("a light cover is not dark", paletteFromPixels(light, 2, 2)?.isDark, false);
  check("fully transparent has no palette", paletteFromPixels(new Uint8Array(16), 2, 2), null);
  check("black logo reads dark", logoToneFromPixels(new Uint8Array([0, 0, 0, 255, 10, 10, 10, 255])), "dark");
  check("white logo reads light", logoToneFromPixels(new Uint8Array([255, 255, 255, 255, 250, 250, 250, 255])), "light");
  check("red logo reads color", logoToneFromPixels(new Uint8Array([220, 30, 30, 255])), "color");
}

console.log("\nRelease delay tracking");
check("value prefers the day", releaseValue({ released: "2026-05-01", releaseWindow: "Q2 2026" }), "2026-05-01");
check("value falls back to the window", releaseValue({ released: null, releaseWindow: "Q4 2026" }), "Q4 2026");
check("value is TBA without either", releaseValue({ released: null, releaseWindow: null }), "TBA");
check("quarter bound", releaseUpperBound("Q4 2026"), "2026-12-31");
check("month bound (short)", releaseUpperBound("Feb 2028"), "2028-02-29");
check("month bound (long)", releaseUpperBound("September 2026"), "2026-09-30");
check("year bound", releaseUpperBound("2027"), "2027-12-31");
check("TBA has no bound", releaseUpperBound("TBA"), null);
check("narrowing inside a window is not a delay", isDelay("Q4 2026", "2026-11-15"), false);
check("slipping a quarter is a delay", isDelay("2026-11-15", "Q1 2027"), true);
check("moving earlier is not a delay", isDelay("2026-11-15", "2026-10-01"), false);
check("losing the date is a delay", isDelay("2026-11-15", "TBA"), true);
check("gaining a date is not a delay", isDelay("TBA", "2026-11-15"), false);
check(
  "changes chain oldest first",
  changesFromObservations([
    { value: "2027-02-01", observedAt: 300 },
    { value: "Q4 2026", observedAt: 100 },
    { value: "2026-11-15", observedAt: 200 },
  ]).map((change) => `${change.from}>${change.to}`),
  ["Q4 2026>2026-11-15", "2026-11-15>2027-02-01"],
);

console.log("\nStore title matching");
check("trademarks stripped", normaliseStoreTitle("Battlefield™ 6"), "Battlefield 6");
check("bundle suffix stripped", normaliseStoreTitle("Call of Duty®: Black Ops Cold War - Cross-Gen Bundle"), "Call of Duty: Black Ops Cold War");
check("windows suffix stripped", normaliseStoreTitle("Forza Horizon 5 (PC)"), "Forza Horizon 5");

console.log("\nHTML handling");
check(
  // A closing </p> and a <br> each contribute a break, so the paragraph gap is
  // intentional — `whitespace-pre-wrap` renders it as a blank line.
  "tags removed, entities decoded",
  stripHtml("<p>Requires a 64-bit&nbsp;processor</p><br><strong>OS:</strong> Windows 10"),
  "Requires a 64-bit processor\n\nOS: Windows 10",
);
check(
  "runs of blank lines are capped",
  stripHtml("<p>A</p><br><br><br><br><p>B</p>"),
  "A\n\nB",
);
check("list markers survive", stripHtml("<ul><li>One</li><li>Two</li></ul>"), "• One\n• Two");
check("apostrophes decode", stripHtml("Baldur&#39;s Gate"), "Baldur's Gate");
check("slugify", slugify("Hack and slash/Beat 'em up"), "hack-and-slash-beat-em-up");

console.log("\nMoney & FX");
check("Steam ×100 → cents", steamToMinor(5999, "USD"), 5999);
check("Steam ×100 → whole yen", steamToMinor(902000, "JPY"), 9020);
check("Steam ×100 → fils (KWD has 3 digits)", steamToMinor(1990, "KWD"), 19900);
check("rupiah prices have no decimals", currencyDigits("IDR"), 0);
check("same currency is not converted", convertMinor(5999, "USD", "USD", 0.5), 5999);
// ₹3,599 at 94.96 INR per USD → $37.90.
check("INR → USD rounds to the cent", convertMinor(359900, "INR", "USD", 94.96), 3790);
// ¥9,020 at 158.03 JPY per USD → $57.08.
check("JPY (0 digits) → USD (2 digits)", convertMinor(9020, "JPY", "USD", 158.03), 5708);
check("USD → JPY rounds to whole yen", convertMinor(5999, "USD", "JPY", 1 / 158.03), 9480);
check("no rate → null, never a guess", convertMinor(5999, "USD", "ARS", Number.NaN), null);

console.log("\nPrice verdict");
{
  const today = "2026-10-19";
  const days = (n: number, price: number, initial = 5999, from = "2026-08-01"): PricePoint[] =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10),
      store: "steam" as const,
      price,
      initial,
    }));
  const full = { price: 5999, initial: 5999, discount: 0, currency: "USD" };
  check("no price → unknown", priceVerdict({ current: null, history: [], today }).kind, "unknown");
  check(
    "free → fair",
    priceVerdict({ current: { price: 0, initial: 0, discount: 0, currency: "XXX" }, history: [], today }).kind,
    "fair",
  );
  check(
    "≥60% off → buy even with no history",
    priceVerdict({ current: { price: 2399, initial: 5999, discount: 60, currency: "USD" }, history: [], today }).kind,
    "buy",
  );
  check(
    "discounted at our lowest with 14+ days → buy",
    priceVerdict({
      current: { price: 3599, initial: 5999, discount: 40, currency: "USD" },
      history: [...days(20, 5999), { date: today, store: "steam", price: 3599, initial: 5999 }],
      today,
    }),
    { kind: "buy", reason: "Lowest price we've seen since Aug." },
  );
  check(
    "within 2% of the low still counts as the low",
    priceVerdict({
      current: { price: 3660, initial: 5999, discount: 39, currency: "USD" },
      history: [...days(20, 5999), { date: "2026-09-01", store: "steam", price: 3599, initial: 5999 }],
      today,
    }).kind,
    "buy",
  );
  check(
    "discounted but pricier than our low → fair",
    priceVerdict({
      current: { price: 4799, initial: 5999, discount: 20, currency: "USD" },
      history: [...days(20, 5999), { date: "2026-09-01", store: "steam", price: 2999, initial: 5999 }],
      today,
    }).kind,
    "fair",
  );
  check(
    "discounted with a thin history → fair, never a fake low",
    priceVerdict({ current: { price: 4799, initial: 5999, discount: 20, currency: "USD" }, history: days(3, 5999), today }).kind,
    "fair",
  );
  check(
    "full price after a recent 25%+ sale → wait",
    priceVerdict({
      current: full,
      history: [...days(5, 5999), { date: "2026-09-10", store: "steam", price: 2999, initial: 5999 }],
      today,
    }),
    { kind: "wait", reason: "It was 50% off in Sep — sales come round." },
  );
  check(
    "a sale older than 120 days doesn't trigger wait",
    priceVerdict({
      current: full,
      history: [...days(20, 5999), { date: "2026-05-01", store: "steam", price: 2999, initial: 5999 }],
      today,
    }).kind,
    "fair",
  );
  check("full price, < 14 days → unknown", priceVerdict({ current: full, history: days(5, 5999), today }).kind, "unknown");
  check("full price, long flat history → fair", priceVerdict({ current: full, history: days(30, 5999), today }).kind, "fair");
}

console.log("\nPlayer history downsampling");
{
  const H = 3600;
  const now = 1_800_000_000 - (1_800_000_000 % H);
  const samples = [
    // 8–9 days ago: one 6-hour bucket's worth, averaged.
    { hour: now - 9 * 24 * H - ((now - 9 * 24 * H) % (6 * H)), players: 100 },
    { hour: now - 9 * 24 * H - ((now - 9 * 24 * H) % (6 * H)) + H, players: 200 },
    // Within 7 days: kept hourly.
    { hour: now - 2 * 24 * H, players: 900 },
    { hour: now - 2 * H, players: 300 },
    { hour: now - H, players: 400 },
  ];
  const result = downsamplePlayers(samples, now);
  check("old samples merge into one 6-hour mean", result.points[0].players, 150);
  check("recent samples stay hourly", result.points.slice(1).map((p) => p.players), [900, 300, 400]);
  check("oldest first", result.points.every((p, i, a) => i === 0 || a[i - 1].t < p.t), true);
  check("peak24h from raw samples", result.peak24h, 400);
  check("peakTracked from raw samples", result.peakTracked, 900);
  check("nothing recorded → nulls, not zeros", downsamplePlayers([], now), {
    points: [],
    peak24h: null,
    peakTracked: null,
    since: null,
  });
}

console.log("\nSteam Deck & achievements");
check("deck 3 → verified", deckStatusFromCategory(3), "verified");
check("deck 2 → playable", deckStatusFromCategory(2), "playable");
check("deck 1 → unsupported", deckStatusFromCategory(1), "unsupported");
check("deck 0 → unknown", deckStatusFromCategory(0), "unknown");
check("deck missing → null", deckStatusFromCategory(undefined), null);
check("rarity bands", rarityBands([0.4, 0.99, 1, 9.9, 10, 49.9, 50, 74.9]), {
  rarity: { ultraRare: 2, rare: 2, uncommon: 2, common: 2 },
  rarest: 0.4,
  mostCommon: 74.9,
});
check("no percentages → null extremes", rarityBands([]).rarest, null);

console.log("\nMicrosoft Store offer selection");
{
  const offer = (list: number, msrp: number, extra: object = {}) => ({
    Actions: ["Details", "Purchase"],
    Conditions: { StartDate: "2026-01-01T00:00:00Z", EndDate: "2799-01-01T00:00:00Z" },
    OrderManagementData: { Price: { CurrencyCode: "USD", ListPrice: list, MSRP: msrp } },
    ...extra,
  });
  const now = Date.parse("2026-10-19T00:00:00Z");
  check(
    "Game Pass member offer is ignored",
    microsoftPriceOf(
      { DisplaySkuAvailabilities: [{ Availabilities: [offer(59.99, 59.99), offer(0, 0, { RemediationRequired: true })] }] },
      now,
    ),
    { currency: "USD", price: 5999, initial: 5999, discount: 0 },
  );
  check(
    "live sale offer wins, discount from MSRP",
    microsoftPriceOf({ DisplaySkuAvailabilities: [{ Availabilities: [offer(59.99, 59.99), offer(29.99, 59.99)] }] }, now),
    { currency: "USD", price: 2999, initial: 5999, discount: 50 },
  );
  check(
    "expired sale is ignored",
    microsoftPriceOf(
      {
        DisplaySkuAvailabilities: [
          { Availabilities: [offer(59.99, 59.99), offer(9.99, 59.99, { Conditions: { EndDate: "2026-01-01T00:00:00Z" } })] },
        ],
      },
      now,
    )?.price,
    5999,
  );
  check(
    "trial SKU is skipped",
    microsoftPriceOf(
      { DisplaySkuAvailabilities: [{ Sku: { Properties: { IsTrial: true } }, Availabilities: [offer(0, 0)] }] },
      now,
    ),
    null,
  );
}

console.log("\nCron request budgets");
{
  const plan = (steamItems: number, microsoftItems: number, countries: number) =>
    planPriceRequests({ steamItems, microsoftItems, countries, budget: 45, steamBatch: 100, microsoftBatch: 20 });
  check("small set fits whole", plan(111, 48, 6), { steam: 2, microsoft: 3 });
  const big = plan(300, 200, 6);
  check("big set stays within 45 across 6 countries", (big.steam + big.microsoft) * 6 <= 45, true);
  check("big set still prices both stores", big.steam > 0 && big.microsoft > 0, true);
  const solo = plan(5000, 5000, 1);
  check("one country may use the whole budget", solo.steam + solo.microsoft, 45);
  check("nothing to price → no requests", plan(0, 0, 6), { steam: 0, microsoft: 0 });

  const ids = [1, 2, 3, 4, 5, 6, 7];
  check("slice covers everything when it fits", rotatingSlice(ids, 10, 3), ids);
  check("slice rotates by turn", [0, 1, 2].map((turn) => rotatingSlice(ids, 3, turn)), [[1, 2, 3], [4, 5, 6], [7, 1, 2]]);

  const pick = (due: number[], quiet: number[], run: number) =>
    choosePlayerSamples({ due, quiet, run, runsPerHour: 6, limit: 40, reserve: 8 });
  const many = Array.from({ length: 100 }, (_, i) => i + 1);
  const quiet = Array.from({ length: 60 }, (_, i) => 1000 + i);
  check("never more than 40 per run", pick(many, quiet, 0).length, 40);
  check("quiet apps keep their reserved slots", pick(many, quiet, 0).filter((id) => id >= 1000).length, 8);
  check("unused reserve goes to due apps", pick(many, [], 0).length, 40);
  const hour = [0, 1, 2, 3, 4, 5].flatMap((run) => pick([], quiet, run));
  check("each quiet app is tried once an hour", hour.length === quiet.length && new Set(hour).size === quiet.length, true);
}

console.log("\nStudio reliability");
check(
  "nothing observed → honest empty",
  reliabilityFromObservations([]),
  { tracked: 0, delayed: 0, avgDaysLate: null, since: null },
);
check(
  "delays are measured between upper bounds",
  reliabilityFromObservations([
    { gameId: 1, value: "2026-03-01", observedAt: Date.parse("2026-01-01T00:00:00Z") / 1000 },
    { gameId: 1, value: "2026-03-31", observedAt: Date.parse("2026-02-01T00:00:00Z") / 1000 },
    { gameId: 2, value: "Q4 2026", observedAt: Date.parse("2026-01-05T00:00:00Z") / 1000 },
    { gameId: 2, value: "2026-11-15", observedAt: Date.parse("2026-03-01T00:00:00Z") / 1000 },
    { gameId: 3, value: "2026-06-01", observedAt: Date.parse("2026-01-02T00:00:00Z") / 1000 },
    { gameId: 3, value: "2026-07-01", observedAt: Date.parse("2026-02-02T00:00:00Z") / 1000 },
    { gameId: 3, value: "Q4 2026", observedAt: Date.parse("2026-03-02T00:00:00Z") / 1000 },
  ]),
  // Game 1: +30 days. Game 2: narrowed inside its window, no delay.
  // Game 3: +30 then Jul 1 → Dec 31 (+183) = 213. Mean of 30 and 213 → 122.
  { tracked: 3, delayed: 2, avgDaysLate: 122, since: "2026-01-01" },
);

console.log("\nPatch notes (round 4)");
{
  // Shapes taken from real posts: CS2 (BBCode lists under "\[ MISC ]"),
  // Elden Ring ([h3] headings, "→" continuation lines, [i]Note:[/i]),
  // Hollow Knight (plain dash lines), and a list-less hotfix note.
  const cs2 =
    "[p]\\[ UI ][/p][p]Demo/Replay viewer improvements:[/p][list][*][p]Added a progress bar for demo/replay downloads[/p][/*][*][p]Camera controls now use click-and-drag scheme[/p][/*][/list][p][/p][p]\\[ MISC ][/p][list][*][p]Stability improvements for Vulkan renderer[/p][/*][/list]";
  check("CS2: bullets grouped under their nearest heading", parsePatchBody(cs2).sections, [
    { heading: "Demo/Replay viewer improvements", items: ["Added a progress bar for demo/replay downloads", "Camera controls now use click-and-drag scheme"] },
    { heading: "Misc", items: ["Stability improvements for Vulkan renderer"] },
  ]);
  const er =
    "[h2]Patch 1.17 has been released for ELDEN RING. This patch aims to bring support for the DLC and balance adjustments.[/h2][h3]Weapons [/h3][p]\n[/p][list][*][p] Smithscript Dagger / Rellana's Twin Blades\n→ Increased critical hit power.\n\n[/p][/*][*][p] Golem Fist\n→ Increased the range of the heavy attack.\n[i]Note: Items already found will not be changed.[/i][/p][/*][/list][h3][b]Bug Fixes[/b][/h3][list][*][p]Fixed a bug where the wrong affinity could be applied.[/p][/*][/list][h3][i]App Ver. 1.16.1[/i][/h3][p]Online play requires the player to apply this update.[/p]";
  check("ER: continuation lines join, notes dropped, empty headings vanish", parsePatchBody(er).sections, [
    { heading: "Weapons", items: ["Smithscript Dagger / Rellana's Twin Blades → Increased critical hit power.", "Golem Fist → Increased the range of the heavy attack."] },
    { heading: "Bug Fixes", items: ["Fixed a bug where the wrong affinity could be applied."] },
  ]);
  const hk = "- Added \"Borderless\" option to fullscreen\n- 64-bit is now required\n- Fixed issues with binding mouse buttons";
  check("HK: dash lines are bullets, default heading", parsePatchBody(hk), {
    sections: [{ heading: "Changes", items: ["Added \"Borderless\" option to fullscreen", "64-bit is now required", "Fixed issues with binding mouse buttons"] }],
    totalItems: 3,
    bulletCount: 3,
  });
  check(
    "list-less post: the developer's own sentences, minus sign-offs",
    parsePatchBody("[p]To address a security vulnerability, an update to some pre-order bonuses was distributed.[/p][p]Thank you for your understanding.[/p]").sections,
    [{ heading: "Notes", items: ["To address a security vulnerability, an update to some pre-order bonuses was distributed."] }],
  );
  check("struck-out text is dropped", parsePatchBody("[list][*][strike]Old plan[/strike]Applied the new save path[/*][/list]").sections[0].items, ["Applied the new save path"]);
  const long = parsePatchBody(`[list][*]${"word ".repeat(60)}[/*][/list]`).sections[0].items[0];
  check("bullets trimmed to ~160 chars at a word", [long.length <= 160, long.endsWith("…")], [true, true]);
  check("patchnotes tag counts", isPatchPost({ title: "Cross-platform Cloud Saves", tags: ["patchnotes"] }), true);
  check("version title counts", isPatchPost({ title: "Update notes for v1.5.78.11833" }), true);
  check("merch post doesn't", isPatchPost({ title: "New Elden Ring Mini Replicas Arrive" }), false);
  check(
    "title-only match needs a real list",
    condensePatchPost({ title: "Big update coming soon!", url: "https://store.steampowered.com/news/1", date: 1, contents: "[p]Stay tuned.[/p]" }),
    null,
  );
  const notes = patchNotesFrom([
    { gid: "1", title: "Rush Hour", url: "https://e.com/1", date: 300, contents: "[list][*]A[/*][/list]" },
    { gid: "2", title: "Counter-Strike 2 Update", tags: ["patchnotes"], url: "https://e.com/2", date: 200, contents: cs2 },
    { gid: "3", title: "Patch 1.0.1", url: "https://e.com/3", date: 100, contents: hk },
  ]);
  check("latest patch posts only, newest first", notes.map((n) => [n.title, n.totalItems, n.highlights.length]), [
    ["Counter-Strike 2 Update", 3, 3],
    ["Patch 1.0.1", 3, 3],
  ]);
  check(
    "highlights skip intro bullets",
    condensePatchPost({
      title: "Patch 2",
      tags: ["patchnotes"],
      url: "https://e.com/4",
      date: 1,
      contents: "[list][*]The following were changed:[/*][*]Fixed the camera clipping into walls[/*][/list]",
    })?.highlights,
    ["Fixed the camera clipping into walls"],
  );
}

console.log("\nHardware (round 4)");
{
  check("GPU: shouting + VRAM suffix", matchGpu("NVIDIA GEFORCE GTX 1060 3 GB"), { name: "NVIDIA GeForce GTX 1060", score: 40 });
  check("GPU: bare number after brand", matchGpu("Nvidia 2060 Super")?.name, "NVIDIA GeForce RTX 2060 SUPER");
  check("GPU: no space", matchGpu("rtx3060ti")?.name, "NVIDIA GeForce RTX 3060 Ti");
  check("GPU: AMD XTX", matchGpu("rx 7900xtx")?.name, "AMD Radeon RX 7900 XTX");
  check("GPU: Vega 56 is not an APU", matchGpu("AMD RADEON RX VEGA 56 8 GB")?.name, "AMD Radeon RX Vega 56");
  check("GPU: laptop parts scaled", matchGpu("GTX 1060M"), { name: "NVIDIA GeForce GTX 1060 Laptop", score: 32, laptop: true });
  check(
    "GPU: Intel iGPU vs Radeon HD",
    [matchGpu("Intel HD Graphics 4000")?.name, matchGpu("Radeon HD 7750 (1GB)")?.name],
    ["Intel HD 4000", "AMD Radeon HD 7750"],
  );
  check(
    "GPU: alternatives inherit their family",
    matchGpus("NVIDIA GeForce 8600/9600GT, ATI/AMD Radeon HD2600/3600").map((m) => m.name),
    ["NVIDIA GeForce 8600", "NVIDIA GeForce 9600", "AMD Radeon HD 2600"],
  );
  check(
    "GPU: Apple, Deck, Arc",
    [matchGpu("Apple M2 Pro")?.name, matchGpu("Steam Deck")?.name, matchGpu("INTEL Arc A750")?.name],
    ["Apple M2 Pro", "Steam Deck", "Intel Arc A750"],
  );
  check("GPU: prose matches nothing", matchGpu("Video card must be 1 GB or more and should be a DirectX 11-compatible"), null);
  check(
    "CPU: Intel gens (3, 4, 5 digits)",
    [matchCpu("Intel Core i5 750 or higher")?.score, matchCpu("INTEL CORE I5-8400")?.score, matchCpu("Core i7-12700")?.score],
    [2.6, 9.2, 30],
  );
  check("CPU: K and laptop suffixes", [matchCpu("i5-12600K")?.score, matchCpu("Intel Core i5-1135G7")?.name], [26.3, "Intel Core i5-1135G7"]);
  check("CPU: Ryzen shorthand and X3D", [matchCpu("AMD r5 3600")?.name, matchCpu("Ryzen 7 7800X3D")?.score], ["AMD Ryzen 5 3600", 35]);
  check(
    "CPU: FX, Core Ultra, prose",
    [matchCpu("AMD FX-4300")?.score, matchCpu("Intel Core Ultra 9 285K")?.name, matchCpu("Dual core from Intel or AMD at 2.8 GHz")],
    [3.5, "Intel Core Ultra 9 285K", null],
  );
  check(
    "suggestion lists are populated and unique",
    [GPU_SUGGESTIONS.length > 150, new Set(GPU_SUGGESTIONS).size === GPU_SUGGESTIONS.length, CPU_SUGGESTIONS.length > 80],
    [true, true, true],
  );

  const req = parsePcRequirements({
    minimum:
      '<strong>Minimum:</strong><br><ul class="bb_ul"><li>Requires a 64-bit processor and operating system<br></li><li><strong>OS:</strong> Windows 10<br></li><li><strong>Processor:</strong> INTEL CORE I5-8400 or AMD RYZEN 3 3300X<br></li><li><strong>Memory:</strong> 12 GB RAM<br></li><li><strong>Graphics:</strong> NVIDIA GEFORCE GTX 1060 3 GB or AMD RADEON RX 580 4 GB<br></li><li><strong>Storage:</strong> 60 GB available space<br></li><li><strong>Additional Notes:</strong> </li></ul>',
    recommended:
      '<strong>Recommended:</strong><br><ul class="bb_ul"><li><strong>OS:</strong> Windows 10/11<br></li><li><strong>Processor:</strong> INTEL CORE I7-8700K or AMD RYZEN 5 3600X<br></li><li><strong>Memory:</strong> 16 GB RAM<br></li><li><strong>Graphics:</strong> NVIDIA GEFORCE GTX 1070 8 GB or AMD RADEON RX VEGA 56 8 GB<br></li><li><strong>Storage:</strong> 60 GB available space</li></ul>',
  });
  const { raw, ...minimum } = req!.minimum!;
  check("requirements: Elden Ring minimum parsed", minimum, {
    cpu: "INTEL CORE I5-8400 or AMD RYZEN 3 3300X",
    gpu: "NVIDIA GEFORCE GTX 1060 3 GB or AMD RADEON RX 580 4 GB",
    ramGb: 12,
    vramGb: 3,
    storageGb: 60,
    os: "Windows 10",
  });
  check("requirements: raw keeps the text, drops template residue", raw.split("\n"), [
    "Requires a 64-bit processor and operating system",
    "OS: Windows 10",
    "Processor: INTEL CORE I5-8400 or AMD RYZEN 3 3300X",
    "Memory: 12 GB RAM",
    "Graphics: NVIDIA GEFORCE GTX 1060 3 GB or AMD RADEON RX 580 4 GB",
    "Storage: 60 GB available space",
  ]);
  check(
    "requirements: MB memory and [] pages",
    [parsePcRequirements({ minimum: "OS: XP<br>Memory: 512 MB RAM" })?.minimum?.ramGb, parsePcRequirements([])],
    [0.5, null],
  );

  check("verdict: great", evaluateHardware({ cpu: "Ryzen 5 5600X", gpu: "RTX 3060", ramGb: 16 }, req).kind, "great");
  check("verdict: ok names what falls short", evaluateHardware({ cpu: "i7-8700K", gpu: "GTX 1060 6GB", ramGb: 16 }, req), {
    kind: "ok",
    parts: [
      { part: "CPU", yours: "Intel Core i7-8700K", needed: "Intel Core i7-8700K", ok: true },
      { part: "GPU", yours: "NVIDIA GeForce GTX 1060", needed: "AMD Radeon RX Vega 56", ok: false },
      { part: "RAM", yours: "16 GB", needed: "16 GB", ok: true },
    ],
    summary: "Meets the minimum specs; your GPU is below recommended.",
    outlook: [
      { label: "1080p High", fps: 60, level: "lower" },
      { label: "1440p High", fps: 60, level: "no" },
      { label: "4K High", fps: 60, level: "no" },
    ],
    headline: "1080p High is a stretch; 1080p Medium should hold up.",
  });
  check(
    "verdict: below",
    evaluateHardware({ cpu: "i5-4460", gpu: "GTX 970", ramGb: 8 }, req).summary,
    "Your CPU, GPU and RAM fall short of the minimum specs.",
  );
  check("verdict: unknown part → unknown, never a guess", evaluateHardware({ cpu: "", gpu: "Mystery GPU", ramGb: 32 }, req).kind, "unknown");
  check("verdict: no requirements", evaluateHardware({ cpu: "i5-8400", gpu: "GTX 1060", ramGb: 16 }, null).kind, "unknown");
}

console.log("\nHardware (round 5: laptops, new names, detection strings, outlook)");
{
  check("GPU: laptop table", matchGpu("NVIDIA GeForce RTX 4060 Laptop GPU"), { name: "NVIDIA GeForce RTX 4060 Laptop", score: 105, laptop: true });
  check(
    "GPU: WebGL/ANGLE renderer strings",
    [
      matchGpu("ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)")?.name,
      matchGpu("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)")?.name,
      matchGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)")?.name,
      matchGpu("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)")?.name,
      matchGpu("AMD Custom GPU 0405 (radeonsi, vangogh, LLVM 15.0.7, DRM 3.54)")?.name,
    ],
    ["NVIDIA GeForce RTX 3070", "NVIDIA GeForce RTX 3060", "Apple M2 Pro", "Intel Iris Xe", "Steam Deck"],
  );
  check("GPU: integrated Radeon is not a laptop dGPU", matchGpu("AMD Radeon 780M"), { name: "AMD Radeon 780M", score: 27 });
  check(
    "GPU: AMD/Intel laptop suffixes, Max-Q, Strix Halo",
    [
      matchGpu("AMD Radeon RX 6800M")?.score,
      matchGpu("Radeon RX 7600M XT")?.name,
      matchGpu("Intel(R) Arc(TM) A770M Graphics")?.name,
      matchGpu("RTX 3070 Max-Q")?.score,
      matchGpu("AMD Radeon 8060S Graphics")?.score,
    ],
    [120, "AMD Radeon RX 7600M XT", "Intel Arc A770M", 89.3, 100],
  );
  check(
    "GPU: a laptop owner's bare card name means the laptop chip",
    [matchGpu("RTX 3060", { laptop: true })?.name, matchGpu("RTX 3060")?.name],
    ["NVIDIA GeForce RTX 3060 Laptop", "NVIDIA GeForce RTX 3060"],
  );
  check("VRAM suggestion differs on laptops", [typicalVram("RTX 3060"), typicalVram("RTX 3060 Laptop GPU"), typicalVram("Mystery")], [12, 6, null]);
  check(
    "CPU: Core Ultra series 1/2, Core 7, Ryzen AI, handhelds",
    [
      matchCpu("Intel Core Ultra 7 155H"),
      matchCpu("Intel Core Ultra 9 285K")?.score,
      matchCpu("Intel(R) Core(TM) Ultra 7 258V")?.score,
      matchCpu("Intel Core 7 150U")?.score,
      matchCpu("AMD Ryzen AI 9 HX 370 w/ Radeon 890M")?.name,
      matchCpu("AMD Ryzen AI Max+ 395")?.score,
      matchCpu("AMD Ryzen Z1 Extreme")?.score,
    ],
    [{ name: "Intel Core Ultra 7 155H", score: 25, laptop: true }, 64, 20, 16, "AMD Ryzen AI 9 HX 370", 55, 25],
  );
  check(
    "CPU: laptop suffixes flag the part",
    [matchCpu("i9-14900HX"), matchCpu("Ryzen 7 7840HS")?.score, matchCpu("Intel Xeon E3-1230 v3")?.score],
    [{ name: "Intel Core i9-14900HX", score: 55.1, laptop: true }, 28, 7],
  );

  const req5 = parsePcRequirements({
    minimum:
      "<ul><li><strong>Processor:</strong> INTEL CORE I5-8400</li><li><strong>Memory:</strong> 12 GB RAM</li><li><strong>Graphics:</strong> NVIDIA GEFORCE GTX 1060 3 GB</li><li><strong>Storage:</strong> 60 GB available space</li></ul>",
    recommended:
      "<ul><li><strong>Processor:</strong> INTEL CORE I7-8700K</li><li><strong>Memory:</strong> 16 GB RAM</li><li><strong>Graphics:</strong> NVIDIA GEFORCE GTX 1070 8 GB</li><li><strong>Storage:</strong> 60 GB SSD</li></ul>",
  });
  check(
    "outlook: resolution ladder headline",
    evaluateHardware({ cpu: "Ryzen 5 5600X", gpu: "RTX 3060", ramGb: 16 }, req5).headline,
    "Runs well at 1080p High; 1440p High is a stretch.",
  );
  check(
    "outlook: a known 1440p screen compares presets",
    evaluateHardware({ cpu: "Ryzen 5 5600X", gpu: "RTX 3060", ramGb: 16, display: { resolution: "1440p" } }, req5).outlook?.map((row) => [row.label, row.level]),
    [["1440p Medium", "great"], ["1440p High", "lower"], ["1440p Max", "lower"]],
  );
  const laptop = evaluateHardware(
    {
      cpu: "i7-12700H",
      gpu: "RTX 3060",
      ramGb: 16,
      formFactor: "laptop",
      vramGb: 6,
      storage: "hdd",
      freeStorageGb: 40,
      goal: { resolution: "1440p", fps: 60, quality: "max" },
    },
    req5,
  );
  check("laptop verdict: kind and part rows", [laptop.kind, laptop.parts.map((p) => [p.part, p.ok])], [
    "ok",
    [["CPU", true], ["GPU", true], ["RAM", true], ["VRAM", false], ["Storage", false]],
  ]);
  check("laptop verdict: reasons, most important first", laptop.reasons, [
    "Your goal (1440p Max, 60 fps) asks more than your graphics card has — lower the preset or use upscaling.",
    "6 GB of video memory is below the 8 GB recommended — keep textures at Medium.",
    "Needs 60 GB of space; you have 40 GB free.",
    "This game asks for an SSD — from a hard drive expect long loads and stutter.",
  ]);
}

console.log("\nRound 5: renderer strings, backlog forecast, player tags");
{
  check(
    "WebGL renderer → card name",
    [
      cleanRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)"),
      cleanRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)"),
      cleanRenderer("NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2"),
    ],
    ["NVIDIA GeForce RTX 3060", "Apple M2 Pro", "NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2"],
  );

  const DAY = 86_400_000;
  const now = Date.parse("2026-10-19T12:00:00Z");
  const base = { released: "2020-01-01", ownedOn: ["steam"] };
  const sample = [
    { ...base, gameId: 1, status: "played" as const, finishedAt: now - 180 * DAY },
    { ...base, gameId: 2, status: "played" as const, finishedAt: now - 90 * DAY },
    { ...base, gameId: 3, status: "played" as const, finishedAt: now - 10 * DAY },
    { ...base, gameId: 4, status: "none" as const },
    { ...base, gameId: 5, status: "want" as const },
    { ...base, gameId: 6, status: "want" as const, ownedOn: [] },
    { ...base, gameId: 7, status: "none" as const, released: "2027-03-01" },
  ];
  const ttb = { 1: { hastily: 15, normally: 20, completely: 40 }, 2: { hastily: 15, normally: 20, completely: 40 }, 3: { hastily: 15, normally: 20, completely: 40 }, 4: { hastily: 25, normally: 30, completely: 60 } };
  const forecast = backlogForecast(sample, ttb, {}, now);
  check("forecast: pace from finished games, owned released backlog only", forecast && { ...forecast, date: new Date(forecast.date).toISOString().slice(0, 10) }, {
    date: "2027-03-18",
    games: 2,
    hours: 50,
    estimatedGames: 1,
    typicalHours: 20,
    finished: 3,
    windowDays: 180,
    hoursPerMonth: 10,
    distant: false,
  });
  check("forecast: hidden with too little history", backlogForecast(sample.slice(1), ttb, {}, now), null);
  check("forecast: logged hours replace estimates", backlogForecast(sample, ttb, { 1: 40, 2: 40, 3: 40 }, now)?.hoursPerMonth, 20);

  check("tags: unknown slugs dropped, custom cleaned", parseMyTags({ tags: ["cozy", "nope", "cozy"], custom: ["  Play  with Sam!! ", "x"] }), { tags: ["cozy"], custom: ["Play with Sam"] });
  check("tags: too many refused", parseMyTags({ tags: ["cozy", "funny", "short", "long", "scary", "linear", "grindy"] }), null);
  check("tags: custom tag must say something", [cleanCustomTag("<script>"), cleanCustomTag("!")], ["script", null]);
  check("tags: top tags ignore zero and unknown", topPlayerTags({ cozy: 3, funny: 0, bogus: 9, "great-story": 5 }), [
    { tag: "great-story", count: 5 },
    { tag: "cozy", count: 3 },
  ]);
}

console.log("\nValue per hour (round 4)");
{
  const price = { price: 359900, currency: "INR", country: "IN" };
  check("₹3,599 over 50 h", valuePerHour(price, 50)?.perHour, 7198);
  check("free → 0", valuePerHour({ price: 0, currency: "XXX", country: "US" }, 20), { perHour: 0, formatted: "Free" });
  check("no hours → null", [valuePerHour(price, null), valuePerHour(price, 0)], [null, null]);
  check("formatted in the price's currency", valuePerHour({ price: 5999, currency: "USD", country: "US" }, 60)?.formatted, "$1.00");
}

console.log("\nReview velocity, Twitch, scores (round 4)");
{
  const launch = Date.parse("2026-10-01T00:00:00Z") / 1000;
  const h = (n: number) => launch + n * 3600;
  const samples = [
    { hour: h(-2), total: 0, positive: 0 },
    { hour: h(24), total: 400, positive: 300 },
    { hour: h(71), total: 1000, positive: 800 },
    { hour: h(120), total: 1500, positive: 1200 },
  ];
  const v = reviewVelocity(10, samples, launch, h(120));
  check("first72h brackets launch → +72h", v.first72h, { reviews: 1000, positivePct: 80 });
  check("perDay over the last 7 days of samples", v.perDay, Math.round((1500 / (122 / 24)) * 10) / 10);
  check("first tracked a week late → no launch figure", reviewVelocity(10, samples.slice(2), launch, h(120)).first72h, null);
  check("under 12 h of span → no rate", reviewVelocity(10, [samples[0]], launch, h(1)).perDay, null);
  check("empty → honest nulls", reviewVelocity(10, [], launch, h(1)), { appId: 10, points: [], first72h: null, perDay: null, since: null });

  const now = Date.parse("2026-10-20T00:00:00Z") / 1000;
  const old = now - 10 * 86400;
  const tw = downsampleTwitch(
    [
      { hour: old, viewers: 100, streams: 10 },
      { hour: old + 3600, viewers: 300, streams: 20 },
      { hour: now - 3600, viewers: 50, streams: 5 },
    ],
    now,
  );
  check("twitch: 6-hour means beyond a week, raw peaks", tw, {
    points: [
      { t: old - (old % 21600), viewers: 200, streams: 15 },
      { t: now - 3600, viewers: 50, streams: 5 },
    ],
    peak24h: 50,
    peakTracked: 300,
    since: "2026-10-10",
  });
  check("twitch: page sum", sumStreams([{ viewer_count: 10 }, { viewer_count: 5 }, {}]), { viewers: 15, streams: 3 });
  check(
    "scores: sorted, rounded",
    scoreTimeline([
      { observed_on: "2026-10-02", score: 81.26, count: 9 },
      { observed_on: "2026-10-01", score: 80, count: 5 },
    ]),
    {
      points: [
        { date: "2026-10-01", score: 80, count: 5 },
        { date: "2026-10-02", score: 81.3, count: 9 },
      ],
      since: "2026-10-01",
    },
  );
}

console.log("\nFirestore REST values and field paths");
{
  const data = { n: 3, x: 2.5, s: "Q4 2026", none: null, ok: true, list: [1, "a"], map: { "1792407600": 52845 } };
  const encoded = encodeFields(data);
  check("integers are integerValue strings", encoded.n, { integerValue: "3" });
  check("fractions are doubles", encoded.x, { doubleValue: 2.5 });
  check("non-finite numbers become null, never NaN", encodeFields({ v: Number.NaN }).v, { nullValue: null });
  check("round trip", decodeFields(encoded), data);
  check("plain identifiers stay bare", fieldPath("s", "updatedAt"), "s.updatedAt");
  check("numeric keys are quoted", fieldPath("s", 1792407600), "s.`1792407600`");
  check("negative ids are quoted", fieldPath("seen", -367520), "seen.`-367520`");
  check("spaces and dashes are quoted", fieldPath("123", "Q4 2026"), "`123`.`Q4 2026`");
  check("backticks are escaped", fieldPath("a`b"), "`a\\`b`");
}

console.log("\nFirestore stats documents");
check(
  "player samples sort by hour and drop junk",
  playerRows({ s: { "7200": 20, "3600": 10, bad: 5, "10800": -1, "14400": "x" } }),
  [{ hour: 3600, players: 10 }, { hour: 7200, players: 20 }],
);
check("missing document is an empty series", playerRows(null), []);
check(
  "twitch samples are [viewers, streams]",
  twitchRows({ s: { "3600": [120, 4], "7200": [5] } }),
  [{ hour: 3600, viewers: 120, streams: 4 }],
);
check(
  "score samples are keyed by ISO day",
  scoreRows({ s: { "2026-10-02": [81.3, 9], "2026-10-01": [80, 7], "oct-3": [1, 1] } }),
  [{ observed_on: "2026-10-01", score: 80, count: 7 }, { observed_on: "2026-10-02", score: 81.3, count: 9 }],
);
check(
  "price rows read one country's days and stores",
  priceRows({ IN: { "2026-10-19": { steam: ["INR", 99900, 99900, 0], humble: ["INR", 1, 1, 0], gog: ["USD", 2499, 4999, 50] } }, US: { "2026-10-19": { steam: ["USD", 5999, null, null] } } }, "IN"),
  [
    { store: "gog", currency: "USD", price: 2499, initial: 4999, discount: 50, observed_on: "2026-10-19" },
    { store: "steam", currency: "INR", price: 99900, initial: 99900, discount: 0, observed_on: "2026-10-19" },
  ],
);
check(
  "release observations sort by first sighting",
  observationRows({ "Q1 2027": 300, "2026-11-01": 100, "": 50, junk: "x" }),
  [{ value: "2026-11-01", observedAt: 100 }, { value: "Q1 2027", observedAt: 300 }],
);
check("release shards spread ids four ways", [1, 2, 3, 4].map(releaseShardPath), [
  "releaseHistory/s1",
  "releaseHistory/s2",
  "releaseHistory/s3",
  "releaseHistory/s0",
]);
check("prune deletes the day of hours that aged out", expiredHours(100 * 86_400, 30).slice(0, 2), [70 * 86_400, 70 * 86_400 - 3600]);
check("prune deletes the week of days that aged out", expiredDays("2026-10-19", 365)[0], "2025-10-19");

/**
 * A 2×1 RGBA PNG (one opaque red, one transparent pixel), built by hand with
 * a stored (uncompressed) deflate block so the decoder is tested against
 * bytes we fully control. The decoder doesn't verify chunk CRCs, so zeros do.
 */
async function pngChecks() {
  console.log("\nPNG decoding");
  const raw = [0, 255, 0, 0, 255, 0, 0, 0, 0]; // filter byte, then two RGBA pixels
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const zlib = [0x78, 0x01, 0x01, raw.length, 0, ~raw.length & 0xff, 0xff, ...raw, b >> 8, b & 0xff, a >> 8, a & 0xff];
  const chunk = (type: string, body: number[]) => [
    (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255,
    ...[...type].map((c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0,
  ];
  const png = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk("IHDR", [0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...chunk("IDAT", zlib),
    ...chunk("IEND", []),
  ]);
  const decoded = await decodePng(png);
  check("decodes a hand-built RGBA PNG", decoded && { w: decoded.width, h: decoded.height, px: [...decoded.data] }, {
    w: 2,
    h: 1,
    px: [255, 0, 0, 255, 0, 0, 0, 0],
  });
  check("rejects non-PNG bytes", await decodePng(new Uint8Array([1, 2, 3])), null);
}

/* ---------------------------------------------------------------------------
 * Round 5: external sources (GeForce NOW, anti-cheat, SteamSpy, PCGamingWiki,
 * speedrun.com, Thunderstore, Epic, GOG) and recommendations v2.
 * ------------------------------------------------------------------------ */

console.log("\nTitle matching");
check("normalises marks, punctuation and &", normaliseTitle("The Witcher® 3: Wild Hunt"), "the witcher 3 wild hunt");
check("drops apostrophes, spells out &", normaliseTitle("Assassin’s Creed & Friends"), "assassins creed and friends");
check("an edition suffix still matches", sameGameTitle("The Witcher 3: Wild Hunt — Remastered", "The Witcher 3: Wild Hunt"), "edition");
check("a sequel is a different game", sameGameTitle("Doom II", "Doom"), null);
check("case doesn't matter", sameGameTitle("DOOM", "Doom"), "exact");
check("Steam appid from a store URL", steamAppFromUrl("https://store.steampowered.com/app/1358020"), 1358020);
check("no appid from junk", steamAppFromUrl("https://example.com"), null);

console.log("\nGeForce NOW");
{
  const rows = compactGfn([
    { title: "Apex Legends", steamUrl: "https://store.steampowered.com/app/1172470", store: "Steam", isFullyOptimized: true, status: "AVAILABLE" },
    { title: "Apex Legends", steamUrl: "", store: "Origin", isFullyOptimized: false, status: "AVAILABLE" },
    { title: "Fortnite", steamUrl: "", store: "Epic", isFullyOptimized: false, status: "MAINTENANCE" },
    { title: "Weird", status: "SOMETHING" },
  ]);
  check("compacts only known statuses", rows.length, 3);
  const lookup = gfnLookup(rows);
  check("Steam match gathers same-titled store entries", gfnMembership(lookup, { steam: 1172470, name: null }), {
    available: true,
    store: "Steam",
    stores: ["Steam", "Origin"],
    optimized: true,
    status: "available",
    matchedBy: "steam",
  });
  check("title match reports maintenance honestly", gfnMembership(lookup, { steam: null, name: "FORTNITE" }), {
    available: false,
    store: "Epic",
    stores: ["Epic"],
    optimized: false,
    status: "maintenance",
    matchedBy: "title",
  });
  check("a same-titled row tied to another Steam app is ignored", gfnMembership(lookup, { steam: 999, name: "Apex Legends" }).stores, ["Origin"]);
  check("unknown game is not listed", gfnMembership(lookup, { steam: 1, name: "Nope" }), GFN_NOT_LISTED);
}

console.log("\nAnti-cheat");
{
  const rows = compactAntiCheat([
    { name: "Apex Legends", slug: "apex-legends", status: "Denied", anticheats: ["Easy Anti-Cheat"], native: false, storeIds: { steam: "1172470" }, dateChanged: "2024-10-31T18:29:00.000Z" },
    { name: "Halo", slug: "halo", status: "Supported", anticheats: [], native: false, storeIds: {} },
    { name: "Broken", slug: "b", status: "Unknown" },
  ]);
  check("keeps known statuses", rows.length, 2);
  check("matches by Steam appid", antiCheatFor(rows, { steam: 1172470, name: null }), {
    status: "denied",
    anticheats: ["Easy Anti-Cheat"],
    native: false,
    updated: "2024-10-31T18:29:00.000Z",
    url: "https://areweanticheatyet.com/game/apex-legends",
  });
  check("matches by title without a Steam id", antiCheatFor(rows, { steam: null, name: "HALO" })?.status, "supported");
  check("a contradicting Steam id blocks a title match", antiCheatFor(rows, { steam: 5, name: "Apex Legends" }), null);
}

console.log("\nSteamSpy");
check("owner brackets", parseOwners("20,000,000 .. 50,000,000"), { low: 20000000, high: 50000000 });
check("bad owner string", parseOwners(""), null);
check(
  "app details: tags by votes, zero playtime is null",
  parseSteamSpy({ appid: 10, name: "X", owners: "0 .. 20,000", ccu: 5, average_forever: 0, median_forever: 90, tags: { A: 3, B: 10 }, positive: 5, negative: 1 }, 10),
  {
    appId: 10,
    tags: [{ name: "B", votes: 10 }, { name: "A", votes: 3 }],
    owners: { low: 0, high: 20000 },
    ccu: 5,
    playtime: { average: null, median: 1.5, average2Weeks: null, median2Weeks: null },
    positive: 5,
    negative: 1,
  },
);
check("an app SteamSpy doesn't know", parseSteamSpy({ appid: 11, name: null }, 11), null);
check(
  "tag lists rank by confident approval, tiny apps dropped",
  topTaggedApps({ 1: { appid: 1, positive: 40, negative: 0 }, 2: { appid: 2, positive: 95000, negative: 5000 }, 3: { appid: 3, positive: 900, negative: 100 } }, 5),
  [2, 3],
);

console.log("\nPCGamingWiki");
{
  const wikitext = [
    "{{Infobox game",
    "|steam appid  = 504230",
    "}}",
    "{{Video",
    "|ultrawidescreen = hackable",
    "|hdr = false<ref>{{Refcheck|user=x}}</ref>",
    "|upscaling = true",
    "|upscaling tech = DLSS, FSR 2",
    "|color blind = unknown",
    "}}",
    "{{Input",
    "|key remap = true",
    "|controller support = true",
    "}}",
    "{{Audio",
    "|subtitles = true",
    "|closed captions = always on",
    "}}",
  ].join("\n");
  check("support values strip refs", pcgwSupport("true<ref>x</ref>"), "true");
  check("unknown is not a value", pcgwSupport("unknown"), null);
  check("parses Video/Input/Audio templates", parsePcgwWikitext(wikitext, "Celeste"), {
    page: "Celeste",
    url: "https://www.pcgamingwiki.com/wiki/Celeste",
    values: { ultrawide: "hackable", hdr: "false", upscaling: "true", keyRemap: "true", controller: "true", subtitles: "true", closedCaptions: "always on" },
    upscaling: ["DLSS", "FSR 2"],
  });
  check("reads the infobox Steam appids", pcgwSteamAppids(wikitext), [504230]);
}

console.log("\nspeedrun.com");
check("run time, minutes", formatRunTime(1488.843), "24:48.843");
check("run time, hours", formatRunTime(3723), "1:02:03");
check(
  "picks the exactly-named game",
  pickSpeedrunGame(
    { data: [{ id: "abc", names: { international: "Celeste 64" }, weblink: "u1" }, { id: "o1y9j9v6", names: { international: "Celeste", twitch: "Celeste" }, weblink: "https://www.speedrun.com/celeste" }] },
    "Celeste",
  ),
  { id: "o1y9j9v6", name: "Celeste", url: "https://www.speedrun.com/celeste" },
);
check(
  "records: main categories first, guests named, videos kept",
  parseSpeedrunRecords({
    data: [
      {
        weblink: "w1",
        category: { data: { name: "Glitchless", miscellaneous: true, weblink: "c1" } },
        players: { data: [{ rel: "guest", name: "Bob" }] },
        runs: [{ place: 1, run: { weblink: "r1", date: "2024-01-02", times: { primary_t: 100.5 }, players: [{ rel: "guest", name: "Bob" }], videos: { links: [{ uri: "https://youtu.be/x" }] } } }],
      },
      {
        weblink: "w2",
        category: { data: { name: "Any%", miscellaneous: false, weblink: "c2" } },
        players: { data: [{ id: "u1", names: { international: "Ann" }, weblink: "https://www.speedrun.com/users/Ann" }] },
        runs: [{ place: 1, run: { weblink: "r2", date: null, times: { primary_t: 1488.843 }, players: [{ rel: "user", id: "u1" }], videos: null } }],
      },
    ],
  }),
  [
    { category: "Any%", url: "c2", seconds: 1488.843, time: "24:48.843", date: null, runners: [{ name: "Ann", url: "https://www.speedrun.com/users/Ann" }], runUrl: "r2", video: null, misc: false },
    { category: "Glitchless", url: "c1", seconds: 100.5, time: "1:40.500", date: "2024-01-02", runners: [{ name: "Bob", url: null }], runUrl: "r1", video: "https://youtu.be/x", misc: true },
  ],
);

console.log("\nThunderstore");
{
  const rows = compactCommunities({ results: [{ identifier: "valheim", name: "Valheim" }, { identifier: "Bad Id", name: "x" }] });
  check("compacts valid communities", rows, [["valheim", "valheim", "Valheim"]]);
  check("matches a community by exact title", matchCommunity(rows, "VALHEIM")?.[0], "valheim");
  check(
    "listing keeps live packages and the pinned flag",
    parseThunderstoreListing(
      {
        count: 7860,
        results: [
          { name: "BepInExPack_Valheim", namespace: "denikson", download_count: 10, rating_count: 2, is_pinned: true, categories: [{ name: "Tools" }], icon_url: "https://x/i.png", last_updated: "2026-01-01", description: "d" },
          { name: "Nsfw", namespace: "n", is_nsfw: true },
        ],
      },
      "valheim",
    ),
    {
      total: 7860,
      top: [
        { name: "BepInExPack Valheim", owner: "denikson", description: "d", downloads: 10, rating: 2, icon: "https://x/i.png", url: "https://thunderstore.io/c/valheim/p/denikson/BepInExPack_Valheim/", updated: "2026-01-01", categories: ["Tools"], pinned: true },
      ],
    },
  );
}

console.log("\nEpic free games");
{
  const promo = (start: string, end: string, pct: number) => [{ promotionalOffers: [{ startDate: start, endDate: end, discountSetting: { discountPercentage: pct } }] }];
  const feed = {
    data: {
      Catalog: {
        searchStore: {
          elements: [
            {
              title: "Bad Cheese",
              id: "a1",
              offerMappings: [{ pageSlug: "bad-cheese-4256d9", pageType: "productHome" }],
              keyImages: [{ type: "OfferImageTall", url: "https://cdn1.epicgames.com/t.png" }, { type: "OfferImageWide", url: "https://cdn1.epicgames.com/w.png" }],
              price: { totalPrice: { fmtPrice: { originalPrice: "₹469.00" } } },
              promotions: { promotionalOffers: promo("2026-10-15T15:00:00.000Z", "2026-10-22T15:00:00.000Z", 0), upcomingPromotionalOffers: [] },
            },
            { title: "On Sale", id: "b1", promotions: { promotionalOffers: promo("2026-10-15T15:00:00.000Z", "2026-10-22T15:00:00.000Z", 40) } },
            { title: "Sker Ritual", id: "c1", productSlug: "sker-ritual/home", keyImages: [], promotions: { promotionalOffers: [], upcomingPromotionalOffers: promo("2026-10-22T15:00:00.000Z", "2026-10-29T15:00:00.000Z", 0) } },
            { title: "No Promo", id: "d1", promotions: null },
          ],
        },
      },
    },
  };
  const parsed = parseEpicPromotions(feed, Date.parse("2026-10-19T12:00:00Z"));
  check("only 100%-off promotions, current vs upcoming", parsed.map((p) => [p.title, p.when, p.url]), [
    ["Bad Cheese", "current", "https://store.epicgames.com/en-US/p/bad-cheese-4256d9"],
    ["Sker Ritual", "upcoming", "https://store.epicgames.com/en-US/p/sker-ritual"],
  ]);
  check("art and normal price", [parsed[0].image, parsed[0].imageWide, parsed[0].originalPrice, parsed[1].image], [
    "https://cdn1.epicgames.com/t.png",
    "https://cdn1.epicgames.com/w.png",
    "₹469.00",
    null,
  ]);
  check("an expired window is not current", parseEpicPromotions(feed, Date.parse("2026-11-01T00:00:00Z")).length, 0);
}

console.log("\nGOG");
check(
  "edition match, DLC never",
  pickGogProduct(
    {
      products: [
        { id: "1", title: "The Witcher 3: Wild Hunt — Songs of the Past", storeLink: "https://www.gog.com/en/game/x", productType: "pack" },
        { id: "1640424747", title: "The Witcher 3: Wild Hunt — Remastered", storeLink: "https://www.gog.com/en/game/the_witcher_3", productType: "pack" },
        { id: "2", title: "The Witcher 3: Wild Hunt", storeLink: "https://www.gog.com/en/game/dlc", productType: "dlc" },
      ],
    },
    "The Witcher 3: Wild Hunt",
  ),
  { id: "1640424747", title: "The Witcher 3: Wild Hunt — Remastered", url: "https://www.gog.com/en/game/the_witcher_3" },
);
check(
  "the country's default currency is the first price",
  parseGogPrices({ _embedded: { prices: [{ currency: { code: "GBP" }, basePrice: "3999 GBP", finalPrice: "1999 GBP" }, { currency: { code: "USD" }, basePrice: "1 USD", finalPrice: "1 USD" }] } }),
  { currency: "GBP", price: 1999, initial: 3999, discount: 50 },
);
check("no price when GOG doesn't sell it", parseGogPrices({ message: "Product not found" }), null);

console.log("\nRecommendation maths");
{
  const k = (type: Parameters<typeof featureKey>[0], id: number) => featureKey(type, id);
  check("cosine of parallel vectors", cosine(new Map([[1, 2]]), new Map([[1, 5]])), 1);
  check("cosine of orthogonal vectors", cosine(new Map([[1, 1]]), new Map([[2, 1]])), 0);
  check("cosine with an empty vector", cosine(new Map(), new Map([[2, 1]])), 0);
  check("Bayesian average shrinks a thin score", Math.round(bayesianAverage(98, 3, 70, 6) * 100) / 100, 79.33);
  check("Bayesian average without votes is the prior", bayesianAverage(null, 0, 70, 6), 70);
  check("unrated quality sits at the prior", qualityPrior({ critic: null, criticCount: 0, user: null, userCount: 0 }), 0.375);
  check("popularity saturates at ~5k ratings", [popularity(0, 0), popularity(5000, 0)], [0, 1]);
  check("recency half-life", [recencyDecay(240, 240), recencyDecay(0, 240)], [0.5, 1]);
  check("length fit: same length, double length, unknown", [lengthFit(30, 30), Math.round((lengthFit(60, 30) ?? 0) * 100) / 100, lengthFit(null, 30)], [1, 0.44, null]);
  check("idf: rare vs universal", [Math.round(idf(0, 9) * 1000) / 1000, idf(9, 9)], [3.303, 1]);
  check("feature keys round-trip", [featureType(k("keyword", 42)), featureId(k("keyword", 42))], ["keyword", 42]);
  const vector = tfidfVector([k("theme", 1), k("genre", 5)], new Map([[k("theme", 1), 1], [k("genre", 5), 9]]), 9);
  check("tf-idf favours the rare theme over the common genre", [vector.get(k("theme", 1)), vector.get(k("genre", 5))].map((v) => Math.round((v ?? 0) * 1000) / 1000), [0.975, 0.224]);
  check("taste vector subtracts disliked seeds", [...tasteVector([{ vector: new Map([[1, 1]]), weight: 2 }, { vector: new Map([[2, 1]]), weight: -1 }])], [[1, 2], [2, -1]]);
  check("shared features skip negatives", sharedFeatures(new Map([[1, 0.5], [2, -0.5], [3, 0.2]]), new Map([[1, 0.5], [2, 0.5], [3, 0.9]]), 2), [1, 3]);
  // The dense (typed-array) path the engine uses must agree with the Map reference.
  const lists = [
    [k("genre", 1), k("theme", 2), k("keyword", 7)],
    [k("genre", 1), k("keyword", 9)],
    [k("theme", 2), k("keyword", 7), k("keyword", 9)],
  ];
  const corpus = buildCorpus(lists);
  const df = documentFrequency(lists);
  const ref = lists.map((keys) => tfidfVector(keys, df, lists.length));
  const refUser = normalise(tasteVector([{ vector: ref[0], weight: 2 }, { vector: ref[1], weight: -1 }]));
  const denseUser = denseTaste([{ doc: corpus.docs[0], weight: 2 }, { doc: corpus.docs[1], weight: -1 }], corpus.vocab.length);
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  check("dense taste cosine equals the Map reference", round(denseDot(corpus.docs[2], denseUser)), round(cosine(refUser, ref[2])));
  check("dense unit vector is a self-cosine of 1", round(denseDot(corpus.docs[0], denseUnit(corpus.docs[0], corpus.vocab.length))), 1);
  check("sorted-merge dot of a gist with itself is 1", round(sortedDot(diversityOf(corpus.docs[2], 2), diversityOf(corpus.docs[2], 2))), 1);
  check("gist keeps the strongest features", diversityOf(corpus.docs[0], 2).idx.length, 2);
  const items = [{ id: 1, score: 0.9 }, { id: 2, score: 0.85 }, { id: 3, score: 0.5 }];
  const sim = (a: { id: number }, b: { id: number }) => (a.id + b.id === 3 ? 1 : 0);
  check("MMR skips a near-duplicate", mmr(items, 2, 0.5, sim).map((i) => i.id), [1, 3]);
  check("MMR with λ = 1 is plain ranking", mmr(items, 2, 1, sim).map((i) => i.id), [1, 2]);
  const base = { taste: 0.8, quality: 0.5, popularity: 0.5, platform: null, length: null, seedSimilar: 0, sameSeries: false, sameDeveloper: false, steamTag: false, ignored: false };
  check("score: weighted blend", scoreCandidate(base), 0.61);
  check("score: ignored before is penalised", scoreCandidate({ ...base, ignored: true }), 0.49);
  check("score: disliked-looking sinks to zero", scoreCandidate({ ...base, taste: -0.5 }), 0);
}

console.log("\nTaste profile v2");
{
  const now = Date.UTC(2026, 9, 19);
  const day = 86_400_000;
  const profile = buildRecsProfile(
    [
      { gameId: 1, status: "played", addedAt: now, finishedAt: now, playtime: 20 },
      { gameId: 2, status: "want", addedAt: now - 240 * day },
      { gameId: 3, status: "played", addedAt: now, finishedAt: now, playtime: 40, ownedOn: ["steam"], platform: "switch" },
      { gameId: -5, status: "played", addedAt: now },
      { gameId: 4, status: "none", addedAt: now },
    ],
    [{ gameId: 3, rating: 2 }, { gameId: 9, rating: 10 }],
    [{ gameId: 7, kind: "down", at: 1 }, { gameId: 8, kind: "ignored", at: 2 }, { gameId: 10, kind: "up", at: 3 }],
    { ownedPlatforms: ["ps5", "steam"], subscriptions: ["geforce-now", "netflix-games"], now },
  );
  check("profile from library, reviews and feedback", profile, {
    v: 2,
    seeds: [{ id: 1, w: 3 }, { id: 9, w: 2.25 }, { id: 10, w: 1.5 }, { id: 2, w: 0.6 }, { id: 3, w: -2.47 }, { id: 7, w: -1.5 }],
    exclude: [1, 3, 2],
    dismissed: [7],
    ignored: [8],
    platforms: ["pc", "ps5", "switch"],
    services: ["geforce-now"],
    lengthHours: 20,
  });
  check("enough taste to personalise", hasEnoughTaste(profile), true);
  check("a valid profile survives server validation", parseRecsProfile(JSON.parse(JSON.stringify(profile))), profile);
  check("wrong version rejected", parseRecsProfile({ v: 1 }), "v must be 2");
  check("out-of-range weight rejected", parseRecsProfile({ v: 2, seeds: [{ id: 1, w: 5 }] }), "seed weights must be within -3…3");
  check("rating multipliers", [ratingMultiplier(10), ratingMultiplier(5), ratingMultiplier(1)], [1.5, 0.2, -1]);
  check("owned platform slugs", ["steam", "ps5", "playstation", "Xbox Series X", "nonsense"].map(normaliseOwnedPlatform), ["pc", "ps5", "playstation", "xbox", null]);
}

console.log("\nSteam sale calendar (round 6)");
{
  check("estimated pattern: Summer is the last Thursday of June", estimatedSteamSales(2025).find((s) => s.name === "Summer Sale")?.start, "2025-06-26");
  check("estimated pattern: Winter is the third Thursday of December", estimatedSteamSales(2025).find((s) => s.name === "Winter Sale")?.start, "2025-12-18");
  check("announced dates win over the pattern", steamSalesFor(2025).find((s) => s.name === "Spring Sale"), {
    name: "Spring Sale",
    start: "2025-03-13",
    end: "2025-03-20",
    estimated: false,
  });
  check("next after mid-October 2026 is the (estimated) Winter Sale", nextSteamSale("2026-10-20"), {
    name: "Winter Sale",
    start: "2026-12-17",
    end: "2027-01-04",
    estimated: true,
    daysUntil: 58,
    live: false,
  });
  check("a running sale is live, with 0 days to wait", [nextSteamSale("2026-06-30").name, nextSteamSale("2026-06-30").live, nextSteamSale("2026-06-30").daysUntil], ["Summer Sale", true, 0]);
  check("the Winter Sale runs over New Year", [nextSteamSale("2027-01-02").name, nextSteamSale("2027-01-02").live], ["Winter Sale", true]);
  check("January looks ahead to next Spring", [nextSteamSale("2027-01-10").start, nextSteamSale("2027-01-10").estimated], ["2027-03-18", true]);
  check("an announced sale counts down exactly", [nextSteamSale("2025-09-01").name, nextSteamSale("2025-09-01").daysUntil, nextSteamSale("2025-09-01").estimated], ["Autumn Sale", 28, false]);
  check("sale sentence: estimates are hedged", saleSentence(nextSteamSale("2026-10-20")), "The Steam Winter Sale usually starts in ~58 days (expected around Dec 17).");
  check("sale sentence: announced dates are stated", saleSentence(nextSteamSale("2026-06-01")), "The Steam Summer Sale starts in 24 days, on Jun 25.");
}

console.log("\nBuying tip (round 6)");
{
  const base = {
    today: "2026-10-20",
    current: { price: 999, initial: 3999, discount: 75, store: "steam" as const },
    history: { kind: "buy" as const, reason: "Lowest price we've seen since Mar.", days: 40, lowest: 999 },
    deepestDiscount: 75,
    released: "2015-05-19",
    publishers: ["CD Projekt"],
    onSteam: true,
  };
  const deep = buyingTip(base)!;
  check("record discount + our lowest: buy, high confidence", [deep.kind, deep.confidence], ["buy", "high"]);
  check("its summary is the heaviest reason", deep.summary, "75% off — about as deep as it has ever gone (record: 75% off, US stores).");
  check("a sale two months out is context, not a reason to wait", deep.reasons.at(-1), { lean: "info", text: "The Steam Winter Sale usually starts in ~58 days (expected around Dec 17)." });

  const fullPrice = { ...base, current: { price: 5999, initial: 5999, discount: 0, store: "steam" as const }, history: { kind: "fair" as const, reason: "No big sales in the last 120 days.", days: 40, lowest: 2999 }, deepestDiscount: 80, publishers: ["Ubisoft"] };
  const soonSale = buyingTip({ ...fullPrice, today: "2026-11-27" })!;
  check("full price, 80% off before, sale in 20 days: wait for the sale", [soonSale.kind, soonSale.confidence, soonSale.summary], [
    "wait",
    "high",
    "The Steam Winter Sale usually starts in ~20 days (expected around Dec 17).",
  ]);
  const later = buyingTip(fullPrice)!;
  check("same game, sale 58 days away: likely cheaper soon", later.kind, "soon");
  check(
    "reasons say why, winning side first",
    later.reasons.map((r) => r.lean),
    ["wait", "wait", "wait", "wait"],
  );

  const nintendo = buyingTip({
    today: "2026-10-20",
    current: { price: 5999, initial: 5999, discount: 0, store: "microsoft" },
    history: { kind: "unknown", reason: "Tracking since Oct 18 — not enough history yet.", days: 3, lowest: 5999 },
    deepestDiscount: null,
    released: "2023-05-12",
    publishers: ["Nintendo"],
    onSteam: false,
  })!;
  check("a publisher that rarely discounts leans buy, but thin data caps confidence", [nintendo.kind, nintendo.confidence, nintendo.sale], ["buy", "medium", null]);
  check("publisher habit matching", [publisherHabit(["Nintendo"])?.habit, publisherHabit(["Electronic Arts"])?.habit, publisherHabit(["Annapurna Interactive"])], ["rare", "frequent", null]);
  check(
    "a regional co-publisher doesn't lend its habit",
    [publisherHabit(["WB Games", "CD Projekt", "Bandai Namco Entertainment"]), publisherHabit(["Nintendo", "The Pokémon Company"])?.habit],
    [null, "rare"],
  );

  const nothing = buyingTip({ ...base, current: { price: 1999, initial: 1999, discount: 0, store: "gog" }, history: { kind: "unknown", reason: "", days: 2, lowest: null }, deepestDiscount: null, released: null, publishers: [], onSteam: false })!;
  check("no signals: a low-confidence buy that says so", [nothing.kind, nothing.confidence, nothing.reasons.at(-1)?.lean], ["buy", "low", "info"]);
  check("free to play: no tip", buyingTip({ ...base, current: { price: 0, initial: 0, discount: 0, store: "steam" } }), null);
  check("not out yet: no tip", buyingTip({ ...base, released: "2027-02-01" }), null);
  check("no price: no tip", buyingTip({ ...base, current: null }), null);
}

console.log("\nScore spread (round 6)");
{
  const witcher = scoreSpread({
    critic: { score: 92, count: 26 },
    members: { score: 94, count: 5501 },
    steam: { percent: 87, total: 989044 },
    recent: { percent: 95, total: 8201 },
  })!;
  check("every figure with enough votes is drawn", witcher.marks.map((m) => [m.key, m.value]), [["critics", 92], ["members", 94], ["steam", 87], ["recent", 95]]);
  check("Steam speaks for players; 5 points is agreement", [witcher.gap?.players, witcher.gap?.points, witcher.gap?.tone, witcher.gap?.headline], ["steam", -5, "agree", "Critics and players broadly agree"]);
  check("recent reviews warmer by 8+ get a sentence", witcher.trend?.text, "Recent Steam reviews are warmer: 95% positive in the last 30 days, against 87% all-time.");
  check(
    "a 30-point gap is a split",
    scoreSpread({ critic: { score: 60, count: 10 }, members: null, steam: { percent: 90, total: 5000 }, recent: null })?.gap?.headline,
    "Players like it far more than critics",
  );
  check(
    "IGDB members judge tighter bands",
    scoreSpread({ critic: { score: 80, count: 12 }, members: { score: 70, count: 50 }, steam: null, recent: null })?.gap,
    { players: "members", points: -10, tone: "mild", headline: "Critics like it a little more than players" },
  );
  check("tiny samples are dropped, and one figure isn't a spread", scoreSpread({ critic: { score: 85, count: 2 }, members: { score: 80, count: 5 }, steam: { percent: 70, total: 900 }, recent: null }), null);
  check("recent without all-time isn't drawn", scoreSpread({ critic: { score: 85, count: 20 }, members: null, steam: null, recent: { percent: 40, total: 300 } }), null);
  check("histogram rows sum to a 30-day share", recentFromHistogram([{ recommendations_up: 167, recommendations_down: 7 }, { recommendations_up: 156, recommendations_down: 6 }]), {
    positive: 323,
    negative: 13,
    total: 336,
    percent: 96,
  });
  check("a quiet month isn't a figure", recentFromHistogram([{ recommendations_up: 9, recommendations_down: 1 }]), null);
  check("junk rows are ignored", recentFromHistogram([{ recommendations_up: "x", recommendations_down: -4 }, { recommendations_up: 30 }]), { positive: 30, negative: 0, total: 30, percent: 100 });
}

console.log("\nRelease-date confidence (round 6)");
{
  const day = (date: string, extra: Partial<Parameters<typeof releaseConfidence>[0]> = {}) =>
    releaseConfidence({ today: "2026-10-20", precision: "day", date, delays: 0, studio: null, ...extra });
  check("an exact day a month out: very likely", [day("2026-11-19")?.score, day("2026-11-19")?.label], [88, "Very likely"]);
  check("its reasons carry their effects", day("2026-11-19")?.reasons, [
    { effect: 0, text: "It has an exact release day." },
    { effect: 10, text: "Close: 30 days away." },
  ]);
  check("days away: as good as out", day("2026-10-25")?.score, 94);
  check("each delay costs 7 points (capped at 21)", [day("2027-05-01", { delays: 1 })?.score, day("2027-05-01", { delays: 5 })?.score], [65, 51]);
  check(
    "a bare year more than a year out is shaky",
    releaseConfidence({ today: "2026-10-20", precision: "year", date: "2027-12-31", delays: 0, studio: null })?.label,
    "Shaky",
  );
  const shaky = releaseConfidence({
    today: "2026-10-20",
    precision: "quarter",
    date: "2027-03-31",
    delays: 2,
    studio: { name: "Studio X", tracked: 10, delayed: 6 },
    publishers: ["Square Enix"],
  })!;
  check("delays, a slipping studio and a fiscal-year-end window add up", [shaky.score, shaky.label, shaky.reasons.map((r) => r.effect)], [21, "Shaky", [0, 0, -14, -11, -4]]);
  check(
    "a reliable studio adds a little",
    releaseConfidence({ today: "2026-10-20", precision: "month", date: "2026-12-31", delays: 0, studio: { name: "Studio Y", tracked: 8, delayed: 0 } })?.score,
    73,
  );
  check(
    "a thin studio record is ignored",
    releaseConfidence({ today: "2026-10-20", precision: "month", date: "2026-12-31", delays: 0, studio: { name: "Studio Z", tracked: 2, delayed: 2 } })?.score,
    65,
  );
  check("a rumoured game loses 15", day("2027-02-01", { status: "rumored" })?.score, 63);
  check("a big, firmly dated launch adds 3", day("2027-02-01", { follows: 900 })?.score, 81);
  check("today or past: nothing to judge", [day("2026-10-20"), day("2026-09-01")], [null, null]);
  check("labels by band", [confidenceLabel(75).label, confidenceLabel(74).label, confidenceLabel(49).label], ["Very likely", "Could slip", "Shaky"]);
  check(
    "a studio record counts after 3 games and 30 days of watching",
    [
      usableStudioRecord({ tracked: 9, delayed: 0, since: "2026-10-19" }, "2026-10-20"),
      usableStudioRecord({ tracked: 2, delayed: 0, since: "2026-01-01" }, "2026-10-20"),
      usableStudioRecord({ tracked: 9, delayed: 2, since: "2026-09-01" }, "2026-10-20"),
      usableStudioRecord(null, "2026-10-20"),
    ],
    [null, null, { tracked: 9, delayed: 2 }, null],
  );
}

console.log("\nStudio record (round 6)");
{
  const now = Date.UTC(2026, 9, 20) / 1000;
  const t = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
  const summary = summariseStudioGames(
    [
      { id: 1, name: "The Witcher 3", slug: "the-witcher-3", aggregated_rating: 91.7, aggregated_rating_count: 26, first_release_date: t("2015-05-19") },
      { id: 2, name: "Cyberpunk 2077", slug: "cyberpunk-2077", aggregated_rating: 75.2, aggregated_rating_count: 21, first_release_date: t("2020-12-10") },
      { id: 3, name: "Battle Arena", slug: "battle-arena", aggregated_rating: 60, aggregated_rating_count: 1, first_release_date: t("2015-01-22") },
      { id: 4, name: "The Witcher IV", slug: "the-witcher-iv", first_release_date: t("2028-12-31") },
      { id: 5, name: "Rise of the White Wolf", slug: "rotww", game_status: 6 },
      { id: 6, name: "Unannounced", slug: "unannounced" },
    ],
    now,
  );
  check("released, upcoming (incl. TBA), cancelled left out", [summary.released, summary.upcoming, summary.ids], [3, 2, [1, 2, 3, 4, 6]]);
  check("critic mean needs two reviews per game", [summary.scored, summary.avgCritic], [2, 83]);
  check("best rated", summary.best, { name: "The Witcher 3", slug: "the-witcher-3", score: 92 });
  check("no rated games: no average, no best", summariseStudioGames([{ id: 9, first_release_date: t("2020-01-01") }], now).avgCritic, null);
}

console.log("\nUpdates timeline (round 6)");
{
  const feed = steamFeedFrom(
    [
      { gid: "a", title: "Halloween event is live!", url: "https://store.steampowered.com/news/a", date: 400, contents: "[h2]Spooky[/h2][p]Join us for [b]double XP[/b] all week.[/p][img]{STEAM_CLAN_IMAGE}/x.png[/img]<script>alert(1)</script>" },
      { gid: "b", title: "Patch 1.2", tags: ["patchnotes"], url: "https://store.steampowered.com/news/b", date: 300, contents: "[list][*]Fixed the camera clipping into walls[/*][*]Improved loading times[/*][/list]" },
      { gid: "b", title: "Patch 1.2 (dupe)", url: "https://store.steampowered.com/news/b", date: 300 },
      { gid: "c", title: "Roadmap", url: "javascript:alert(1)", date: 200, contents: "Soon." },
    ],
    5,
    12,
  );
  check("patches condensed from the same pass", feed.patches.map((n) => [n.title, n.totalItems]), [["Patch 1.2", 2]]);
  check("every post, newest first, deduped, unsafe links dropped", feed.posts.map((p) => [p.title, p.patch]), [["Halloween event is live!", false], ["Patch 1.2", true]]);
  check("excerpts are plain text: no markup, media or script", feed.posts[0].excerpt, "Spooky Join us for double XP all week.");
  check("escaped section labels lose their backslash", stripNewsMarkup("[p]\\[ UI ][/p][list][*]Added a progress bar[/*][/list]"), "[ UI ] • Added a progress bar");
}

pngChecks().then(() => {
  console.log(
    failures === 0
      ? "\nAll provider self-checks passed.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
});
