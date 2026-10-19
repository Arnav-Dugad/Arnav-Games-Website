"use client";

/**
 * Full-bleed hero that autoplays the featured game's trailer.
 *
 * Sequence per slide: the key art loads instantly, then after a short beat the
 * trailer fades in over it and plays muted on a loop. Art-first is deliberate —
 * a video that has to buffer before anything appears reads as a slow page,
 * whereas a still that dissolves into motion reads as intentional.
 *
 * Hiding YouTube's chrome takes two things, because the player parameters alone
 * are not enough:
 *
 *  1. `controls=0&modestbranding=1&iv_load_policy=3&…` removes the controls,
 *     annotations and most branding.
 *  2. The iframe is then scaled well beyond the frame and centred, so the
 *     residual title bar and the share/watch-later buttons — which sit in the
 *     player's top corners and cannot be disabled — are pushed outside the
 *     visible area entirely.
 *
 * `pointer-events: none` on the video layer means nothing in it is clickable,
 * so no stray click can ever navigate to YouTube.
 *
 * Autoplay is desktop-only and respects reduced motion: on a phone it costs
 * data and battery for something the reader didn't ask for, so touch devices
 * get the artwork and an explicit play control instead.
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Info, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { BackdropTrailer } from "@/components/game/BackdropTrailer";
import { GameCover } from "@/components/game/GameCover";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { OwnershipPicker } from "@/components/game/OwnershipPicker";
import { WatchButton } from "@/components/game/WatchButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { useIsMobile, useRichMotion } from "@/hooks";
import { cn } from "@/lib/utils/cn";
import { releaseLabelLong, relativeReleaseLabel, truncate } from "@/lib/utils/format";
import type { GameSummary } from "@/lib/games/types";

/**
 * How long a slide holds, by what it actually has to show.
 *
 * A slide running a trailer earns real screen time — cutting away four seconds
 * into a trailer is worse than not playing one. A slide that only has artwork
 * has nothing further to reveal, so it moves on quickly. The trailer clock
 * starts when playback is *confirmed*, not when the slide appears, so a slow
 * embed doesn't eat its own airtime.
 */
const TRAILER_SLIDE_MS = 15_000;
const ARTWORK_SLIDE_MS = 7_000;
/** Beat before the trailer replaces the still. */
const TRAILER_DELAY_MS = 1800;
/**
 * How long the full metadata block stays before collapsing to just the title.
 *
 * The Netflix move: lead with everything someone needs to decide, then get out
 * of the artwork's way once they've had time to read it.
 */
const INFO_HOLD_MS = 4200;

export function CinematicHero({ games }: { games: GameSummary[] }) {
  const featured = games.filter((game) => game.image || game.heroTrailer).slice(0, 6);

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  /**
   * Which slide the trailer is cleared to play on, rather than a bare boolean.
   * Comparing against the current index means changing slides resets playback
   * implicitly — no state has to be written to undo the previous slide.
   */
  const [trailerReadyFor, setTrailerReadyFor] = useState<number | null>(null);
  /** True only once the embed reports it is genuinely playing. */
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  /** Collapses the metadata to just the title, Netflix-style. */
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reduced = useReducedMotion();
  const richMotion = useRichMotion();
  const isMobile = useIsMobile();

  const active = featured[index];
  const trailer = active?.heroTrailer ?? null;
  // Autoplay is a desktop affordance; phones get artwork until asked.
  const canAutoplay = richMotion && !isMobile && !reduced && Boolean(trailer);

  const goTo = useCallback((next: number) => setIndex(next), []);

  /*
   * Advance the carousel.
   *
   * Depending on `trailerPlaying` restarts this timer the moment playback is
   * confirmed, which is exactly what's wanted: the slide gets its full trailer
   * airtime measured from when the video actually started, and an artwork-only
   * slide — including one whose trailer turned out to be age-restricted —
   * quietly falls back to the shorter hold.
   */
  const slideMs = trailerPlaying ? TRAILER_SLIDE_MS : ARTWORK_SLIDE_MS;

  useEffect(() => {
    if (paused || featured.length <= 1) return;
    advanceTimer.current = setTimeout(
      () => setIndex((i) => (i + 1) % featured.length),
      slideMs,
    );
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, [index, paused, featured.length, slideMs]);

  // Collapse the metadata after a beat, and restore it whenever the slide
  // changes so every game gets its own full introduction.
  useEffect(() => {
    if (paused) return;
    const frame = requestAnimationFrame(() => setInfoCollapsed(false));
    const id = setTimeout(() => setInfoCollapsed(true), INFO_HOLD_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(id);
    };
  }, [index, paused]);

  // Playback is per-slide; a new slide starts unproven.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setTrailerPlaying(false));
    return () => cancelAnimationFrame(frame);
  }, [index]);

  // Bring the trailer in a beat after the art.
  useEffect(() => {
    if (!canAutoplay || paused) return;
    trailerTimer.current = setTimeout(() => setTrailerReadyFor(index), TRAILER_DELAY_MS);
    return () => {
      if (trailerTimer.current) clearTimeout(trailerTimer.current);
    };
  }, [index, canAutoplay, paused]);

  // Derived, so switching slides cancels the previous trailer for free.
  const showTrailer = trailerReadyFor === index && canAutoplay && !paused;

  // A carousel that ran while the tab was hidden is disorienting on return.
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  if (!active) {
    return (
      <section className="noise relative isolate flex min-h-[62svh] items-end overflow-hidden border-b border-line">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_24%,rgba(124,92,255,0.24),transparent_36%),radial-gradient(circle_at_82%_12%,rgba(34,211,238,0.12),transparent_32%),linear-gradient(180deg,#090914,var(--color-bg))]" />
        <Container className="pb-14 pt-32 sm:pb-18 lg:pb-24 lg:pt-44">
          <Badge tone="brand">Your game universe, one place</Badge>
          <h1 className="mt-5 max-w-4xl font-display text-[clamp(2.6rem,8vw,5.8rem)] font-black leading-[0.92] tracking-[-0.05em]">
            Never miss the game worth waiting for.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            Explore releases, build your collection, and follow only the games whose launches and DLC matter to you. Live discovery will refill automatically when the catalogue reconnects.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button href="/browse" size="lg" iconRight={<ArrowRight size={17} />}>Explore the catalogue</Button>
            <Button href="/stats" size="lg" variant="secondary">Open personal stats</Button>
          </div>
        </Container>
      </section>
    );
  }

  return (
    <section
      className="relative isolate flex min-h-[88svh] flex-col justify-end overflow-hidden lg:min-h-[92vh]"
      aria-roledescription="carousel"
      aria-label="Featured games"
    >
      {/* Stage */}
      <div className="absolute inset-0 -z-10 bg-bg">
        <AnimatePresence mode="sync">
          <motion.div
            key={`art-${active.id}`}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: reduced ? 1 : 1.08 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 1.1, ease: [0.16, 1, 0.3, 1] },
              // Matches the slide's actual hold so the Ken Burns drift
              // finishes exactly as the slide changes.
              scale: { duration: slideMs / 1000, ease: "linear" },
            }}
          >
            <GameCover
              name={active.name}
              slug={active.slug}
              image={active.screenshots[0] ?? active.image}
              imageFallback={active.imageFallback}
              width={1920}
              priority
              sizes="100vw"
              rounded="rounded-none"
            />
          </motion.div>
        </AnimatePresence>

        {/* Keyed on the slide so switching games tears down the old player
            rather than leaving two iframes stacked. */}
        <BackdropTrailer
          key={`trailer-${active.id}`}
          trailer={showTrailer ? trailer : null}
          muted={muted}
          delayMs={0}
          onPlayingChange={setTrailerPlaying}
        />

        {/*
          Legibility stack, kept as light as the text will tolerate.

          Two gradients rather than one flat wash: the vertical pass anchors the
          copy at the bottom, the horizontal pass protects the left column, and
          both clear to fully transparent well before the top-right — so the
          artwork and trailer stay bright where nothing overlaps them. The copy
          carries its own drop shadow, which is what lets these stay this thin.
        */}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/45 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg/85 via-bg/25 to-transparent lg:via-bg/10" />
      </div>

      <Container className="relative z-10 pb-6 pt-28 sm:pb-8 lg:pb-10 lg:pt-36">
        <div className="max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              {/*
                Everything except the title and the actions collapses away once
                the reader has had time to take it in. Height is animated as
                well as opacity so the title settles downward into the space
                rather than leaving a hole — the movement is what makes it read
                as intentional rather than as content failing to load.
              */}
              <motion.div
                initial={false}
                animate={{
                  opacity: infoCollapsed ? 0 : 1,
                  height: infoCollapsed ? 0 : "auto",
                  marginBottom: infoCollapsed ? 0 : 16,
                }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
                aria-hidden={infoCollapsed}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">{relativeReleaseLabel(active)}</Badge>
                  {active.genres.slice(0, 2).map((genre) => (
                    <Badge key={genre.id}>{genre.name}</Badge>
                  ))}
                </div>
              </motion.div>

              {/* The title stays, and grows slightly as the rest clears out. */}
              <motion.h1
                initial={false}
                animate={{ scale: infoCollapsed ? 1.04 : 1 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="origin-left font-display text-[clamp(2.2rem,7.5vw,5rem)] font-black leading-[0.94] tracking-[-0.045em] drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
              >
                {active.name}
              </motion.h1>

              <motion.div
                initial={false}
                animate={{
                  opacity: infoCollapsed ? 0 : 1,
                  height: infoCollapsed ? 0 : "auto",
                }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
                aria-hidden={infoCollapsed}
              >
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
                  <span>{releaseLabelLong(active)}</span>
                  <span aria-hidden className="h-1 w-1 rounded-full bg-faint" />
                  <PlatformIcons platforms={active.parentPlatforms} size={15} max={5} tinted />
                  {active.metacritic !== null && (
                    <>
                      <span aria-hidden className="h-1 w-1 rounded-full bg-faint" />
                      <span className="font-semibold text-mint">{active.metacritic}</span>
                    </>
                  )}
                </div>

                {active.genres.length > 0 && (
                  <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted sm:text-base">
                    {truncate(active.genres.map((g) => g.name).join(" · "), 120)}
                  </p>
                )}
              </motion.div>

              {/* Phones: a full-width primary with the two secondary actions
                  sharing the row beneath, instead of wrapping into an orphan. */}
              <div className="mt-7 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
                <Button
                  href={`/game/${active.slug}`}
                  size="lg"
                  iconRight={<ArrowRight size={17} />}
                  className="col-span-2 sm:col-span-1"
                >
                  View details
                </Button>
                <WatchButton game={active} variant="full" className="w-full px-4 sm:w-auto sm:px-6" />
                <OwnershipPicker game={active} className="[&>button]:w-full [&>button]:justify-center sm:[&>button]:w-auto" />
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </Container>

      {/* Controls */}
      <Container className="relative z-10 pb-8 lg:pb-12">
        <div className="flex items-end justify-between gap-4">
          <div className="snap-rail min-w-0 flex-1 gap-2.5 pb-1 sm:gap-3">
            {featured.map((game, i) => (
              <button
                key={game.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show ${game.name}`}
                aria-current={i === index}
                className={cn(
                  "group relative h-16 w-24 shrink-0 overflow-hidden rounded-xl border transition-all duration-500 sm:h-[72px] sm:w-32",
                  i === index
                    ? "border-brand/70 opacity-100 ring-2 ring-brand/25"
                    : "border-line opacity-45 fine:hover:scale-105 fine:hover:opacity-90",
                )}
              >
                <GameCover
                  name={game.name}
                  slug={game.slug}
                  image={game.screenshots[0] ?? game.image}
                  imageFallback={game.imageFallback}
                  width={320}
                  sizes="128px"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                {i === index && !paused && featured.length > 1 && (
                  <motion.span
                    key={`${game.id}-progress`}
                    className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-brand"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: slideMs / 1000, ease: "linear" }}
                  />
                )}
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {canAutoplay && trailer && (
              <button
                type="button"
                onClick={() => setMuted((value) => !value)}
                aria-label={muted ? "Unmute trailer" : "Mute trailer"}
                className="grid h-11 w-11 place-items-center rounded-full glass text-muted transition-colors hover:text-text"
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              aria-label={paused ? "Resume" : "Pause"}
              className="hidden h-11 w-11 place-items-center rounded-full glass text-muted transition-colors hover:text-text sm:grid"
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
            <Link
              href="/upcoming"
              className="hidden items-center gap-2 rounded-full glass px-4 py-3 text-sm text-muted transition-colors hover:text-text lg:inline-flex"
            >
              <Info size={15} />
              Full calendar
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
