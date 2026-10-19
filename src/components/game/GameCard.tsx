"use client";

/**
 * The primary game tile.
 *
 * The poster carries the art and nothing else. Titles, dates and scores used to
 * be printed over the bottom of the cover behind a heavy scrim, which meant
 * every card dimmed its own artwork to stay legible and the text still competed
 * with whatever was underneath. Moving the name below the frame lets the art be
 * art, and makes a wall of covers scan as a shelf rather than a wall of
 * captions.
 *
 * Only two things stay on the poster, because both answer a question you have
 * *before* reading the title: whether you already own it, and what the critics
 * made of it.
 *
 * Desktop and touch get materially different affordances rather than one design
 * scaled down:
 *  - fine pointers: 3D tilt, a glare sweep, and the ownership control fading in
 *    on hover
 *  - coarse pointers: no tilt, the controls permanently visible as glass
 *    chips on the poster (44px hit areas), and press feedback via `active:scale`
 *
 * Both get the game context menu (long-press / right-click, handled once by
 * `ContextMenuHost` — the card only registers itself) and the shared-element
 * cover morph into the game page (`CoverTransition`).
 */

import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { TiltCard } from "@/components/motion/TiltCard";
import { CoverTransition, useSharedCover } from "@/components/interactions/CoverTransition";
import { useGameMenuTarget } from "@/components/interactions/game-menu-targets";
import { GameCover } from "./GameCover";
import { OwnedBadge } from "./OwnedBadge";
import { OwnershipPicker } from "./OwnershipPicker";
import { WatchButton } from "./WatchButton";
import { ScorePill } from "@/components/ui/ScoreRing";
import { cn } from "@/lib/utils/cn";
import { isUnreleased, releaseLabel, releaseYear } from "@/lib/utils/format";
import type { GameSummary } from "@/lib/games/types";

interface GameCardProps {
  game: GameSummary;
  priority?: boolean;
  className?: string;
  /** Poster is the default 3:4 tile; wide is a 16:9 tile for editorial rails. */
  shape?: "poster" | "wide";
  sizes?: string;
  /** Set false where the surrounding UI already offers the control. */
  showOwnership?: boolean;
  /** Larger type for the big-poster layouts in the library and watchlist. */
  size?: "default" | "large";
}

export function GameCard({
  game,
  priority = false,
  className,
  shape = "poster",
  sizes,
  showOwnership = true,
  size = "default",
}: GameCardProps) {
  const upcoming = isUnreleased(game);
  const caption = cardCaption(game, upcoming);
  const cover = useSharedCover(game.slug, game.image);
  const menuRef = useGameMenuTarget(game, cover.claim);

  return (
    <div ref={menuRef} data-game-menu className={cn("group/card press-menu-target", className)}>
      <div className="relative">
      <TiltCard className="rounded-2xl" intensity={7} scale={1.03}>
        <Link
          href={`/game/${game.slug}`}
          aria-label={game.name}
          onClick={cover.claim}
          data-menu-preview
          className={cn(
            "group relative block w-full overflow-hidden rounded-2xl border border-fg/[0.08] bg-panel shadow-[0_14px_34px_-18px_#000] light:shadow-[0_12px_28px_-18px_#00000066]",
            "transition-[border-color,box-shadow] duration-500",
            "fine:hover:border-fg/20 fine:hover:shadow-[0_28px_60px_-24px_rgba(138,114,255,0.5)]",
            "coarse:transition-transform coarse:duration-300 coarse:active:scale-[0.97] coarse:active:duration-100",
            shape === "poster" ? "aspect-[3/4]" : "aspect-[16/9]",
          )}
        >
          <CoverTransition slug={game.slug} active={cover.active}>
            <GameCover
              name={game.name}
              slug={game.slug}
              image={game.image}
              imageFallback={game.imageFallback}
              width={shape === "poster" ? 480 : 640}
              priority={priority}
              sizes={
                sizes ??
                (shape === "poster"
                  ? "(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 260px"
                  : "(max-width: 640px) 86vw, (max-width: 1024px) 46vw, 420px")
              }
              className="transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] fine:group-hover:scale-[1.07]"
            />
          </CoverTransition>

          {/* A light top-down wash only — just enough to seat the badges. The
              heavy bottom scrim went away with the caption it existed for. */}
          <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/55 to-transparent" />

          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
            {/* On touch the ownership chip below already shows this. */}
            <div className="hidden fine:block">
              <OwnedBadge gameId={game.id} />
            </div>
            <div className="ml-auto flex flex-col items-end gap-1.5">
              <ScorePill score={game.metacritic} onImage />
              {upcoming && (
                <span className="rounded-full bg-black/45 px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.08em] text-white shadow-[inset_0_0_0_1px_#ffffff24] backdrop-blur-md">
                  Upcoming
                </span>
              )}
            </div>
          </div>

          {/* Hover-only inner glow ring. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl shadow-[inset_0_1px_0_#ffffff1f] ring-1 ring-inset ring-fg/0 transition-[box-shadow] duration-500 fine:group-hover:ring-fg/15"
          />
        </Link>
      </TiltCard>

      {/* Touch: the actions ride on the poster as glass chips, so the title
          below gets the full card width instead of being squeezed. */}
      <div className="absolute left-2 top-2 z-10 flex gap-1.5 fine:hidden">
        <WatchButton game={game} compact />
        {showOwnership && <OwnershipPicker game={game} variant="icon" compact />}
      </div>
      </div>

      <div className="mt-2.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/game/${game.slug}`}
            onClick={cover.claim}
            className={cn(
              "block font-display font-semibold leading-snug tracking-[-0.01em] text-text transition-colors",
              "line-clamp-2 fine:group-hover/card:text-brand-soft",
              size === "large" ? "text-[15px] lg:text-base" : "text-[14px] lg:text-[15px]",
            )}
          >
            {game.name}
          </Link>
          {/* One quiet line of context. The release date used to sit on the
              poster behind a scrim; down here it no longer dims the art, and
              every card gets a caption rather than only upcoming ones. */}
          {caption && (
            <p
              className={cn(
                "mt-0.5 flex min-w-0 items-center gap-1 truncate text-[12px] lg:text-[13px]",
                upcoming ? "font-medium text-brand-soft" : "text-muted",
              )}
            >
              {upcoming && <CalendarClock size={12} aria-hidden className="shrink-0" />}
              <span className="truncate">{caption}</span>
            </p>
          )}
        </div>

        {/*
          Ownership rather than the watchlist.

          "Do I own this?" is the question people are actually answering while
          scrolling a catalogue, and it is the one the site can act on later —
          for the library, stats, and recommendations. Following still
          lives on the game page, where there is room to explain it.
        */}
        <div className="-mt-0.5 hidden shrink-0 gap-1.5 transition-opacity duration-300 fine:flex fine:opacity-0 fine:group-hover/card:opacity-100 fine:group-focus-within/card:opacity-100">
          <WatchButton game={game} />
          {showOwnership && <OwnershipPicker game={game} variant="icon" />}
        </div>
      </div>
    </div>
  );
}

/**
 * Upcoming: when (the question you have about it). Released: what kind of
 * game and when, e.g. "Role-playing (RPG) · 2015". Missing pieces drop out
 * rather than printing "TBA" twice or an empty separator.
 */
function cardCaption(game: GameSummary, upcoming: boolean): string {
  if (upcoming) return releaseLabel(game);
  // "Role-playing (RPG)" → "Role-playing": the abbreviation only costs width.
  const genre = game.genres[0]?.name.replace(/\s*\([^)]*\)$/, "");
  const year = game.released ? releaseYear(game.released) : game.releaseWindow;
  return [genre, year].filter(Boolean).join(" · ");
}
