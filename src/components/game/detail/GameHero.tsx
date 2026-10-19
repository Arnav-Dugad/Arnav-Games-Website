import Link from "next/link";
import { ArrowLeft, CalendarDays, ExternalLink, MapPin, Star } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { GameLogo } from "@/components/game/GameLogo";
import { Countdown } from "@/components/game/Countdown";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { BackdropTrailer } from "@/components/game/BackdropTrailer";
import { OwnershipPicker } from "@/components/game/OwnershipPicker";
import { SubscriptionAccessPicker } from "@/components/game/SubscriptionAccessPicker";
import { StatusPicker } from "@/components/game/StatusPicker";
import { WatchButton } from "@/components/game/WatchButton";
import { SaveButton } from "@/components/game/SaveButton";
import { GAME_HERO_ID } from "@/components/game/GameDetailDock";
import type { PickedGame } from "@/components/compare/GamePickerSheet";
import { CoverTransition } from "@/components/interactions/CoverTransition";
import { ScorePill } from "@/components/ui/ScoreRing";
import { Container } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { TextReveal } from "@/components/motion/text";
import { Parallax } from "@/components/motion/effects";
import { formatLongDate, relativeRelease } from "@/lib/utils/format";
import type { GameDetail } from "@/lib/games/types";
import { CompareButton } from "./CompareButton";
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
 * It answers the three questions people arrive with, in order — what is it
 * (logo, genre, studio), is it out / is it good (date, countdown, scores) —
 * and offers one primary action, Follow. Everything personal (status,
 * ownership, subscriptions) sits in a quieter second row, and the rest of
 * the facts live in "At a glance" below rather than being repeated here.
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
  compareSuggestions,
}: {
  game: GameDetail;
  local: LocalRelease;
  delays: number;
  showCountdown: boolean;
  criticLabel: string;
  compareSuggestions: PickedGame[];
}) {
  const franchise = game.franchises[0] ?? game.series[0];
  const backdrop = game.artworks[0] ?? game.screenshots[0] ?? game.image;
  const dateLabel = local.date ? formatLongDate(local.date) : game.releaseWindow ?? "Release date to be announced";
  const studio = game.developers[0]?.name ?? game.publishers[0]?.name ?? null;
  const kicker = [game.genres.slice(0, 2).map((genre) => genre.name).join(" · "), studio].filter(Boolean).join("  ·  ");

  return (
    <header
      id={GAME_HERO_ID}
      data-stage="dark"
      style={DARK_STAGE_STYLE}
      className="noise relative isolate overflow-hidden bg-bg text-text"
    >
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

        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/75 to-bg/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg/90 via-bg/45 to-transparent" />
        {/* The cover's own colour, washed in from the corner: each game's page
            opens in its own light. */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_12%_100%,color-mix(in_oklab,var(--game-tint)_90%,transparent)_0%,transparent_58%)] opacity-90" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_10%,var(--game-glow),transparent_55%)] opacity-40 mix-blend-screen" />
      </div>

      <Container className="flex min-h-[600px] flex-col justify-end pb-8 pt-24 sm:min-h-[680px] lg:min-h-[760px] lg:pb-12 lg:pt-32">
        <Reveal>
          <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-xs text-white/65 sm:mb-8">
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
                {franchise.name}
              </Link>
            )}
          </nav>
        </Reveal>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-9 lg:gap-12">
          <Reveal direction="right" className="relative w-28 shrink-0 sm:w-44 lg:w-56">
            {/* A soft halo in the cover's own colour. */}
            <span aria-hidden className="absolute -inset-6 rounded-[2.5rem] bg-[var(--game-glow)] opacity-70 blur-2xl" />
            <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/20 bg-panel shadow-[0_35px_90px_-30px_rgba(0,0,0,0.95)]">
              <CoverTransition slug={game.slug} role="target">
                <GameCover
                  name={game.name}
                  slug={game.slug}
                  image={game.image}
                  imageFallback={game.imageFallback}
                  width={720}
                  sizes="(max-width: 640px) 112px, (max-width: 1024px) 176px, 224px"
                  priority
                />
              </CoverTransition>
              <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-white/[0.08]" />
            </div>
          </Reveal>

          <div className="min-w-0 flex-1">
            {kicker && (
              <Reveal>
                <p className="mb-3 truncate text-[13px] font-semibold text-white/70 sm:text-sm">{kicker}</p>
              </Reveal>
            )}

            {game.logo ? (
              // The logo plays its own one-time slice reveal (a light sweeping
              // across the mark), so it isn't also wrapped in a fade.
              <div>
                <h1 className="max-w-[min(100%,36rem)]">
                  <span className="sr-only">{game.name}</span>
                  <span aria-hidden className="block">
                    <GameLogo
                      name={game.name}
                      logo={game.logo}
                      priority
                      height="clamp(4.25rem, 12vw, 9rem)"
                      // The stage stays dark in the light theme too.
                      surface="dark"
                      reveal
                      className="max-h-[9rem] drop-shadow-[0_10px_40px_rgba(0,0,0,0.55)]"
                    />
                  </span>
                </h1>
              </div>
            ) : (
              <TextReveal
                as="h1"
                text={game.name}
                className="max-w-4xl font-display text-[clamp(2.25rem,7vw,5.25rem)] font-black leading-[0.95] tracking-[-0.05em] text-white [text-shadow:0_10px_50px_rgba(0,0,0,0.45)]"
              />
            )}

            <Reveal delay={0.12} className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5 text-sm text-white/75">
              {game.metacritic !== null && (
                <a href="#overview" className="flex items-center gap-2" aria-label={`${criticLabel} ${game.metacritic}`}>
                  <ScorePill score={game.metacritic} />
                  <span className="text-xs text-white/55">{criticLabel}</span>
                </a>
              )}
              {game.rating > 0 && (
                <a href="#reviews" className="flex items-center gap-1.5" aria-label={`Rated ${game.rating.toFixed(1)} out of 5 — see reviews`}>
                  <Star size={14} className="fill-gold text-gold" />
                  <span className="font-semibold tabular-nums text-white">{game.rating.toFixed(1)}</span>
                  <span className="text-white/50">/5</span>
                </a>
              )}
              <span className="flex items-center gap-2">
                <CalendarDays size={15} className="text-white/50" />
                {dateLabel}
              </span>
              {local.date && (
                <span className="inline-flex items-center rounded-full border border-[color-mix(in_oklab,var(--game-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--game-accent)_16%,transparent)] px-2.5 py-1 text-[11px] font-semibold leading-none text-[var(--game-accent)]">
                  {relativeRelease(local.date)}
                </span>
              )}
              <DelayBadge count={delays} />
              {game.parentPlatforms.length > 0 && (
                <span className="flex items-center" aria-label={`Platforms: ${game.parentPlatforms.map((p) => p.name).join(", ")}`}>
                  <PlatformIcons platforms={game.parentPlatforms} size={15} max={6} tinted />
                </span>
              )}
            </Reveal>
            {local.region && local.countryName && (
              <Reveal delay={0.16} className="mt-2">
                <p className="flex items-center gap-1.5 text-xs text-white/50">
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

        {/* One primary action (Follow), then the reader's own relationship
            with the game in a quieter second row. Full width on phones, where
            two buttons side by side are the most a thumb can parse at once. */}
        <Reveal delay={0.22} className="mt-7 space-y-2.5 sm:mt-8 sm:space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <WatchButton game={game} variant="primary" className="w-full px-4 sm:w-auto sm:px-7 max-[359px]:px-3 max-[359px]:text-[14px]" />
            <SaveButton game={game} className="w-full sm:w-auto max-[359px]:px-3" />
            {/* Phones get the icon version in the row below, beside the pickers. */}
            <div className="hidden sm:block">
              <CompareButton slug={game.slug} name={game.name} suggestions={compareSuggestions} className="min-h-12 px-5 text-[15px]" />
            </div>
            {game.website && (
              <a
                href={game.website}
                target="_blank"
                rel="noopener noreferrer"
                className="press hidden min-h-12 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-white/75 transition-colors hover:text-white lg:inline-flex"
              >
                Official site <ExternalLink size={13} />
              </a>
            )}
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <StatusPicker game={game} className="col-span-3 sm:col-span-1" />
            <OwnershipPicker game={game} className="[&>button]:min-h-11 [&>button]:w-full [&>button]:justify-center [&>button]:whitespace-nowrap [&>button]:px-3 [&>button]:text-[14px] max-[359px]:[&>button]:gap-1.5 max-[359px]:[&>button]:px-2 max-[359px]:[&>button]:text-[13px] sm:[&>button]:w-auto sm:[&>button]:px-5" />
            <SubscriptionAccessPicker game={game} className="[&>button]:min-h-11 [&>button]:w-full [&>button]:justify-center [&>button]:whitespace-nowrap [&>button]:px-3 [&>button]:text-[14px] max-[359px]:[&>button]:gap-1.5 max-[359px]:[&>button]:px-2 max-[359px]:[&>button]:text-[13px] sm:[&>button]:w-auto sm:[&>button]:px-5" />
            <CompareButton
              slug={game.slug}
              name={game.name}
              suggestions={compareSuggestions}
              variant="icon"
              className="h-11 w-11 rounded-full border-fg/15 bg-fg/[0.08] text-text sm:hidden"
            />
          </div>
        </Reveal>
      </Container>
    </header>
  );
}
