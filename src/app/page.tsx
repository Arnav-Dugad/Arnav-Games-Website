import { Suspense } from "react";
import { CinematicHero } from "@/components/home/CinematicHero";
import { ForYou } from "@/components/home/ForYou";
import { GenreTiles, pickGenreTiles } from "@/components/home/GenreTiles";
import { HomeSection } from "@/components/home/HomeSection";
import { ChartsShelf, GamePassShelf, TodayShelf } from "@/components/home/HomeShelves";
import { JoinCta } from "@/components/home/JoinCta";
import { buildWeek, ThisWeek } from "@/components/home/ThisWeek";
import { TodayStoriesSkeleton } from "@/components/home/TodayStories";
import { TopChartsSkeleton } from "@/components/home/TopCharts";
import { GameRail } from "@/components/game/GameRail";
import { CoverFlow } from "@/components/interactions/CoverFlow";
import { Container } from "@/components/ui/SectionHeading";
import { DataSourceNotice } from "@/components/ui/DataSourceNotice";
import { Skeleton } from "@/components/ui/Skeleton";
import type { WatchlistEntry } from "@/lib/firebase/db";
import {
  getGenres,
  getNewReleases,
  getSpotlight,
  getTopRated,
  getTrending,
  getUpcoming,
  isDegraded,
} from "@/lib/games/source";
import type { GameSummary } from "@/lib/games/types";

// Render from cached provider data at request time so an upstream outage is
// never baked into the homepage HTML during deployment.
export const revalidate = 0;

/** A week view needs a few releases to be worth a section of its own. */
const MIN_WEEK_GAMES = 3;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The front door, in the order a reader's questions arrive:
 *
 *   hero          — one featured game, full-bleed (the single focal point)
 *   for you       — signed in only: your library in motion + picks
 *   today         — four stories, each with a one-line, data-backed reason
 *   this week     — the next seven days of releases, by day
 *   top charts    — trending / most anticipated / top rated, ranked
 *   new releases  — what just came out
 *   game pass     — just added / leaving soon
 *   genres        — where to go next
 *   join          — signed out only
 *
 * The old stats strip (database counts) and the separate trending, most
 * anticipated and critically acclaimed shelves were folded into Top charts:
 * three poster rails in a row read as one long wall of covers.
 */
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  // One await point: these queries are independent and must not waterfall.
  const [spotlight, upcoming, trending, topRated, newReleases, genres] = await Promise.all([
    getSpotlight(6),
    // Notable only, matching the calendar's default view; enough of it to
    // cover a busy week.
    getUpcoming(40, 1, { notableOnly: true }),
    getTrending(12),
    getTopRated(12),
    getNewReleases(14),
    getGenres(),
  ]);

  const source = upcoming.source;
  const upcomingGames = upcoming.data.results;
  const week = buildWeek(upcomingGames);
  const weekCount = week.reduce((sum, day) => sum + day.games.length, 0);
  const genreTiles = pickGenreTiles(genres.data, [
    ...trending.data,
    ...topRated.data,
    ...newReleases.data,
    ...upcomingGames,
  ]);

  const preview = await devPreview(searchParams, [...trending.data, ...upcomingGames, ...topRated.data]);

  return (
    <>
      {/* The hero is deliberately IGDB-only. It never falls back to a
          storefront or an unrelated upcoming shelf. */}
      <CinematicHero games={spotlight.data} />

      {source === "unavailable" && (
        <Container className="pt-8">
          <DataSourceNotice source={source} degraded={isDegraded(source)} />
        </Container>
      )}

      <ForYou genres={genres.data} previewEntries={preview} />

      {/* Streamed: Today and Top charts wait on the hype index, Game Pass on
          Microsoft's catalogue. Each fallback matches its final geometry. */}
      <Suspense fallback={<TodayFallback />}>
        <TodayShelf
          upcoming={upcomingGames}
          trending={trending.data}
          newReleases={newReleases.data}
          topRated={topRated.data}
          exclude={spotlight.data.map((game) => game.id)}
        />
      </Suspense>

      {weekCount >= MIN_WEEK_GAMES ? (
        <HomeSection
          id="this-week"
          eyebrow="Release calendar"
          title="This week"
          description={`${weekCount} notable ${weekCount === 1 ? "game" : "games"} out in the next seven days.`}
          href="/upcoming"
        >
          <Container>
            <ThisWeek days={week} />
          </Container>
        </HomeSection>
      ) : (
        upcomingGames.length > 0 && (
          // A quiet week falls back to the calendar's next arrivals rather
          // than a grid of empty days.
          <HomeSection
            id="this-week"
            eyebrow="Release calendar"
            title="Landing soon"
            description="The next notable releases, in date order."
            href="/upcoming"
          >
            <ComingSoon games={upcomingGames.slice(0, 18)} label="Landing soon" />
          </HomeSection>
        )
      )}

      <Suspense fallback={<TopChartsSkeleton />}>
        <ChartsShelf trending={trending.data} topRated={topRated.data} />
      </Suspense>

      {newReleases.data.length > 0 && (
        <HomeSection
          id="new-releases"
          eyebrow="Just released"
          title="New releases"
          description="Out in the last two months."
          href="/browse?ordering=-released"
        >
          <ComingSoon games={newReleases.data} label="New releases" />
        </HomeSection>
      )}

      <Suspense fallback={null}>
        <GamePassShelf />
      </Suspense>

      {genreTiles.length > 0 && (
        <HomeSection
          id="genres"
          eyebrow="Find your lane"
          title="Browse by genre"
          href="/genres"
          linkLabel="All genres"
        >
          <Container>
            <GenreTiles tiles={genreTiles} />
          </Container>
        </HomeSection>
      )}

      <JoinCta />
    </>
  );
}

/**
 * Touch-sized screens get the cover-flow; md+ keeps the rail. A CSS switch
 * rather than a JS media query, so the server HTML is already right and
 * nothing swaps after hydration.
 */
function ComingSoon({ games, label }: { games: GameSummary[]; label: string }) {
  return (
    <>
      <div className="md:hidden">
        <CoverFlow games={games} label={label} />
      </div>
      <div className="hidden md:block">
        <GameRail games={games} />
      </div>
    </>
  );
}

function TodayFallback() {
  return (
    <section aria-hidden className="py-9 sm:py-12 lg:py-14">
      <Container>
        <Skeleton className="h-4 w-36 rounded-full" />
        <Skeleton className="mt-3 h-8 w-28" />
        <div className="mt-6 sm:mt-7">
          <TodayStoriesSkeleton />
        </div>
      </Container>
    </section>
  );
}

/**
 * DEV PREVIEW ONLY: `/?preview=signed-in` renders "For you" as if signed in,
 * with a library built from the live games already on this page (some
 * playing, some followed and upcoming, some in the backlog). It returns
 * undefined outside `next dev`, so no real visitor can ever see sample data.
 */
async function devPreview(searchParams: SearchParams, games: GameSummary[]): Promise<WatchlistEntry[] | undefined> {
  if (process.env.NODE_ENV !== "development") return undefined;
  const preview = (await searchParams).preview;
  if (preview !== "signed-in" && preview !== "empty") return undefined;
  if (preview === "empty") return [];

  const now = Date.now();
  const unique = [...new Map(games.map((game) => [game.id, game])).values()];
  const upcomingGames = unique.filter((game) => game.released && game.released > new Date(now).toISOString().slice(0, 10));
  const released = unique.filter((game) => !upcomingGames.includes(game));
  const entry = (game: GameSummary, status: WatchlistEntry["status"], daysAgo: number): WatchlistEntry => ({
    gameId: game.id,
    slug: game.slug,
    name: game.name,
    image: game.image,
    imageFallback: game.imageFallback,
    released: game.released,
    releaseWindow: game.releaseWindow,
    tba: game.tba,
    metacritic: game.metacritic,
    following: status !== "played",
    watchlisted: true,
    metadataVersion: 3,
    metadataUpdatedAt: now,
    status,
    platform: null,
    startedAt: status === "playing" ? now - daysAgo * 86_400_000 : null,
    finishedAt: status === "played" ? now - daysAgo * 86_400_000 : null,
    genreIds: game.genres.map((genre) => genre.id),
    platformSlugs: game.parentPlatforms.map((platform) => platform.slug),
    ownedOn: status === "want" ? [] : ["steam"],
    addedAt: now - daysAgo * 86_400_000,
  } as WatchlistEntry);

  return [
    ...released.slice(0, 2).map((game, i) => entry(game, "playing", 3 + i * 9)),
    ...upcomingGames.slice(0, 4).map((game, i) => entry(game, "none", 20 + i)),
    ...released.slice(2, 5).map((game, i) => entry(game, "want", 40 + i)),
    ...released.slice(5, 9).map((game, i) => entry(game, "played", 60 + i)),
  ];
}
