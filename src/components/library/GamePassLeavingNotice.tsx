"use client";

/**
 * "Leaving Game Pass soon" warning for the reader's own games.
 *
 * The leaving-soon shelf is public data; what makes it worth a banner is the
 * overlap with this person's library or watchlist — a game they meant to play
 * through Game Pass is about to disappear. Renders nothing at all unless that
 * overlap exists, so most visits never see it.
 */

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";

export interface LeavingGame {
  id: number;
  slug: string;
  name: string;
  image: string | null;
  imageFallback: string | null;
}

export function GamePassLeavingNotice({ leaving }: { leaving: LeavingGame[] }) {
  const { entries } = useWatchlist();
  const tracked = new Set(entries.map((entry) => entry.gameId));
  const yours = leaving.filter((game) => tracked.has(game.id));

  if (yours.length === 0) return null;

  return (
    <section
      aria-label="Leaving Game Pass soon"
      className="glass mb-6 flex flex-col gap-4 rounded-3xl border-gold/30 p-4 sm:flex-row sm:items-center sm:p-5"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gold/15 text-gold">
          <AlertTriangle size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">
            {yours.length === 1
              ? `${yours[0].name} is leaving Game Pass soon`
              : `${yours.length} of your games are leaving Game Pass soon`}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Play it while it&apos;s included, or pick it up before it goes.
          </p>
        </div>
      </div>

      <ul className="no-scrollbar flex gap-2 overflow-x-auto">
        {yours.slice(0, 6).map((game) => (
          <li key={game.id} className="shrink-0">
            <Link prefetch={false}
              href={`/game/${game.slug}`}
              title={game.name}
              className="press relative block h-16 w-12 overflow-hidden rounded-xl border border-line"
            >
              <GameCover
                name={game.name}
                slug={game.slug}
                image={game.image}
                imageFallback={game.imageFallback}
                width={120}
                sizes="48px"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
