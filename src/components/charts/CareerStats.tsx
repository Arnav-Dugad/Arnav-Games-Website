import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, CalendarClock, CalendarRange, Layers3, Repeat2, Sparkles, Trophy } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { Countdown, CountdownInline } from "@/components/game/Countdown";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils/cn";
import { releaseLabelLong, releaseYear } from "@/lib/utils/format";
import { cadenceLabel, type CareerSummary } from "@/lib/games/timeline";
import type { GameSummary } from "@/lib/games/types";

/**
 * Career / series stats bento.
 *
 * Server-rendered from `summarizeCareer`, so every figure is in the first
 * paint; only the countdown ticks on the client. Each tile is honest about
 * its population — the average says how many scored games it covers, the
 * span counts released games only — because a studio with 400 credits and 30
 * critic scores should not read as if all 400 were reviewed.
 *
 * Layout: the best-reviewed game is the hero tile (cover art does the
 * talking), four compact figures fill the right, and the latest / next
 * releases close the grid. Phones keep two columns with the hero and the two
 * release tiles spanning full width.
 */
export function CareerStats({
  summary,
  kind,
}: {
  summary: CareerSummary;
  kind: "company" | "character" | "franchise";
}) {
  const {
    total,
    releasedCount,
    firstRelease,
    latestRelease,
    activeYears,
    averageScore,
    scoredCount,
    bestReviewed,
    nextUpcoming,
    upcomingCount,
    cadenceDays,
    busiestYear,
  } = summary;

  const firstYear = releaseYear(firstRelease?.released);
  const latestYear = releaseYear(latestRelease?.released);
  const cadence = cadenceDays !== null ? cadenceLabel(cadenceDays) : null;
  const noun = kind === "company" ? "Catalogue" : kind === "franchise" ? "Series" : "Appearances";

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {bestReviewed ? (
        <BestReviewed game={bestReviewed} className="col-span-2 lg:row-span-2" />
      ) : (
        <Tile className="col-span-2 lg:row-span-2" icon={<Trophy size={16} />} label="Best reviewed">
          <p className="mt-auto text-sm leading-relaxed text-muted">
            None of these games has a critic score on IGDB yet.
          </p>
        </Tile>
      )}

      <Tile icon={<Layers3 size={16} />} label={noun} delay={0.04}>
        <Figure value={String(total)} unit={total === 1 ? "game" : "games"} />
        <Note>
          {releasedCount} released{upcomingCount > 0 && ` · ${upcomingCount} upcoming`}
        </Note>
      </Tile>

      <Tile icon={<CalendarRange size={16} />} label="Active years" delay={0.08}>
        {firstRelease && latestRelease ? (
          <>
            <Figure value={firstYear} unit={firstYear === latestYear ? undefined : `to ${latestYear}`} />
            <Note>
              {activeYears === 1 ? "A single year" : `${activeYears} years, first to latest`}
            </Note>
          </>
        ) : (
          <Empty>No dated releases yet</Empty>
        )}
      </Tile>

      <Tile icon={<Sparkles size={16} />} label="Avg. critic score" delay={0.12}>
        {averageScore !== null ? (
          <div className="mt-auto flex items-end justify-between gap-2">
            <div className="min-w-0">
              <Figure value={String(averageScore)} unit="/ 100" />
              <Note>
                across {scoredCount} scored {scoredCount === 1 ? "game" : "games"}
              </Note>
            </div>
            {/* `cn` has no tailwind-merge, so `hidden` can't override ScoreRing's own `inline-flex`; a wrapper can. */}
            <span className="hidden shrink-0 sm:block">
              <ScoreRing score={averageScore} size={46} strokeWidth={4} label="Average critic score" />
            </span>
          </div>
        ) : (
          <Empty>No critic scores yet</Empty>
        )}
      </Tile>

      <Tile icon={<Repeat2 size={16} />} label="Release cadence" delay={0.16}>
        {cadence ? (
          <>
            <Figure value={cadence.value} unit={cadence.unit} prefix="every" />
            <Note>
              {busiestYear ? `Busiest: ${busiestYear.year}, ${busiestYear.count} releases` : "average gap between releases"}
            </Note>
          </>
        ) : (
          <Empty>Needs two or more releases</Empty>
        )}
      </Tile>

      <ReleaseTile
        game={latestRelease}
        label="Latest release"
        icon={<CalendarClock size={16} />}
        empty="Nothing released yet"
        delay={0.2}
      />
      <ReleaseTile
        game={nextUpcoming}
        label="Next up"
        icon={<CalendarClock size={16} />}
        // TBA titles count as upcoming but have nothing to count down to.
        empty={upcomingCount > 0 ? `${upcomingCount} announced, no dates yet` : "Nothing announced"}
        upcoming
        delay={0.24}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function Tile({
  icon,
  label,
  children,
  className,
  delay = 0,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className={cn("glass flex min-h-[124px] min-w-0 flex-col rounded-3xl p-3.5 sm:min-h-[132px] sm:p-5", className)}>
      <p className="mb-3 flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium text-muted sm:gap-2">
        <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-fg/[0.07] text-brand-soft sm:h-7 sm:w-7">
          {icon}
        </span>
        {label}
      </p>
      {children}
    </Reveal>
  );
}

function Figure({ value, unit, prefix }: { value: string; unit?: string; prefix?: string }) {
  return (
    <p className="mt-auto flex flex-wrap items-baseline gap-x-1.5 font-display leading-none text-text">
      {prefix && <span className="text-[13px] font-medium text-muted">{prefix}</span>}
      <span className="text-[28px] font-bold tracking-[-0.03em] sm:text-[32px]">{value}</span>
      {unit && <span className="text-[13px] font-medium text-muted">{unit}</span>}
    </p>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-[12px] leading-snug text-faint">{children}</p>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="mt-auto text-[13px] text-faint">{children}</p>;
}

function BestReviewed({ game, className }: { game: GameSummary; className?: string }) {
  return (
    <Reveal className={cn("min-w-0", className)}>
      <Link
        href={`/game/${game.slug}`}
        className="group glass relative isolate flex h-full min-h-[180px] gap-4 overflow-hidden rounded-3xl p-4 transition-colors sm:gap-5 sm:p-5 fine:hover:border-fg/20"
      >
        {/* Cover bleeds through as a blurred wash — the tile takes the game's colour. */}
        <div aria-hidden className="absolute inset-0 -z-10 scale-125 opacity-30 blur-3xl saturate-150">
          <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={160} sizes="160px" />
        </div>
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-bg/30 via-bg/50 to-bg/70" />

        <div className="relative aspect-[3/4] w-[92px] shrink-0 self-center overflow-hidden rounded-2xl shadow-[0_24px_50px_-20px_rgba(0,0,0,0.9)] light:shadow-[0_18px_36px_-20px_rgba(0,0,0,0.4)] ring-1 ring-fg/15 transition-transform duration-500 ease-[var(--ease-apple)] sm:w-[124px] lg:w-[150px] fine:group-hover:scale-[1.03]">
          <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={300} sizes="150px" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <p className="flex items-center gap-2 text-[12px] font-medium text-muted">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-gold/15 text-gold">
              <Trophy size={15} />
            </span>
            Best reviewed
          </p>
          <h3 className="mt-3 line-clamp-3 text-[19px] font-bold leading-tight text-text sm:text-2xl lg:text-[28px]">
            {game.name}
          </h3>
          <p className="mt-1.5 text-[12.5px] text-muted">{releaseLabelLong(game)}</p>
          <div className="mt-auto flex items-end justify-between gap-3 pt-4">
            <ScoreRing score={game.metacritic} size={58} strokeWidth={4.5} label="Critic score" />
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-medium text-brand-soft">
              <span className="hidden min-[360px]:inline">View game</span>
              <ArrowUpRight size={14} className="transition-transform duration-300 fine:group-hover:-translate-y-0.5 fine:group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </Link>
    </Reveal>
  );
}

function ReleaseTile({
  game,
  label,
  icon,
  empty,
  upcoming = false,
  delay = 0,
}: {
  game: GameSummary | null;
  label: string;
  icon: ReactNode;
  empty: string;
  upcoming?: boolean;
  delay?: number;
}) {
  if (!game) {
    return (
      <Tile icon={icon} label={label} className="col-span-2 min-h-0" delay={delay}>
        <Empty>{empty}</Empty>
      </Tile>
    );
  }

  return (
    <Reveal delay={delay} className="col-span-2 min-w-0">
      <Link
        href={`/game/${game.slug}`}
        className="press group glass flex h-full min-w-0 items-center gap-4 rounded-3xl p-3.5 transition-colors sm:p-4 fine:hover:border-fg/20"
      >
        <div className="relative aspect-[3/4] w-14 shrink-0 overflow-hidden rounded-xl ring-1 ring-fg/10 sm:w-16">
          <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={128} sizes="64px" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <span aria-hidden className={upcoming ? "text-neon" : "text-brand-soft"}>{icon}</span>
            {label}
          </p>
          <p className="mt-1 truncate text-[15px] font-semibold text-text sm:text-base">{game.name}</p>
          <p className="mt-0.5 text-[12px] text-faint">
            {releaseLabelLong(game)}
            {/* Phones get the compact form; the four-box timer would crush the title. */}
            {upcoming && game.released && (
              <span className="text-neon sm:hidden">
                {" · "}
                <CountdownInline date={game.released} />
              </span>
            )}
          </p>
        </div>
        {upcoming && game.released && (
          <Countdown date={game.released} size="sm" className="hidden shrink-0 sm:flex" />
        )}
        <ArrowUpRight aria-hidden size={16} className="shrink-0 text-faint transition-colors fine:group-hover:text-text" />
      </Link>
    </Reveal>
  );
}
