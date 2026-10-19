"use client";

/**
 * Featured-release hero.
 *
 * A crossfading stage with an auto-advancing timer, a thumbnail selector and a
 * live countdown. Deliberately restrained on touch: the parallax layer, the
 * Ken Burns drift and the tilt on thumbnails are all desktop-only, and the
 * stage height switches from `100svh` on phones (so the address bar can't crop
 * the CTA) to a fixed band on desktop.
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Info, Pause, Play } from "lucide-react";
import { GameCover } from "./GameCover";
import { Countdown } from "./Countdown";
import { PlatformIcons } from "./PlatformIcons";
import { WatchButton } from "./WatchButton";
import { Aurora, GridLines } from "@/components/motion/Aurora";
import { TextReveal } from "@/components/motion/text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { cn } from "@/lib/utils/cn";
import { isUnreleased, releaseLabelLong, relativeReleaseLabel, truncate } from "@/lib/utils/format";
import type { GameSummary } from "@/lib/games/types";

const ROTATE_MS = 7500;

export function HeroShowcase({ games }: { games: GameSummary[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const featured = games.slice(0, 5);
  const active = featured[index];

  const goTo = useCallback((next: number) => {
    setIndex(next);
  }, []);

  useEffect(() => {
    if (paused || featured.length <= 1) return;
    timer.current = setTimeout(
      () => setIndex((i) => (i + 1) % featured.length),
      ROTATE_MS,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [index, paused, featured.length]);

  // Pause while the tab is hidden — a carousel that advanced eight times in a
  // background tab is disorienting on return.
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  if (!active) return null;

  return (
    <section
      className="relative isolate flex min-h-[84svh] flex-col justify-end overflow-hidden lg:min-h-[82vh] noise"
      aria-roledescription="carousel"
      aria-label="Featured releases"
    >
      {/* Stage */}
      <div className="absolute inset-0 -z-10">
        <AnimatePresence mode="sync">
          <motion.div
            key={active.id}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: reduced ? 1 : 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 1.1, ease: [0.16, 1, 0.3, 1] },
              scale: { duration: ROTATE_MS / 1000 + 1.5, ease: "linear" },
            }}
          >
            <GameCover
              name={active.name}
              slug={active.slug}
              image={active.image}
              imageFallback={active.imageFallback}
              width={1920}
              priority
              sizes="100vw"
              rounded="rounded-none"
            />
          </motion.div>
        </AnimatePresence>

        {/* Legibility stack: vertical scrim for the copy, plus a left-weighted
            wash so the text column always has contrast regardless of artwork. */}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/85 to-bg/45" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/60 to-transparent lg:via-bg/35" />
        {/* Sits above the scrims so the upper half of the stage still has
            colour and movement when a title has no artwork. */}
        <Aurora intensity="normal" />
        <GridLines className="opacity-40" />
      </div>

      <Container className="relative z-10 pb-8 pt-28 sm:pb-10 lg:pb-14 lg:pt-36">
        <div className="max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge tone="brand">
                  {active.tba ? "Announced" : relativeReleaseLabel(active)}
                </Badge>
                {active.genres.slice(0, 2).map((g) => (
                  <Badge key={g.id}>{g.name}</Badge>
                ))}
              </div>

              <TextReveal
                as="h1"
                text={active.name}
                className="font-display text-[clamp(2.1rem,7.5vw,4.75rem)] font-black leading-[0.95] tracking-[-0.04em]"
              />

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
                <span>{releaseLabelLong(active)}</span>
                <span aria-hidden className="h-1 w-1 rounded-full bg-faint" />
                <PlatformIcons platforms={active.parentPlatforms} size={14} max={5} />
              </div>

              {active.genres.length > 0 && (
                <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted sm:text-base">
                  {truncate(
                    `${active.genres.map((g) => g.name).join(" · ")}${
                      active.esrb ? ` · Rated ${active.esrb}` : ""
                    }`,
                    140,
                  )}
                </p>
              )}

              {/* Only an exact, still-future date can be counted down to; a
                  window renders as its label in the meta row above instead. */}
              {active.released && isUnreleased(active) && (
                <Countdown date={active.released} className="mt-6" tone="onImage" />
              )}

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button href={`/game/${active.slug}`} size="lg" iconRight={<ArrowRight size={17} />}>
                  View details
                </Button>
                <WatchButton game={active} variant="full" />
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </Container>

      {/* Selector */}
      <Container className="relative z-10 pb-8 lg:pb-10">
        <div className="flex items-center justify-between gap-4">
          <div className="snap-rail min-w-0 flex-1 gap-2.5 pb-1 sm:gap-3">
            {featured.map((game, i) => (
              <button
                key={game.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show ${game.name}`}
                aria-current={i === index}
                className={cn(
                  "group relative h-16 w-24 shrink-0 overflow-hidden rounded-xl border transition-all duration-500 sm:h-20 sm:w-32",
                  i === index
                    ? "border-brand/70 opacity-100 ring-2 ring-brand/30"
                    : "border-line opacity-45 fine:hover:opacity-90",
                )}
              >
                <GameCover
                  name={game.name}
                  slug={game.slug}
                  image={game.image}
                  imageFallback={game.imageFallback}
                  width={256}
                  sizes="128px"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                {/* Progress rail doubles as the active indicator. */}
                {i === index && !paused && featured.length > 1 && (
                  <motion.span
                    key={`${game.id}-progress`}
                    className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-brand"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: ROTATE_MS / 1000, ease: "linear" }}
                  />
                )}
              </button>
            ))}
          </div>

          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Resume carousel" : "Pause carousel"}
              className="grid h-11 w-11 place-items-center rounded-full glass text-muted transition-colors hover:text-text"
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
