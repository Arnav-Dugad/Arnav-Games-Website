"use client";

/**
 * A saved game as a poster tile, for the personal collection pages.
 *
 * Deliberately built from `WatchlistEntry` rather than `GameSummary`: the
 * library and watchlist render entirely from the Firestore snapshot they
 * already hold, so a tile must not require a catalogue lookup to draw itself.
 *
 * Kept separate from `GameCard` for the same reason — that component takes a
 * full game record and carries the ownership control, neither of which applies
 * to a list where every entry is already owned or tracked.
 *
 * It still joins the shared interactions: long-press / right-click opens the
 * game context menu (the tile only registers itself — `ContextMenuHost` owns
 * the gesture), and the poster morphs into the game page's cover.
 */

import Link from "next/link";
import { Check } from "lucide-react";
import { useMemo } from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { GameCover } from "./GameCover";
import { CoverTransition, useSharedCover } from "@/components/interactions/CoverTransition";
import { entryAsGameSummary, useGameMenuTarget } from "@/components/interactions/game-menu-targets";
import { ScorePill } from "@/components/ui/ScoreRing";
import { OWNERSHIP_PLATFORMS } from "@/lib/games/stores-catalog";
import { cn } from "@/lib/utils/cn";
import type { WatchlistEntry } from "@/lib/firebase/db";

export function PosterTile({
  entry,
  size = "compact",
  badge,
}: {
  entry: WatchlistEntry;
  size?: "compact" | "large";
  /** Small caption under the title — status, date, whatever the page cares about. */
  badge?: string;
}) {
  const owned = entry.ownedOn ?? [];
  const game = useMemo(() => entryAsGameSummary(entry), [entry]);
  const cover = useSharedCover(entry.slug, entry.image);
  const menuRef = useGameMenuTarget(game, cover.claim);

  return (
    <Link prefetch={false}
      ref={menuRef}
      href={`/game/${entry.slug}`}
      onClick={cover.claim}
      data-game-menu
      className="group/tile press-menu-target block"
    >
      <div
        data-menu-preview
        className={cn(
          "relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-fg/[0.08] bg-panel shadow-[0_14px_34px_-20px_#000] light:shadow-[0_12px_28px_-18px_#00000066]",
          "transition-[border-color,box-shadow,transform] duration-500",
          "coarse:active:scale-[0.97] coarse:active:duration-100",
          "fine:group-hover/tile:border-line-strong fine:group-hover/tile:-translate-y-1",
          "fine:group-hover/tile:shadow-[0_20px_50px_-20px_rgba(124,92,255,0.5)]",
        )}
      >
        <CoverTransition slug={entry.slug} active={cover.active}>
          <GameCover
            name={entry.name}
            slug={entry.slug}
            image={entry.image}
            imageFallback={entry.imageFallback}
            width={size === "large" ? 480 : 320}
            sizes={size === "large" ? "(max-width: 640px) 46vw, 240px" : "(max-width: 640px) 30vw, 180px"}
            className="transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] fine:group-hover/tile:scale-105"
          />
        </CoverTransition>

        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-1.5 p-2">
          {owned.length > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-[#30d158]/90 px-1.5 py-1 text-black shadow-lg">
              {owned.slice(0, 2).map((slug) => {
                const platform = OWNERSHIP_PLATFORMS.find((p) => p.slug === slug);
                // Physical, direct-download and "other" have no brand mark; a
                // check keeps the pill from rendering as an empty green blob.
                return platform?.icon ? (
                  <BrandIcon key={slug} name={platform.icon} size={11} title={platform.name} />
                ) : (
                  <Check key={slug} size={11} strokeWidth={3} aria-label={platform?.name ?? "Owned"} />
                );
              })}
              {owned.length > 2 && (
                <span className="text-[9px] font-bold tabular-nums">+{owned.length - 2}</span>
              )}
            </span>
          ) : (
            <span />
          )}
          <ScorePill score={entry.metacritic} onImage />
        </div>
      </div>

      <p
        className={cn(
          "mt-2 line-clamp-2 font-display font-semibold leading-snug tracking-[-0.01em] transition-colors fine:group-hover/tile:text-brand-soft",
          size === "large" ? "text-[14px] lg:text-[15px]" : "text-[13px]",
        )}
      >
        {entry.name}
      </p>
      {/* Sentence-case caption in the card family's style (was tiny caps). */}
      {badge && <p className="mt-0.5 truncate text-[12px] text-muted">{badge}</p>}
    </Link>
  );
}
