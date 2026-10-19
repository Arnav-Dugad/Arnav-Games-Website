import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { CountdownInline } from "@/components/game/Countdown";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { WatchButton } from "@/components/game/WatchButton";
import { HypeBadge } from "@/components/game/ReleaseTimeline";
import { DAY_MONTH, WEEKDAY_LONG, WEEKDAY_SHORT, utcDate, type ReleaseSignals } from "../_lib/calendar";
import { Container } from "@/components/ui/SectionHeading";
import type { GameSummary } from "@/lib/games/types";

/**
 * The calendar's one hero: what launches in the next seven days.
 *
 * The most anticipated release leads as a wide card over its own key art;
 * the rest follow as posters in a rail, each tagged with its day. The list
 * arrives hype-ranked from the server, and the lead keeps that rank while the
 * rail re-sorts by day — "what's biggest" first, then "what's next".
 *
 * Server-rendered: only the follow buttons and countdowns hydrate.
 */
export function ThisWeek({
  games,
  signals,
  title,
  rangeLabel,
  weekHref,
}: {
  games: GameSummary[];
  signals: ReleaseSignals;
  title: string;
  rangeLabel: string;
  weekHref: string;
}) {
  if (games.length === 0) return null;
  const [lead, ...rest] = games;
  const rail = [...rest].sort((a, b) => (a.released ?? "").localeCompare(b.released ?? ""));

  return (
    <section aria-labelledby="this-week-title" className="pb-4 pt-2 sm:pb-6">
      <Container className="mb-4 flex items-end justify-between gap-4 sm:mb-5">
        <div className="min-w-0">
          <h2 id="this-week-title" className="font-display text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">{title}</h2>
          <p className="mt-0.5 text-[13px] text-muted sm:text-[15px]">
            {games.length} notable {games.length === 1 ? "release" : "releases"} · {rangeLabel}
          </p>
        </div>
        <Link
          href={weekHref}
          className="press inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-full text-[15px] font-medium text-brand-soft fine:hover:text-text"
        >
          Week view
          <ChevronRight size={17} aria-hidden />
        </Link>
      </Container>

      <ul className="snap-rail rail-gutter items-start gap-3 pb-2 sm:gap-4">
        <li>
          <LeadCard game={lead} hype={signals[lead.id]?.hype} delays={signals[lead.id]?.delays} />
        </li>
        {rail.map((game) => (
          <li key={game.id} className="w-[132px] sm:w-[164px]">
            <PosterCard game={game} hype={signals[game.id]?.hype} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DayChip({ released, long = false }: { released: string | null; long?: boolean }) {
  if (!released) return null;
  const date = utcDate(released);
  return (
    <span className="material-thin inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-white">
      {long ? WEEKDAY_LONG.format(date) : WEEKDAY_SHORT.format(date)}
      <span className="font-medium text-white/70 tabular-nums">{long ? DAY_MONTH.format(date) : date.getUTCDate()}</span>
    </span>
  );
}

function LeadCard({ game, hype, delays }: { game: GameSummary; hype?: number; delays?: number }) {
  const art = game.screenshots[0] ?? null;
  return (
    <article
      data-stage="dark"
      data-release-date={game.released ?? ""}
      className="relative isolate h-[176px] w-[min(82vw,520px)] overflow-hidden rounded-[22px] bg-panel text-white shadow-[0_24px_60px_-30px_rgba(0,0,0,0.9)] ring-1 ring-inset ring-white/10 sm:h-[219px]"
    >
      <Link href={`/game/${game.slug}`} className="absolute inset-0 -z-10" aria-label={game.name}>
        <GameCover
          name={game.name}
          slug={game.slug}
          image={art ?? game.image}
          imageFallback={art ? game.image : game.imageFallback}
          width={720}
          sizes="(max-width: 640px) 82vw, 520px"
          className="object-cover"
          priority
        />
      </Link>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-[5] bg-gradient-to-t from-black/90 via-black/40 to-black/5" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <DayChip released={game.released} long />
        <WatchButton game={game} compact className="pointer-events-auto" />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4 sm:p-5">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-white/70">Most anticipated</p>
        <h3 className="mt-1 line-clamp-2 font-display text-[22px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[26px]">{game.name}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-white/80">
          {game.released && <CountdownInline date={game.released} />}
          <PlatformIcons platforms={game.parentPlatforms} size={13} max={4} />
          {hype !== undefined && <HypeBadge value={hype} className="bg-black/40 text-[#ffd60a]" />}
          {delays ? <span className="text-[12px] font-semibold text-[#ff6b86]">Delayed {delays}×</span> : null}
        </div>
      </div>
    </article>
  );
}

function PosterCard({ game, hype }: { game: GameSummary; hype?: number }) {
  return (
    <article data-release-date={game.released ?? ""} className="group">
      <div data-stage="dark" className="relative h-[176px] overflow-hidden rounded-[18px] bg-panel shadow-[0_18px_40px_-26px_rgba(0,0,0,0.9)] ring-1 ring-inset ring-fg/10 sm:h-[219px]">
        <Link href={`/game/${game.slug}`} aria-label={game.name} className="absolute inset-0">
          <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={330} sizes="(max-width: 640px) 132px, 164px" />
        </Link>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2">
          <DayChip released={game.released} />
          <WatchButton game={game} compact className="pointer-events-auto" />
        </div>
      </div>
      <Link href={`/game/${game.slug}`} className="mt-2 block line-clamp-2 text-[13px] font-semibold leading-snug fine:group-hover:text-brand-soft sm:text-[14px]">
        {game.name}
      </Link>
      {hype !== undefined && <HypeBadge value={hype} className="mt-1" />}
    </article>
  );
}
