import type { WatchlistEntry, WatchStatus } from "@/lib/firebase/db";
import type { Ref } from "./types";
import { releaseState, type ReleaseState } from "./release-state";
import { ownershipPlatform, playingLocation } from "./stores-catalog";

export interface RankedStat {
  key: string;
  label: string;
  value: number;
}

export interface TimelineStat {
  key: string;
  label: string;
  added: number;
  completed: number;
}

export interface LibraryStats {
  games: WatchlistEntry[];
  uniqueGames: number;
  ownedGames: number;
  savedGames: number;
  platformCopies: number;
  extraCopies: number;
  followedGames: number;
  subscriptionGames: number;
  subscriptionAccesses: number;
  accessibleGames: number;
  unplayedOwned: number;
  upcomingFollowed: number;
  wanted: number;
  playing: number;
  played: number;
  releasedCompleted: number;
  noStatus: number;
  releasedGames: number;
  unreleasedGames: number;
  datedUpcomingGames: number;
  tbaGames: number;
  unknownReleaseGames: number;
  statusCoverage: number;
  accessCoverage: number;
  criticCoverage: number;
  completionRate: number;
  completionBase: number;
  completedHours: number;
  backlogHours: number;
  averageCritic: number | null;
  highScorers: number;
  completedLast90Days: number;
  completionStreakMonths: number;
  averageDaysToFinish: number | null;
  collectionAgeDays: number;
  platforms: RankedStat[];
  subscriptions: RankedStat[];
  playedPlatforms: RankedStat[];
  genres: RankedStat[];
  decades: RankedStat[];
  scoreBands: RankedStat[];
  timeline: TimelineStat[];
  earliestAddedAt: number | null;
}

/**
 * Firestore normally guarantees one document per game id. The extra merge is
 * intentional defence against imported legacy data and makes every headline
 * metric game-based: owning Steam + PlayStation copies still counts as one
 * owned game, while `platformCopies` remains available as a separate fact.
 */
export function dedupeLibrary(entries: WatchlistEntry[]): WatchlistEntry[] {
  const merged = new Map<number, WatchlistEntry>();
  for (const entry of entries) {
    const previous = merged.get(entry.gameId);
    if (!previous) {
      merged.set(entry.gameId, {
        ...entry,
        ownedOn: [...new Set(entry.ownedOn ?? [])],
        subscriptionAccess: [...new Map((entry.subscriptionAccess ?? []).map((item) => [`${item.service}:${item.platform}`, item])).values()],
      });
      continue;
    }
    const newer = entry.addedAt >= previous.addedAt ? entry : previous;
    merged.set(entry.gameId, {
      ...newer,
      ownedOn: [...new Set([...(previous.ownedOn ?? []), ...(entry.ownedOn ?? [])])],
      subscriptionAccess: [...new Map([...(previous.subscriptionAccess ?? []), ...(entry.subscriptionAccess ?? [])].map((item) => [`${item.service}:${item.platform}`, item])).values()],
      followedReleases: [...new Map([...(previous.followedReleases ?? []), ...(entry.followedReleases ?? [])].map((item) => [item.gameId, item])).values()],
      following: previous.following || entry.following,
      watchlisted: previous.watchlisted || entry.watchlisted,
      genreIds: [...new Set([...(previous.genreIds ?? []), ...(entry.genreIds ?? [])])],
      genres: [...(previous.genres ?? []), ...(entry.genres ?? [])].filter(
        (genre, index, all) => all.findIndex((candidate) => candidate.id === genre.id) === index,
      ),
      startedAt: previous.startedAt ?? entry.startedAt,
      finishedAt: previous.finishedAt ?? entry.finishedAt,
      addedAt: Math.min(previous.addedAt, entry.addedAt),
    });
  }
  return [...merged.values()].sort((a, b) => b.addedAt - a.addedAt);
}

export function buildLibraryStats(entries: WatchlistEntry[], genreDirectory: Ref[] = []): LibraryStats {
  const games = dedupeLibrary(entries.filter((entry) =>
    entry.watchlisted
    || entry.following
    || entry.status !== "none"
    || (entry.ownedOn ?? []).length > 0
    || (entry.subscriptionAccess ?? []).length > 0,
  ));
  const status = { none: 0, want: 0, playing: 0, played: 0 } satisfies Record<WatchStatus, number>;
  const platformCounts = new Map<string, number>();
  const subscriptionCounts = new Map<string, number>();
  const playedPlatformCounts = new Map<string, number>();
  const genreCounts = new Map<number, number>();
  const decadeCounts = new Map<string, number>();
  const scoreBandCounts = new Map<string, number>();
  const genreNames = new Map(genreDirectory.map((genre) => [genre.id, genre.name]));
  let platformCopies = 0;
  let completedHours = 0;
  let backlogHours = 0;
  let criticTotal = 0;
  let criticCount = 0;
  let subscriptionAccesses = 0;
  let finishDurationDays = 0;
  let finishDurationCount = 0;
  const stateOf = (game: WatchlistEntry): ReleaseState => {
    const catalogState = releaseState(game);
    // Explicit TBA remains Upcoming as promised. Only a genuinely missing
    // provider date can be repaired by the user's stronger evidence that they
    // have already played the game.
    return catalogState === "unknown" && (game.status === "playing" || game.status === "played")
      ? "released"
      : catalogState;
  };

  for (const game of games) {
    status[game.status]++;
    const owned = [...new Set(game.ownedOn ?? [])];
    platformCopies += owned.length;
    for (const platform of owned) platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1);
    for (const access of game.subscriptionAccess ?? []) {
      subscriptionAccesses++;
      subscriptionCounts.set(access.service, (subscriptionCounts.get(access.service) ?? 0) + 1);
      playedPlatformCounts.set(access.platform, (playedPlatformCounts.get(access.platform) ?? 0) + 1);
    }
    if (game.platform) playedPlatformCounts.set(game.platform, (playedPlatformCounts.get(game.platform) ?? 0) + 1);
    for (const genre of game.genres ?? []) genreNames.set(genre.id, genre.name);
    for (const genreId of new Set(game.genreIds ?? [])) genreCounts.set(genreId, (genreCounts.get(genreId) ?? 0) + 1);
    if (game.metacritic !== null) {
      criticTotal += game.metacritic;
      criticCount++;
      const band = game.metacritic >= 90 ? "90–100" : game.metacritic >= 80 ? "80–89" : game.metacritic >= 70 ? "70–79" : "Below 70";
      scoreBandCounts.set(band, (scoreBandCounts.get(band) ?? 0) + 1);
    }
    if (game.released) {
      const year = Number(game.released.slice(0, 4));
      if (Number.isFinite(year)) {
        const decade = `${Math.floor(year / 10) * 10}s`;
        decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1);
      }
    }
    if (game.startedAt && game.finishedAt && game.finishedAt >= game.startedAt) {
      finishDurationDays += (game.finishedAt - game.startedAt) / 86_400_000;
      finishDurationCount++;
    }
    const hours = Math.max(0, game.playtime ?? 0);
    if (game.status === "played") completedHours += hours;
    else if (
      (game.status === "want" || game.status === "playing")
      && stateOf(game) === "released"
    ) backlogHours += hours;
  }

  const now = new Date();
  const timeline: TimelineStat[] = [];
  for (let offset = 11; offset >= 0; offset--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const key = date.toISOString().slice(0, 7);
    timeline.push({
      key,
      label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date),
      added: games.filter((game) => monthKey(game.addedAt) === key).length,
      completed: games.filter((game) => game.finishedAt && monthKey(game.finishedAt) === key).length,
    });
  }

  const rank = (items: Map<string, number>): RankedStat[] => [...items]
    .map(([key, value]) => ({ key, label: humanise(key), value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const releasedGames = games.filter((game) => stateOf(game) === "released").length;
  const unreleasedGames = games.filter((game) => stateOf(game) === "upcoming").length;
  const unknownReleaseGames = games.length - releasedGames - unreleasedGames;
  const releasedCompleted = games.filter((game) =>
    game.status === "played" && stateOf(game) === "released",
  ).length;
  let completionStreakMonths = 0;
  for (let index = timeline.length - 1; index >= 0; index--) {
    if (timeline[index].completed === 0) break;
    completionStreakMonths++;
  }

  return {
    games,
    uniqueGames: games.length,
    ownedGames: games.filter((game) => (game.ownedOn ?? []).length > 0).length,
    savedGames: games.filter((game) => game.watchlisted).length,
    platformCopies,
    extraCopies: Math.max(0, platformCopies - games.filter((game) => (game.ownedOn ?? []).length > 0).length),
    followedGames: games.filter((game) => game.following).length,
    subscriptionGames: games.filter((game) => (game.subscriptionAccess ?? []).length > 0).length,
    subscriptionAccesses,
    accessibleGames: games.filter((game) => (game.ownedOn ?? []).length > 0 || (game.subscriptionAccess ?? []).length > 0).length,
    unplayedOwned: games.filter((game) =>
      (game.ownedOn ?? []).length > 0
      && game.status !== "played"
      && stateOf(game) === "released",
    ).length,
    upcomingFollowed: games.filter((game) =>
      game.following && stateOf(game) === "upcoming",
    ).length,
    wanted: status.want,
    playing: status.playing,
    played: status.played,
    releasedCompleted,
    noStatus: status.none,
    releasedGames,
    unreleasedGames,
    datedUpcomingGames: games.filter((game) => stateOf(game) === "upcoming" && !game.tba).length,
    tbaGames: games.filter((game) => stateOf(game) === "upcoming" && game.tba).length,
    unknownReleaseGames,
    statusCoverage: games.length ? Math.round(((games.length - status.none) / games.length) * 100) : 0,
    accessCoverage: games.length ? Math.round((games.filter((game) =>
      (game.ownedOn ?? []).length > 0 || (game.subscriptionAccess ?? []).length > 0,
    ).length / games.length) * 100) : 0,
    criticCoverage: games.length ? Math.round((criticCount / games.length) * 100) : 0,
    completionRate: releasedGames ? Math.round((releasedCompleted / releasedGames) * 100) : 0,
    completionBase: releasedGames,
    completedHours,
    backlogHours,
    averageCritic: criticCount ? Math.round(criticTotal / criticCount) : null,
    highScorers: games.filter((game) => (game.metacritic ?? 0) >= 85).length,
    completedLast90Days: games.filter((game) => game.finishedAt && game.finishedAt >= Date.now() - 90 * 86_400_000).length,
    completionStreakMonths,
    averageDaysToFinish: finishDurationCount ? Math.round(finishDurationDays / finishDurationCount) : null,
    collectionAgeDays: games.length ? Math.max(0, Math.floor((Date.now() - Math.min(...games.map((game) => game.addedAt))) / 86_400_000)) : 0,
    platforms: rank(platformCounts),
    subscriptions: rank(subscriptionCounts),
    playedPlatforms: rank(playedPlatformCounts),
    genres: [...genreCounts]
      .map(([id, value]) => ({ key: String(id), label: genreNames.get(id) ?? "Unclassified", value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    decades: rank(decadeCounts),
    scoreBands: ["90–100", "80–89", "70–79", "Below 70"].flatMap((label) => {
      const value = scoreBandCounts.get(label) ?? 0;
      return value ? [{ key: label, label, value }] : [];
    }),
    timeline,
    earliestAddedAt: games.length ? Math.min(...games.map((game) => game.addedAt)) : null,
  };
}

function monthKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function humanise(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/* ---------------------------------------------------------------------------
 * Personal analytics
 *
 * Everything the /stats bento renders is derived here, from the user's own
 * Firestore records plus (optionally) IGDB time-to-beat figures. The output is
 * plain data so the chart components stay pure — props in, SVG out — and the
 * dev preview can drive the exact same pipeline with sample records.
 *
 * Honesty rules, applied throughout:
 *  - Nothing is estimated without a source. Hours exist only when IGDB has a
 *    time-to-beat for that game, and every hours figure carries its coverage.
 *  - Every chart reports its own denominator and its own "not enough data"
 *    state instead of drawing a confident shape from two data points.
 * ------------------------------------------------------------------------ */

export interface AnalyticsGame {
  gameId: number;
  slug: string;
  name: string;
  image: string | null;
  imageFallback: string | null;
}

export interface RadarAxis {
  id: number;
  label: string;
  count: number;
  /** Share of games that carry genre data, 0–1. */
  share: number;
  games: AnalyticsGame[];
}

export interface GenreRadarData {
  axes: RadarAxis[];
  gamesWithGenres: number;
  /** Games with genre data needed before the radar says anything meaningful. */
  required: number;
  unlocked: boolean;
}

export interface SliceDatum {
  key: string;
  label: string;
  value: number;
}

export interface DriftBucket {
  key: string;
  label: string;
  games: number;
  /** Genre-tag counts in this bucket, keyed by series key ("other" included). */
  counts: Record<string, number>;
  /** Sum of `counts`: the 100% of the stacked share. */
  tags: number;
}

export type DriftBasis = "added-year" | "added-quarter" | "added-month" | "release-decade" | "release-year";

export interface TasteDriftData {
  basis: DriftBasis | null;
  series: SliceDatum[];
  buckets: DriftBucket[];
}

export interface FunnelStage {
  key: "tracked" | "started" | "finished";
  label: string;
  value: number;
}

export interface CriticGame extends AnalyticsGame {
  score: number;
}

export interface CriticData {
  /** Which set of games the figures describe. */
  basis: "owned" | "library";
  average: number | null;
  scored: number;
  considered: number;
  highest: CriticGame | null;
  lowest: CriticGame | null;
}

export interface PlatformHours {
  key: string;
  label: string;
  finished: number;
  inProgress: number;
}

export interface HoursData {
  /** False when no time-to-beat source answered; the UI then hides hours entirely. */
  available: boolean;
  finished: number;
  inProgress: number;
  backlog: number;
  backlogGames: number;
  /** Games whose status/ownership makes them count towards any hours figure. */
  eligible: number;
  /** …of which IGDB has a time-to-beat for. */
  withData: number;
  byPlatform: PlatformHours[];
}

export interface FinishData {
  finished: number;
  /** Released games the user owns: the denominator. */
  base: number;
  rate: number | null;
}

export interface PersonalAnalytics {
  totalGames: number;
  ownedGames: number;
  ownedCopies: number;
  radar: GenreRadarData;
  drift: TasteDriftData;
  platformSplit: SliceDatum[];
  eras: SliceDatum[];
  undatedGames: number;
  funnel: { stages: FunnelStage[]; want: number; playing: number; played: number };
  finish: FinishData;
  critic: CriticData;
  hours: HoursData;
}

/**
 * What "the catalogue" scores, for the library-vs-catalogue comparison.
 *
 * IGDB exposes no catalogue-wide average, and averaging every scored record
 * would be dominated by obscure titles nobody's library contains. The
 * benchmark is therefore the mean critic score of the most-rated scored games:
 * the same kind of game a personal library is made of. `sample` travels with
 * it so the UI can say exactly what was averaged.
 */
export interface CatalogueBenchmark {
  average: number;
  sample: number;
}

export function catalogueBenchmark(games: Array<{ metacritic: number | null }>): CatalogueBenchmark | null {
  const scores = games.flatMap((game) => (typeof game.metacritic === "number" ? [game.metacritic] : []));
  // Fewer than this and the "benchmark" is a handful of games, not a catalogue.
  if (scores.length < 50) return null;
  return {
    average: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    sample: scores.length,
  };
}

/** IGDB time-to-beat in hours, as returned by `/api/library/metadata`. */
export interface TimeToBeatLike {
  hastily: number | null;
  normally: number | null;
  completely: number | null;
}

export interface AnalyticsOptions {
  genreDirectory?: Ref[];
  /**
   * Time-to-beat by game id. `null` means the source is unavailable (no
   * helper, no credentials, network failure), which is distinct from an empty
   * record: the source answered and simply knows none of these games.
   */
  timeToBeat?: Record<number, TimeToBeatLike> | null;
}

export const RADAR_MIN_GAMES = 5;
const RADAR_MAX_AXES = 8;
const DRIFT_MIN_GAMES = 6;
const DRIFT_SERIES = 5;
const DRIFT_MAX_BUCKETS = 12;
const PLATFORM_SLICES = 5;

/** Same membership rule as `buildLibraryStats`: tombstoned records never count. */
function personalGames(entries: WatchlistEntry[]): WatchlistEntry[] {
  return dedupeLibrary(entries.filter((entry) =>
    entry.watchlisted
    || entry.following
    || entry.status !== "none"
    || (entry.ownedOn ?? []).length > 0
    || (entry.subscriptionAccess ?? []).length > 0,
  ));
}

export function buildPersonalAnalytics(
  entries: WatchlistEntry[],
  options: AnalyticsOptions = {},
): PersonalAnalytics {
  const games = personalGames(entries);

  const genreNames = new Map((options.genreDirectory ?? []).map((genre) => [genre.id, genre.name]));
  for (const game of games) for (const genre of game.genres ?? []) genreNames.set(genre.id, genre.name);
  // A genre id with no name anywhere can't be labelled, so it can't be charted.
  const namedGenres = (game: WatchlistEntry) => [...new Set(game.genreIds ?? [])].filter((id) => genreNames.has(id));

  const released = (game: WatchlistEntry) => {
    const state = releaseState(game);
    // Mirrors buildLibraryStats: playing a game is evidence that it is out.
    return state === "released"
      || (state === "unknown" && (game.status === "playing" || game.status === "played"));
  };
  const owned = games.filter(isOwnedEntry);

  return {
    totalGames: games.length,
    ownedGames: owned.length,
    ownedCopies: owned.reduce((sum, game) => sum + new Set(game.ownedOn).size, 0),
    radar: buildRadar(games, namedGenres, genreNames),
    drift: buildDrift(games, namedGenres, genreNames),
    platformSplit: buildPlatformSplit(owned),
    ...buildEras(games),
    funnel: buildFunnel(games),
    finish: buildFinish(owned, released),
    critic: buildCritic(games, owned),
    hours: buildHours(games, options.timeToBeat ?? null, released),
  };
}

/** Library game ids, deduplicated, for the time-to-beat lookup. */
export function personalGameIds(entries: WatchlistEntry[]): number[] {
  return personalGames(entries)
    .filter((game) => !/-s\d+$/.test(game.slug))
    .map((game) => game.gameId);
}

function isOwnedEntry(game: WatchlistEntry): boolean {
  return (game.ownedOn ?? []).length > 0;
}

function toAnalyticsGame(game: WatchlistEntry): AnalyticsGame {
  return {
    gameId: game.gameId,
    slug: game.slug,
    name: game.name,
    image: game.image,
    imageFallback: game.imageFallback,
  };
}

function buildRadar(
  games: WatchlistEntry[],
  namedGenres: (game: WatchlistEntry) => number[],
  genreNames: Map<number, string>,
): GenreRadarData {
  const byGenre = new Map<number, WatchlistEntry[]>();
  let gamesWithGenres = 0;
  for (const game of games) {
    const ids = namedGenres(game);
    if (ids.length) gamesWithGenres++;
    for (const id of ids) byGenre.set(id, [...(byGenre.get(id) ?? []), game]);
  }
  const axes = [...byGenre]
    .map(([id, members]) => ({
      id,
      label: genreNames.get(id) ?? "",
      count: members.length,
      share: gamesWithGenres ? members.length / gamesWithGenres : 0,
      games: members.map(toAnalyticsGame),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, RADAR_MAX_AXES);
  return {
    axes,
    gamesWithGenres,
    required: RADAR_MIN_GAMES,
    // A radar needs at least a triangle; fewer axes than that is just a list.
    unlocked: gamesWithGenres >= RADAR_MIN_GAMES && axes.length >= 3,
  };
}

/**
 * Picks the most truthful time axis the data supports.
 *
 * `addedAt` is when a game entered the library, which is what "taste drift"
 * actually means, at the coarsest grain that still shows a trend (years, then
 * quarters, then months). A library imported in one sitting has every
 * timestamp on the same day, which says nothing; the honest fallback is then
 * the release period of games the user owns or has played, labelled as such.
 */
function buildDrift(
  games: WatchlistEntry[],
  namedGenres: (game: WatchlistEntry) => number[],
  genreNames: Map<number, string>,
): TasteDriftData {
  const withGenres = games.filter((game) => namedGenres(game).length > 0);

  type Keyed = { game: WatchlistEntry; key: string; label: string };
  const candidates: Array<{ basis: DriftBasis; items: Keyed[] }> = [];

  const added = withGenres.filter((game) => Number.isFinite(game.addedAt) && game.addedAt > 0);
  const shortYear = (date: Date) => `’${String(date.getUTCFullYear()).slice(2)}`;
  candidates.push({
    basis: "added-year",
    items: added.map((game) => {
      const year = String(new Date(game.addedAt).getUTCFullYear());
      return { game, key: year, label: year };
    }),
  });
  candidates.push({
    basis: "added-quarter",
    items: added.map((game) => {
      const date = new Date(game.addedAt);
      const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
      return { game, key: `${date.getUTCFullYear()}-q${quarter}`, label: `Q${quarter} ${shortYear(date)}` };
    }),
  });
  candidates.push({
    basis: "added-month",
    items: added.map((game) => {
      const date = new Date(game.addedAt);
      const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date);
      return { game, key: date.toISOString().slice(0, 7), label: `${month} ${shortYear(date)}` };
    }),
  });

  const dated = withGenres
    .filter((game) => isOwnedEntry(game) || game.status === "playing" || game.status === "played")
    .flatMap((game) => {
      const year = releaseYear(game);
      return year === null ? [] : [{ game, year }];
    });
  candidates.push({
    basis: "release-decade",
    items: dated.map(({ game, year }) => {
      const decade = Math.floor(year / 10) * 10;
      return { game, key: String(decade), label: `${decade}s` };
    }),
  });
  candidates.push({
    basis: "release-year",
    items: dated.map(({ game, year }) => ({ game, key: String(year), label: String(year) })),
  });

  // The first basis with three populated periods wins: a two-point "trend"
  // is a comparison, not a drift.
  const chosen = candidates.find(({ items }) =>
    items.length >= DRIFT_MIN_GAMES && new Set(items.map((item) => item.key)).size >= 3,
  );
  if (!chosen) return { basis: null, series: [], buckets: [] };

  const totals = new Map<number, number>();
  for (const { game } of chosen.items) {
    for (const id of namedGenres(game)) totals.set(id, (totals.get(id) ?? 0) + 1);
  }
  const top = [...totals]
    .sort((a, b) => b[1] - a[1] || (genreNames.get(a[0]) ?? "").localeCompare(genreNames.get(b[0]) ?? ""))
    .slice(0, DRIFT_SERIES)
    .map(([id]) => id);
  const topSet = new Set(top);
  const otherTotal = [...totals].filter(([id]) => !topSet.has(id)).reduce((sum, [, count]) => sum + count, 0);
  const series: SliceDatum[] = [
    ...top.map((id) => ({ key: String(id), label: genreNames.get(id) ?? "", value: totals.get(id) ?? 0 })),
    ...(otherTotal ? [{ key: "other", label: "Other genres", value: otherTotal }] : []),
  ];

  const buckets = new Map<string, DriftBucket>();
  for (const { game, key, label } of chosen.items) {
    const bucket = buckets.get(key) ?? { key, label, games: 0, counts: {}, tags: 0 };
    bucket.games++;
    for (const id of namedGenres(game)) {
      const seriesKey = topSet.has(id) ? String(id) : "other";
      bucket.counts[seriesKey] = (bucket.counts[seriesKey] ?? 0) + 1;
      bucket.tags++;
    }
    buckets.set(key, bucket);
  }
  const ordered = [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-DRIFT_MAX_BUCKETS);
  return { basis: chosen.basis, series, buckets: ordered };
}

function releaseYear(game: WatchlistEntry): number | null {
  const source = game.released ?? game.releaseWindow ?? "";
  const match = source.match(/\b(19[5-9]\d|20\d{2}|21\d{2})\b/);
  return match ? Number(match[1]) : null;
}

/** Human label for an ownership or play-location slug. */
export function platformLabel(slug: string): string {
  return ownershipPlatform(slug)?.name ?? playingLocation(slug)?.name ?? humanise(slug);
}

function buildPlatformSplit(owned: WatchlistEntry[]): SliceDatum[] {
  const counts = new Map<string, number>();
  for (const game of owned) {
    for (const slug of new Set(game.ownedOn)) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const ranked = [...counts]
    .map(([key, value]) => ({ key, label: platformLabel(key), value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  // A donut stops being readable past ~6 segments, so the tail folds.
  if (ranked.length <= PLATFORM_SLICES + 1) return ranked;
  const rest = ranked.slice(PLATFORM_SLICES);
  return [
    ...ranked.slice(0, PLATFORM_SLICES),
    { key: "other", label: `${rest.length} other platforms`, value: rest.reduce((sum, item) => sum + item.value, 0) },
  ];
}

function buildEras(games: WatchlistEntry[]): { eras: SliceDatum[]; undatedGames: number } {
  const counts = new Map<number, number>();
  let undatedGames = 0;
  for (const game of games) {
    const year = releaseYear(game);
    if (year === null) {
      undatedGames++;
      continue;
    }
    const decade = Math.floor(year / 10) * 10;
    counts.set(decade, (counts.get(decade) ?? 0) + 1);
  }
  if (counts.size === 0) return { eras: [], undatedGames };
  // A histogram keeps its empty decades: a gap is part of the shape.
  const first = Math.min(...counts.keys());
  const last = Math.max(...counts.keys());
  const eras: SliceDatum[] = [];
  for (let decade = first; decade <= last; decade += 10) {
    eras.push({ key: String(decade), label: `${decade}s`, value: counts.get(decade) ?? 0 });
  }
  return { eras, undatedGames };
}

/**
 * Statuses are exclusive, so the funnel is cumulative: a finished game has
 * necessarily also been started, and was on the list before that.
 */
function buildFunnel(games: WatchlistEntry[]): PersonalAnalytics["funnel"] {
  const want = games.filter((game) => game.status === "want").length;
  const playing = games.filter((game) => game.status === "playing").length;
  const played = games.filter((game) => game.status === "played").length;
  return {
    want,
    playing,
    played,
    stages: [
      { key: "tracked", label: "Given a status", value: want + playing + played },
      { key: "started", label: "Started", value: playing + played },
      { key: "finished", label: "Finished", value: played },
    ],
  };
}

function buildFinish(owned: WatchlistEntry[], released: (game: WatchlistEntry) => boolean): FinishData {
  // Pre-orders are owned but can't be finished yet, so they stay out of the base.
  const base = owned.filter(released);
  const finished = base.filter((game) => game.status === "played").length;
  return { finished, base: base.length, rate: base.length ? finished / base.length : null };
}

function buildCritic(games: WatchlistEntry[], owned: WatchlistEntry[]): CriticData {
  const scoredOwned = owned.filter((game) => game.metacritic !== null);
  // Owned games are the truest "your library", but three scores is the least
  // that can be called an average; below that, widen to everything tracked.
  const basis: CriticData["basis"] = scoredOwned.length >= 3 ? "owned" : "library";
  const pool = basis === "owned" ? owned : games;
  const scored = pool
    .filter((game): game is WatchlistEntry & { metacritic: number } => game.metacritic !== null)
    .sort((a, b) => b.metacritic - a.metacritic || a.name.localeCompare(b.name));
  const critic = (game: (typeof scored)[number]): CriticGame => ({ ...toAnalyticsGame(game), score: game.metacritic });
  return {
    basis,
    average: scored.length ? Math.round(scored.reduce((sum, game) => sum + game.metacritic, 0) / scored.length) : null,
    scored: scored.length,
    considered: pool.length,
    highest: scored.length ? critic(scored[0]) : null,
    lowest: scored.length > 1 ? critic(scored[scored.length - 1]) : null,
  };
}

/** IGDB's "normally" figure, falling back to "hastily", and never to a guess. */
function hoursFor(ttb: TimeToBeatLike | undefined): number | null {
  if (!ttb) return null;
  const value = ttb.normally ?? ttb.hastily;
  return typeof value === "number" && value > 0 ? value : null;
}

/**
 * Where the hours were spent. The recorded play platform is the only real
 * answer; a single owned copy or a single subscription record is unambiguous
 * enough to stand in. Several copies and no play platform stays unassigned
 * rather than being credited to whichever copy happens to be listed first.
 */
export function playPlatform(game: WatchlistEntry): string | null {
  if (game.platform) return game.platform;
  const owned = [...new Set(game.ownedOn ?? [])];
  const access = [...new Set((game.subscriptionAccess ?? []).map((item) => item.platform))];
  if (owned.length === 1 && access.length === 0) return owned[0];
  if (owned.length === 0 && access.length === 1) return access[0];
  return null;
}

function buildHours(
  games: WatchlistEntry[],
  timeToBeat: Record<number, TimeToBeatLike> | null,
  released: (game: WatchlistEntry) => boolean,
): HoursData {
  if (!timeToBeat) {
    return { available: false, finished: 0, inProgress: 0, backlog: 0, backlogGames: 0, eligible: 0, withData: 0, byPlatform: [] };
  }

  const platforms = new Map<string, PlatformHours>();
  const credit = (game: WatchlistEntry, field: "finished" | "inProgress", hours: number) => {
    const slug = playPlatform(game);
    const key = slug ?? "unassigned";
    const row = platforms.get(key) ?? { key, label: slug ? platformLabel(slug) : "Platform not set", finished: 0, inProgress: 0 };
    row[field] += hours;
    platforms.set(key, row);
  };

  let finished = 0;
  let inProgress = 0;
  let backlog = 0;
  let backlogGames = 0;
  let eligible = 0;
  let withData = 0;

  for (const game of games) {
    const isBacklog = isOwnedEntry(game)
      && (game.status === "none" || game.status === "want")
      && released(game);
    if (!(game.status === "played" || game.status === "playing" || isBacklog)) continue;
    eligible++;
    const hours = hoursFor(timeToBeat[game.gameId]);
    if (hours === null) continue;
    withData++;
    if (game.status === "played") {
      finished += hours;
      credit(game, "finished", hours);
    } else if (game.status === "playing") {
      // Halfway is the only neutral assumption without real progress data.
      // The unplayed half is still ahead of the player, so it is backlog too.
      inProgress += hours / 2;
      backlog += hours / 2;
      credit(game, "inProgress", hours / 2);
    } else {
      backlog += hours;
      backlogGames++;
    }
  }

  return {
    available: true,
    finished: Math.round(finished),
    inProgress: Math.round(inProgress),
    backlog: Math.round(backlog),
    backlogGames,
    eligible,
    withData,
    byPlatform: [...platforms.values()]
      .map((row) => ({ ...row, finished: Math.round(row.finished), inProgress: Math.round(row.inProgress) }))
      .filter((row) => row.finished + row.inProgress > 0)
      .sort((a, b) => b.finished + b.inProgress - (a.finished + a.inProgress) || a.label.localeCompare(b.label)),
  };
}
