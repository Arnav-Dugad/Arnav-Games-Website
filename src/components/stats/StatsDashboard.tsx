"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarRange,
  Clock3,
  Disc3,
  Gauge,
  History,
  Layers3,
  Radar,
  Star,
  Trophy,
} from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { Skeleton } from "@/components/ui/Skeleton";
import type { CatalogueBenchmark, DriftBasis, PersonalAnalytics } from "@/lib/games/stats";
import { cn } from "@/lib/utils/cn";
import { CriticCompare } from "./charts/CriticCompare";
import { EraHistogram } from "./charts/EraHistogram";
import { FinishRing } from "./charts/FinishRing";
import { GenreRadar, shortGenre } from "./charts/GenreRadar";
import { HoursByPlatform } from "./charts/HoursByPlatform";
import { PlatformDonut } from "./charts/PlatformDonut";
import { StatusFunnel } from "./charts/StatusFunnel";
import { TasteDrift } from "./charts/TasteDrift";
import { CountUp, LockedState, StatCard, VizStyles, formatHours, formatPercent } from "./primitives";

/** Where the time-to-beat lookup stands. "unavailable" hides every hours figure. */
export type HoursStatus = "loading" | "ready" | "unavailable";

const DRIFT_NOTES: Record<DriftBasis, string> = {
  "added-year": "By the year each game was added to your library.",
  "added-quarter": "By the quarter each game was added to your library.",
  "added-month": "By the month each game was added to your library.",
  "release-decade": "Your games were added at around the same time, so this uses the release decade of games you own or have played: how your taste spans eras, rather than how it changed.",
  "release-year": "Your games were added at around the same time, so this uses the release year of games you own or have played: how your taste spans eras, rather than how it changed.",
};

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en")} ${count === 1 ? one : many}`;

/**
 * The stats bento, as a pure function of already-computed analytics.
 *
 * No fetching and no auth here: `StatsView` supplies live data and the dev
 * preview supplies sample data, and both render exactly this.
 */
export function StatsDashboard({
  analytics,
  benchmark,
  hoursStatus,
}: {
  analytics: PersonalAnalytics;
  benchmark: CatalogueBenchmark | null;
  hoursStatus: HoursStatus;
}) {
  const { radar, drift, hours, finish, critic, funnel, eras, platformSplit } = analytics;
  const hoursReady = hoursStatus === "ready" && hours.available;
  // Only name a "mostly" genre once the radar itself has enough data to.
  const topGenre = radar.unlocked ? radar.axes[0] : undefined;
  const topPlatform = platformSplit.find((slice) => slice.key !== "other");

  return (
    <div className="stats-viz grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-12">
      <VizStyles />

      {/* Hero: the one large figure on the page. */}
      <Reveal onMount className="md:col-span-2 lg:col-span-7">
        <section className="glass noise relative isolate flex h-full flex-col overflow-hidden rounded-[1.75rem] p-5 sm:p-7">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 -z-10 h-72 w-72 rounded-full bg-brand/25 blur-3xl" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Your library</p>
          <div className="mt-2 flex items-end gap-3">
            <CountUp value={analytics.totalGames} className="font-display text-6xl font-bold leading-none sm:text-7xl" />
            <span className="pb-1.5 text-sm text-muted">{analytics.totalGames === 1 ? "game tracked" : "games tracked"}</span>
          </div>
          {(topGenre || topPlatform) && (
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
              {topGenre && <>Mostly <span className="font-semibold text-text">{shortGenre(topGenre.label)}</span></>}
              {topGenre && topPlatform && ", "}
              {topPlatform && <>{topGenre ? "and most often owned on " : "Most often owned on "}<span className="whitespace-nowrap font-semibold text-text">{topPlatform.label}</span></>}.
            </p>
          )}
          <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:mt-auto lg:pt-6">
            <HeroTile label="Owned" value={analytics.ownedGames} note={plural(analytics.ownedCopies, "copy", "copies")} />
            <HeroTile label="Finished" value={funnel.played} note={`${funnel.playing} playing now`} />
            <HeroTile label="Want to play" value={funnel.want} note="on your list" />
            {hoursStatus === "loading" ? (
              <div className="rounded-2xl bg-fg/[0.04] p-3"><Skeleton className="h-3 w-16 rounded" /><Skeleton className="mt-2.5 h-6 w-12 rounded" /></div>
            ) : hoursReady && hours.finished + hours.inProgress > 0 ? (
              <HeroTile label="Hours played" value={hours.finished + hours.inProgress} format={formatHours} note="estimated" />
            ) : (
              <HeroTile label="Genres" value={radar.axes.length} note="in your top mix" />
            )}
          </dl>
        </section>
      </Reveal>

      {/* Finish rate + backlog */}
      <Reveal onMount delay={0.04} className="lg:col-span-5">
        <StatCard
          className="h-full"
          eyebrow="Finish rate"
          icon={<Trophy size={13} />}
          title="What you own, finished"
          summary={finish.rate !== null ? `You have finished ${finish.finished} of ${finish.base} released games you own, ${formatPercent(finish.rate)}.` : undefined}
        >
          {finish.rate === null ? (
            <LockedState message="Mark where you own games to see your finish rate." detail="It compares owned, released games with the ones you've marked Played." href="/library" cta="Open your library" />
          ) : (
            <div className="flex flex-1 flex-col gap-5">
              <div className="flex items-center gap-4 sm:gap-5">
                <FinishRing rate={finish.rate} />
                <p className="text-sm leading-relaxed text-muted">
                  <span className="font-semibold text-text">{finish.finished} of {plural(finish.base, "owned game")}</span> marked played. Pre-orders don&apos;t count until they release.
                </p>
              </div>
              <BacklogLine status={hoursStatus} hours={hours} unfinished={finish.base - finish.finished} />
            </div>
          )}
        </StatCard>
      </Reveal>

      <Reveal className="lg:col-span-6">
        <StatCard
          className="h-full"
          eyebrow="Genre radar"
          icon={<Radar size={13} />}
          title="The shape of your taste"
          summary={radar.unlocked ? `Your top genres: ${radar.axes.map((axis) => `${axis.label} ${axis.count}`).join(", ")}.` : undefined}
          footnote={radar.unlocked ? "Axis length is the number of your games in each genre, relative to your biggest genre. A game with several genres counts towards each." : undefined}
        >
          {radar.unlocked ? (
            <GenreRadar axes={radar.axes} totalWithGenres={radar.gamesWithGenres} />
          ) : radar.gamesWithGenres < radar.required ? (
            <LockedState
              message={`Track ${plural(radar.required - radar.gamesWithGenres, "more game")} to unlock your radar.`}
              detail={`${radar.gamesWithGenres} of ${radar.required} games with genre data so far.`}
              progress={radar.gamesWithGenres / radar.required}
            />
          ) : (
            <LockedState message="Your games share fewer than three genres so far." detail="A radar needs at least three axes. Track something outside your usual lane." />
          )}
        </StatCard>
      </Reveal>

      <Reveal delay={0.04} className="lg:col-span-6">
        <StatCard
          className="h-full"
          eyebrow="Taste drift"
          icon={<History size={13} />}
          title="How your genre mix shifts"
          summary={drift.basis ? `${DRIFT_NOTES[drift.basis]} ${drift.buckets.length} periods, from ${drift.buckets[0].label} to ${drift.buckets[drift.buckets.length - 1].label}.` : undefined}
          footnote={drift.basis ? `${DRIFT_NOTES[drift.basis]} Shares are of genre tags, so a game with two genres counts in both.` : undefined}
        >
          {drift.basis ? (
            <TasteDrift series={drift.series} buckets={drift.buckets} />
          ) : (
            <LockedState message="Not enough history to show a drift yet." detail="This needs at least six genre-tagged games spread across three periods. It fills in as you keep tracking." />
          )}
        </StatCard>
      </Reveal>

      {hoursStatus !== "unavailable" && (
        <Reveal className="md:col-span-2 lg:col-span-7">
          <StatCard
            className="h-full"
            eyebrow="Hours by platform"
            icon={<Clock3 size={13} />}
            title="Where your time goes"
            summary={hoursReady && hours.byPlatform.length ? `Estimated hours: ${hours.byPlatform.map((row) => `${row.label} ${row.finished + row.inProgress}`).join(", ")}.` : undefined}
            footnote={hoursReady ? hoursFootnote(hours.withData, hours.eligible) : undefined}
          >
            {!hoursReady ? (
              <div className="space-y-3" aria-label="Loading hours"><Skeleton className="h-14 rounded-2xl" />{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 rounded-xl" />)}</div>
            ) : hours.byPlatform.length ? (
              <HoursByPlatform rows={hours.byPlatform} />
            ) : (
              <LockedState
                message={hours.eligible ? "IGDB has no time-to-beat data for these games yet." : "Mark games as Playing or Played to see where your hours go."}
                detail="Hours come from IGDB's player-submitted completion times, never from a guess."
                href="/library"
                cta="Open your library"
              />
            )}
          </StatCard>
        </Reveal>
      )}

      <Reveal delay={0.04} className={cn(hoursStatus === "unavailable" ? "md:col-span-2 lg:col-span-12" : "md:col-span-2 lg:col-span-5")}>
        <StatCard
          className="h-full"
          eyebrow="Platform split"
          icon={<Disc3 size={13} />}
          title="Where you own games"
          footnote={platformSplit.length ? "Counts copies: a game owned on two platforms appears in both." : undefined}
        >
          {platformSplit.length ? (
            <PlatformDonut slices={platformSplit} ownedGames={analytics.ownedGames} />
          ) : (
            <LockedState message="Mark where you own games to see your platform split." href="/library" cta="Open your library" />
          )}
        </StatCard>
      </Reveal>

      <Reveal className="lg:col-span-4">
        <StatCard
          className="h-full"
          eyebrow="Critic scores"
          icon={<Star size={13} />}
          title="You vs. the catalogue"
          summary={critic.average !== null ? `Average critic score ${critic.average} across ${critic.scored} games${benchmark ? `, against a catalogue benchmark of ${benchmark.average}` : ""}.` : undefined}
          footnote={critic.average !== null ? criticFootnote(critic.basis, critic.scored, critic.considered, benchmark) : undefined}
        >
          {critic.average !== null ? (
            <CriticCompare critic={critic} benchmark={benchmark} />
          ) : (
            <LockedState message="None of your games has a critic score yet." detail="Scores arrive with each game's IGDB record. Released, well-known games almost always have one." />
          )}
        </StatCard>
      </Reveal>

      <Reveal delay={0.04} className="lg:col-span-4">
        <StatCard
          className="h-full"
          eyebrow="Status funnel"
          icon={<Gauge size={13} />}
          title="From wishlist to finished"
          summary={`${funnel.stages.map((stage) => `${stage.label}: ${stage.value}`).join(", ")}.`}
        >
          {funnel.stages[0].value ? (
            <StatusFunnel stages={funnel.stages} counts={funnel} />
          ) : (
            <LockedState message="Give your games a status to build this funnel." detail="Want to play, Playing and Played each move a game one step along." href="/library" cta="Open your library" />
          )}
        </StatCard>
      </Reveal>

      <Reveal delay={0.08} className="md:col-span-2 lg:col-span-4">
        <StatCard
          className="h-full"
          eyebrow="Release eras"
          icon={<CalendarRange size={13} />}
          title="When your games came out"
          footnote={analytics.undatedGames ? `${plural(analytics.undatedGames, "game")} without a release year ${analytics.undatedGames === 1 ? "is" : "are"} left out.` : undefined}
        >
          {eras.length >= 2 ? (
            <EraHistogram eras={eras} total={analytics.totalGames} undated={analytics.undatedGames} />
          ) : (
            <LockedState
              message={eras.length ? "All your games come from the same decade so far." : "Release years will build this view."}
              detail="A histogram needs games from at least two decades."
            />
          )}
        </StatCard>
      </Reveal>

      <Reveal className="md:col-span-2 lg:col-span-12">
        <details className="group rounded-[1.75rem] border border-line bg-fg/[0.02] px-5 py-4 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
            <span className="flex items-center gap-2"><Layers3 size={15} className="text-brand-soft" aria-hidden /> How these numbers are calculated</span>
            <ArrowRight size={15} className="text-muted transition-transform group-open:rotate-90" aria-hidden />
          </summary>
          <ul className="mt-4 grid gap-3 text-xs leading-relaxed text-muted sm:grid-cols-2">
            <li>Every figure comes from your own library records. A game counts once however many copies you own.</li>
            <li>Hours use IGDB&apos;s player-submitted &ldquo;normally&rdquo; completion time (or &ldquo;hastily&rdquo; when that&apos;s all there is). Played games count in full, games in progress count half; games with no data count nothing.</li>
            <li>Your backlog is owned, released games you haven&apos;t finished, including the unplayed half of games in progress.</li>
            <li>The catalogue benchmark is the mean IGDB critic score of the most-rated scored games: the kind of game a library is made of, not every obscure record.</li>
          </ul>
          <Link href="/library" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-soft hover:underline">Edit your library <ArrowRight size={12} aria-hidden /></Link>
        </details>
      </Reveal>
    </div>
  );
}

function HeroTile({ label, value, note, format }: { label: string; value: number; note?: string; format?: (value: number) => string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-fg/[0.04] p-3">
      <dt className="truncate text-[11px] font-medium text-muted">{label}</dt>
      <dd className="mt-1">
        <CountUp value={value} format={format} className="font-display text-2xl font-bold" />
        {note && <span className="block truncate text-[10px] text-faint">{note}</span>}
      </dd>
    </div>
  );
}

function BacklogLine({ status, hours, unfinished }: { status: HoursStatus; hours: PersonalAnalytics["hours"]; unfinished: number }) {
  if (status === "loading") {
    return <div className="mt-auto rounded-2xl bg-fg/[0.04] p-4"><Skeleton className="h-3 w-24 rounded" /><Skeleton className="mt-3 h-7 w-40 rounded" /></div>;
  }
  if (status === "ready" && hours.available && hours.backlog > 0) {
    return (
      <div className="mt-auto rounded-2xl bg-fg/[0.04] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Backlog</p>
        <p className="mt-1 text-sm leading-snug text-muted">
          You&apos;d need about <CountUp value={hours.backlog} format={formatHours} className="font-display text-2xl font-bold text-text" /> to clear it.
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
          {plural(hours.backlogGames, "unstarted game")} plus the remaining half of what you&apos;re playing. {hoursFootnote(hours.withData, hours.eligible)}
        </p>
      </div>
    );
  }
  if (unfinished === 0) {
    return (
      <div className="mt-auto rounded-2xl bg-mint/[0.08] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Backlog</p>
        <p className="mt-1 text-sm text-muted"><span className="font-semibold text-text">Clear.</span> Every owned, released game is marked played.</p>
      </div>
    );
  }
  return (
    <div className="mt-auto rounded-2xl bg-fg/[0.04] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Backlog</p>
      <p className="mt-1 text-sm text-muted"><span className="font-display text-2xl font-bold text-text">{unfinished}</span> owned {unfinished === 1 ? "game" : "games"} not finished yet.</p>
    </div>
  );
}

function hoursFootnote(withData: number, eligible: number): string {
  if (!eligible) return "Estimates from IGDB time-to-beat.";
  return withData === eligible
    ? `Estimated from IGDB time-to-beat for all ${plural(eligible, "game")}.`
    : `Estimated from IGDB time-to-beat for ${withData} of ${plural(eligible, "game")}; the rest have no data and count nothing.`;
}

function criticFootnote(basis: "owned" | "library", scored: number, considered: number, benchmark: CatalogueBenchmark | null): string {
  const subject = basis === "owned" ? "games you own" : "games in your library (fewer than three owned games have a score)";
  const base = `IGDB critic scores for ${scored} of ${considered} ${subject}.`;
  return benchmark
    ? `${base} Benchmark: the average of the ${benchmark.sample} most-rated scored games on IGDB.`
    : `${base} The catalogue benchmark is unavailable right now.`;
}
