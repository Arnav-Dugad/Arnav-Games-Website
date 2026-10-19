import Link from "next/link";
import { ArrowRight, CalendarClock, Database, Flame, Trophy } from "lucide-react";
import { CinematicHero } from "@/components/home/CinematicHero";
import { GameRail } from "@/components/game/GameRail";
import { CoverFlow } from "@/components/interactions/CoverFlow";
import { GameGrid } from "@/components/game/GameGrid";
import { Container, Section, SectionHeading } from "@/components/ui/SectionHeading";
import { DataSourceNotice } from "@/components/ui/DataSourceNotice";
import { Stagger, StaggerItem } from "@/components/motion/Reveal";
import { JoinCta } from "@/components/home/JoinCta";
import { AnticipatedShelf, GamePassShelves } from "@/components/home/HomeShelves";
import { Suspense } from "react";
import { PersonalCommandCenter } from "@/components/home/PersonalCommandCenter";
import { CountUp } from "@/components/motion/text";
import { Marquee, Spotlight } from "@/components/motion/effects";
import { cn } from "@/lib/utils/cn";
import {
  getGenres,
  getNewReleases,
  getTopRated,
  getTotalGames,
  getSpotlight,
  getTrending,
  getUpcoming,
  isDegraded,
} from "@/lib/games/source";
import { hueFromString } from "@/lib/utils/format";

/** Revalidate hourly — release data changes on the order of days, not minutes. */
// Render from cached provider data at request time so an upstream outage is
// never baked into the homepage HTML during deployment.
export const revalidate = 0;

export default async function HomePage() {
  // One await point: these queries are independent and must not waterfall.
  const [spotlight, upcoming, trending, topRated, newReleases, genres, totalGames] =
    await Promise.all([
      getSpotlight(6),
      // Notable only, matching the calendar's default view.
      getUpcoming(18, 1, { notableOnly: true }),
      getTrending(14),
      getTopRated(10),
      getNewReleases(14),
      getGenres(),
      getTotalGames(),
    ]);

  const source = upcoming.source;
  const featured = upcoming.data.results;

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

      <PersonalCommandCenter genres={genres.data} />

      <StatsStrip
        totalGames={totalGames}
        upcomingCount={upcoming.data.count}
        genreCount={genres.data.length}
      />

      <Section className="pt-4">
        <Container>
          <SectionHeading
            eyebrow="Release calendar"
            title="Landing soon"
            description="Everything on the horizon, ordered by release date."
            href="/upcoming"
          />
        </Container>
        {/* Touch-sized screens get the cover-flow; md+ keeps the rail. A CSS
            switch rather than a JS media query, so the server HTML is already
            right and nothing swaps after hydration. */}
        <div className="mt-6 md:hidden">
          <CoverFlow games={featured} label="Landing soon" />
        </div>
        {/* Not inside Container: the rail aligns itself with `rail-gutter`. */}
        <div className="mt-7 hidden md:block"><GameRail games={featured} priorityCount={3} /></div>
      </Section>

      {/* Streamed: each shelf waits on its own sources (hype index, the Game
          Pass catalogue) without holding up the page above it. */}
      <Suspense fallback={null}>
        <AnticipatedShelf />
      </Suspense>

      <Section className="py-8 sm:py-11">
        <Container>
          <SectionHeading
            eyebrow="Momentum"
            title="Trending right now"
            description="Ranked from IGDB's worldwide playing-now signal, refreshed as player attention moves."
            href="/browse?ordering=-added"
          />
        </Container>
        {/* Full-bleed, not inside a Container: the rail's own gutter lines
            the first card up with the heading and lets cards scroll off the
            viewport edge. Inside a Container it double-indented and clipped. */}
        <div className="mt-7"><GameRail games={trending.data} /></div>
      </Section>

      <Suspense fallback={null}>
        <GamePassShelves />
      </Suspense>

      <Section>
        <Container>
          <SectionHeading
            eyebrow="Critic scores"
            title="Critically acclaimed"
            description="The highest-scoring games in the database."
            href="/browse?ordering=-metacritic"
          />
          <div className="mt-8">
            <GameGrid games={topRated.data} priorityCount={0} />
          </div>
        </Container>
      </Section>

      <GenreShowcase genres={genres.data} />

      <Section className="py-8 sm:py-11">
        <Container>
          <SectionHeading
            eyebrow="Just shipped"
            title="New releases"
            description="Out in the last two months."
            href="/browse?ordering=-released"
          />
        </Container>
        <div className="mt-7"><GameRail games={newReleases.data} /></div>
      </Section>

      <JoinCta />
    </>
  );
}

/* -------------------------------------------------------------------------- */

function StatsStrip({
  totalGames,
  upcomingCount,
  genreCount,
}: {
  totalGames: number | null;
  upcomingCount: number;
  genreCount: number;
}) {
  const stats = [
    // Omitted entirely when unknown, rather than showing a fabricated number —
    // Steam alone has no honest answer to "how many games total".
    ...(totalGames !== null
      ? [{ value: totalGames, label: "Games in the database", icon: Database, compact: true, plus: true }]
      : []),
    { value: upcomingCount, label: "Upcoming releases tracked", icon: CalendarClock, compact: true, plus: true },
    { value: genreCount, label: "Genres to explore", icon: Flame, compact: false, plus: false },
    { value: 100, label: "Critic scores, 0–100", icon: Trophy, compact: false, plus: false },
  ];

  return (
    <Section className="py-8 sm:py-10">
      <Container>
        <Stagger
          className={cn(
            "grid grid-cols-2 gap-3 lg:gap-4",
            // Falls back to a 3-up layout when the database count is
            // unavailable, so a missing stat never leaves a visible gap.
            stats.length === 4 ? "lg:grid-cols-4" : "sm:grid-cols-3",
          )}
        >
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <StaggerItem key={stat.label}>
                <Spotlight className="glass h-full rounded-2xl p-4 lg:p-5">
                  <Icon size={17} className="text-brand-soft" />
                  <p className="mt-3 font-display text-2xl font-bold leading-none lg:text-3xl">
                    <CountUp value={stat.value} compact={stat.compact} />
                    {stat.plus ? "+" : ""}
                  </p>
                  <p className="mt-1.5 text-[12px] leading-snug text-muted lg:text-[13px]">
                    {stat.label}
                  </p>
                </Spotlight>
              </StaggerItem>
            );
          })}
        </Stagger>
      </Container>
    </Section>
  );
}

function GenreShowcase({ genres }: { genres: { id: number; slug: string; name: string }[] }) {
  const featured = genres.slice(0, 10);
  if (featured.length === 0) return null;

  return (
    <Section>
      <Container>
        <SectionHeading
          eyebrow="Find your lane"
          title="Browse by genre"
          description="Jump straight into the kind of game you're after."
          href="/genres"
        />
      </Container>

      <Container className="mt-8">
        <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
          {featured.map((genre) => {
            const hue = hueFromString(genre.slug);
            return (
              <StaggerItem key={genre.id}>
                <Link
                  href={`/browse?genres=${genre.slug}`}
                  className="group relative flex h-28 items-end overflow-hidden rounded-2xl border border-line p-4 transition-all duration-500 fine:hover:border-line-strong lg:h-32"
                  style={{
                    background: `linear-gradient(140deg, hsl(${hue} 55% 20%), hsl(${(hue + 45) % 360} 50% 9%))`,
                  }}
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 opacity-0 transition-opacity duration-500 fine:group-hover:opacity-100"
                    style={{
                      background: `radial-gradient(90% 70% at 30% 0%, hsl(${hue} 85% 60% / 0.4), transparent 65%)`,
                    }}
                  />
                  <span className="relative font-display text-base font-bold leading-tight lg:text-lg">
                    {genre.name}
                  </span>
                  <ArrowRight
                    size={15}
                    className="relative ml-auto shrink-0 text-white/50 transition-transform duration-500 group-hover:translate-x-1"
                  />
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      </Container>

      {/* Full-bleed ticker of the remaining genres. */}
      {genres.length > 10 && (
        <div className="mask-fade-x mt-4">
          <Marquee speed={44}>
            {genres.slice(10).map((genre) => (
              <Link
                key={genre.id}
                href={`/browse?genres=${genre.slug}`}
                className="rounded-full border border-line bg-white/[0.03] px-5 py-2.5 text-sm text-muted transition-colors hover:border-line-strong hover:text-text"
              >
                {genre.name}
              </Link>
            ))}
          </Marquee>
        </div>
      )}
    </Section>
  );
}
