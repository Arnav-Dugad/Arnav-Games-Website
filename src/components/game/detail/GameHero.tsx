import Link from "next/link";
import { ArrowLeft, CalendarDays, ExternalLink, Globe, MapPin, Star } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { GameLogo } from "@/components/game/GameLogo";
import { Countdown } from "@/components/game/Countdown";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { BackdropTrailer } from "@/components/game/BackdropTrailer";
import { StudioCredit } from "@/components/game/GameEntities";
import { OwnershipPicker } from "@/components/game/OwnershipPicker";
import { SubscriptionAccessPicker } from "@/components/game/SubscriptionAccessPicker";
import { StatusPicker } from "@/components/game/StatusPicker";
import { WatchButton } from "@/components/game/WatchButton";
import { SaveButton } from "@/components/game/SaveButton";
import { CoverTransition } from "@/components/interactions/CoverTransition";
import { ScorePill } from "@/components/ui/ScoreRing";
import { Badge, Chip } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { TextReveal } from "@/components/motion/text";
import { Parallax } from "@/components/motion/effects";
import { GridLines } from "@/components/motion/Aurora";
import { formatLongDate, relativeRelease } from "@/lib/utils/format";
import type { GameDetail } from "@/lib/games/types";
import { DelayBadge } from "./ReleaseDates";
import { DARK_STAGE_STYLE } from "./theme";
import type { LocalRelease } from "./release";

/**
 * The game page's opening stage.
 *
 * Key art fills the frame with the trailer dissolving in over it; the
 * official logo is the title treatment, the way a keynote introduces a game.
 * The heading still carries the plain name for search and screen readers —
 * the logo image itself is decorative inside it.
 *
 * Always a dark surface (see `DARK_STAGE_STYLE`): logos are mostly white
 * marks drawn for dark art, and the light theme takes over below the fold.
 */
export function GameHero({
  game,
  local,
  delays,
  showCountdown,
  criticLabel,
}: {
  game: GameDetail;
  local: LocalRelease;
  delays: number;
  showCountdown: boolean;
  criticLabel: string;
}) {
  const franchise = game.franchises[0] ?? game.series[0];
  const backdrop = game.artworks[0] ?? game.screenshots[0] ?? game.image;
  const dateLabel = local.date ? formatLongDate(local.date) : game.releaseWindow ?? "Release date to be announced";

  return (
    <header data-stage="dark" style={DARK_STAGE_STYLE} className="noise relative isolate overflow-hidden bg-bg text-text">
      <div className="absolute inset-0 -z-10">
        <Parallax distance={40} scale className="h-full w-full">
          <GameCover
            name={game.name}
            slug={game.slug}
            image={backdrop}
            imageFallback={game.imageFallback}
            width={1920}
            priority
            sizes="100vw"
            rounded="rounded-none"
          />
        </Parallax>

        {/* The trailer dissolves in over the key art, muted and chrome-free.
            Sits under the scrims so the title never loses contrast. */}
        <BackdropTrailer trailer={game.trailers[0] ?? game.heroTrailer} />

        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/80 to-bg/40" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/70 to-transparent lg:via-bg/40" />
        {/* The cover's own colour, washed in from the corner: each game's page
            opens in its own light. */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_12%_100%,color-mix(in_oklab,var(--game-tint)_90%,transparent)_0%,transparent_58%)] opacity-90" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_10%,var(--game-glow),transparent_55%)] opacity-50 mix-blend-screen" />
        <GridLines className="opacity-15" />
      </div>

      <Container className="flex min-h-[680px] flex-col justify-end pb-9 pt-24 sm:min-h-[740px] lg:min-h-[800px] lg:pb-14 lg:pt-32">
        <Reveal>
          <div className="mb-7 flex flex-wrap items-center gap-2 text-xs text-white/60">
            <Link
              href="/browse"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-3 backdrop-blur-md transition-colors hover:border-white/20 hover:text-white"
            >
              <ArrowLeft size={13} />
              Browse
            </Link>
            {franchise && (
              <Link
                href={`/franchise/${franchise.slug}`}
                className="inline-flex min-h-9 items-center rounded-full border border-white/10 bg-black/25 px-3 backdrop-blur-md transition-colors hover:border-[var(--game-accent)] hover:text-white"
              >
                {franchise.name} franchise
              </Link>
            )}
          </div>
        </Reveal>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-9 lg:gap-12">
          <div className="flex items-end gap-4 sm:gap-8">
            <Reveal direction="right" className="relative w-36 shrink-0 sm:w-48 lg:w-64">
              {/* A soft halo in the cover's own colour. */}
              <span aria-hidden className="absolute -inset-6 rounded-[2.5rem] bg-[var(--game-glow)] opacity-80 blur-2xl" />
              <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/20 bg-panel shadow-[0_35px_90px_-30px_rgba(0,0,0,0.95)]">
                <CoverTransition slug={game.slug} role="target">
                  <GameCover
                    name={game.name}
                    slug={game.slug}
                    image={game.image}
                    imageFallback={game.imageFallback}
                    width={720}
                    sizes="(max-width: 640px) 144px, (max-width: 1024px) 192px, 256px"
                    priority
                  />
                </CoverTransition>
                <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-white/[0.08]" />
              </div>
            </Reveal>

            {game.parentPlatforms.length > 0 && (
              <Reveal delay={0.08} className="shrink-0 self-end pb-1">
                <ul className="flex flex-col gap-2 sm:gap-2.5">
                  {game.parentPlatforms.slice(0, 5).map((platform) => (
                    <li
                      key={platform.id}
                      title={platform.name}
                      className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.06] backdrop-blur-md sm:h-10 sm:w-10 lg:h-11 lg:w-11"
                    >
                      <PlatformIcons platforms={[platform]} size={17} max={1} tinted />
                    </li>
                  ))}
                </ul>
              </Reveal>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <Reveal className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
              {game.genres.slice(0, 3).map((genre) => (
                <Chip key={genre.id} href={`/browse?genres=${genre.slug}`}>
                  {genre.name}
                </Chip>
              ))}
              {game.esrb && <Badge tone="neutral">{game.esrb}</Badge>}
            </Reveal>

            {game.logo ? (
              <Reveal delay={0.04} blur={false}>
                <h1 className="max-w-[min(100%,34rem)]">
                  <span className="sr-only">{game.name}</span>
                  <span aria-hidden className="block">
                    <GameLogo
                      name={game.name}
                      logo={game.logo}
                      priority
                      height="clamp(4.5rem, 13vw, 9.5rem)"
                      // The stage stays dark in the light theme too.
                      surface="dark"
                      className="max-h-[9.5rem] drop-shadow-[0_10px_40px_rgba(0,0,0,0.55)]"
                    />
                  </span>
                </h1>
              </Reveal>
            ) : (
              <TextReveal
                as="h1"
                text={game.name}
                className="max-w-4xl font-display text-[clamp(2.25rem,7vw,5.5rem)] font-black leading-[0.94] tracking-[-0.055em] text-white [text-shadow:0_10px_50px_rgba(0,0,0,0.45)]"
              />
            )}

            <Reveal delay={0.1} className="mt-4">
              <StudioCredit developers={game.developers} publishers={game.publishers} />
            </Reveal>

            <Reveal delay={0.14} className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2.5">
              {game.metacritic !== null && (
                <a href="#glance" className="flex items-center gap-2">
                  <ScorePill score={game.metacritic} />
                  <span className="text-xs text-faint">{criticLabel}</span>
                </a>
              )}
              {game.rating > 0 && (
                <span className="flex items-center gap-1.5 text-sm text-muted">
                  <Star size={14} className="fill-gold text-gold" />
                  <span className="font-semibold tabular-nums text-text">{game.rating.toFixed(1)}</span>
                  <span className="text-faint">/5</span>
                </span>
              )}
              <span className="flex items-center gap-2 text-sm text-muted">
                <CalendarDays size={15} className="text-faint" />
                {dateLabel}
              </span>
              {local.date && (
                <span className="inline-flex items-center rounded-full border border-[color-mix(in_oklab,var(--game-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--game-accent)_16%,transparent)] px-2.5 py-1 text-[11px] font-semibold leading-none text-[var(--game-accent)]">
                  {relativeRelease(local.date)}
                </span>
              )}
              <DelayBadge count={delays} />
            </Reveal>
            {local.region && local.countryName && (
              <Reveal delay={0.16} className="mt-2">
                <p className="flex items-center gap-1.5 text-xs text-faint">
                  <MapPin size={12} />
                  {local.differs ? `Your date in ${local.countryName} (${local.region})` : `Dated for ${local.countryName} · ${local.region}`}
                </p>
              </Reveal>
            )}

            {showCountdown && local.date && (
              <Reveal delay={0.18}>
                <Countdown date={local.date} className="mt-5" celebrate />
              </Reveal>
            )}
          </div>
        </div>

        {/* Actions span the full width rather than sharing the narrow title
            column, which on a phone left no room for two buttons side by side.
            Below 360px the pair also tightens, or "Save game" / "Follow game"
            broke onto two lines. */}
        <Reveal delay={0.24} className="mt-7 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          <SaveButton game={game} className="w-full justify-center sm:w-auto max-[359px]:px-3" />
          <WatchButton game={game} variant="full" className="w-full px-4 sm:w-auto sm:px-6 max-[359px]:px-3 max-[359px]:text-[14px]" />
          <StatusPicker game={game} className="col-span-2 sm:col-span-1" />
          <OwnershipPicker game={game} className="[&>button]:w-full [&>button]:justify-center sm:[&>button]:w-auto" />
          <SubscriptionAccessPicker game={game} className="[&>button]:w-full [&>button]:justify-center sm:[&>button]:w-auto" />
          {game.website && (
            <Button
              href={game.website}
              external
              variant="outline"
              icon={<Globe size={16} />}
              iconRight={<ExternalLink size={13} />}
              className="w-full border-white/15 bg-white/[0.08] backdrop-blur-xl sm:w-auto"
            >
              Official site
            </Button>
          )}
          <Button href="#reviews" variant="ghost" icon={<Star size={16} />} className="w-full sm:w-auto">
            Rate this game
          </Button>
        </Reveal>
      </Container>
    </header>
  );
}
