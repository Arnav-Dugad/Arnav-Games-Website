/**
 * "Browse by genre" as art tiles, like Apple Music's category tiles.
 *
 * Each tile is the genre's hue with a small fan of real covers from games in
 * that genre — taken from the shelves already loaded for this page, so the
 * art is honest (those games really are in that genre) and costs no extra
 * request. The genres shown are the ones best represented on the page right
 * now; a genre with no art on hand still gets a clean colour tile.
 */

import Link from "next/link";
import type { CSSProperties } from "react";
import { GameCover } from "@/components/game/GameCover";
import { hueFromString } from "@/lib/utils/format";
import type { GameSummary, Ref } from "@/lib/games/types";

const TILES = 8;
const FAN = [
  { rotate: -14, x: -46, z: 1 },
  { rotate: 0, x: -22, z: 3 },
  { rotate: 12, x: 0, z: 2 },
];

export function pickGenreTiles(genres: Ref[], pool: GameSummary[]): { genre: Ref; games: GameSummary[] }[] {
  const byId = new Map<number, GameSummary[]>();
  const seen = new Set<number>();
  for (const game of pool) {
    if (seen.has(game.id) || !game.image) continue;
    seen.add(game.id);
    for (const genre of game.genres) {
      const list = byId.get(genre.id) ?? [];
      list.push(game);
      byId.set(genre.id, list);
    }
  }
  return [...genres]
    .map((genre) => ({ genre, games: byId.get(genre.id) ?? [] }))
    .sort((a, b) => b.games.length - a.games.length || a.genre.name.localeCompare(b.genre.name))
    .slice(0, TILES)
    .map((tile) => ({ ...tile, games: tile.games.slice(0, 3) }));
}

export function GenreTiles({ tiles }: { tiles: { genre: Ref; games: GameSummary[] }[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
      {tiles.map(({ genre, games }) => {
        const hue = hueFromString(genre.slug);
        return (
          <li key={genre.id}>
            <Link
              href={`/browse?genres=${genre.slug}`}
              className="hue-tile group relative isolate flex h-[132px] overflow-hidden rounded-2xl p-4 sm:h-[140px] lg:h-[156px] lg:p-5 press"
              style={{ "--tile-hue": hue, "--tile-hue-2": (hue + 45) % 360 } as CSSProperties}
            >
              {/* Full width on phones: the fanned covers sit in the bottom
                  corner, below two lines of title. The 62% cap plus
                  `overflow-wrap:anywhere` split "Advent-ure" mid-word at 320px. */}
              <span className="relative z-10 max-w-full font-display text-[17px] font-bold leading-[1.1] tracking-[-0.02em] [overflow-wrap:break-word] sm:max-w-[62%] lg:text-[19px]">
                {genre.name}
              </span>
              {/* A soft light from the corner, brightening on hover. */}
              <span
                aria-hidden
                className="absolute inset-0 -z-10 opacity-60 transition-opacity duration-500 fine:group-hover:opacity-100"
                style={{ background: `radial-gradient(90% 80% at 100% 100%, hsl(${hue} 90% 65% / 0.35), transparent 65%)` }}
              />
              <span aria-hidden className="absolute bottom-[-20px] right-2.5 h-[78px] w-[55px] sm:bottom-[-18px] sm:right-3 sm:h-[104px] sm:w-[72px] lg:bottom-[-14px] lg:h-[116px] lg:w-[80px]">
                {games.map((game, i) => {
                  const fan = FAN[i];
                  return (
                    <span
                      key={game.id}
                      className="absolute inset-0 overflow-hidden rounded-lg shadow-[0_10px_24px_-8px_#000000a6] ring-1 ring-white/15 transition-transform duration-500 ease-[var(--ease-out-expo)] [transform:translateX(calc(var(--x)*1px))_rotate(calc(var(--r)*1deg))] fine:group-hover:[transform:translateX(calc(var(--x)*1.25px))_rotate(calc(var(--r)*1.35deg))_translateY(-6px)]"
                      style={
                        {
                          "--x": fan.x,
                          "--r": fan.rotate,
                          transformOrigin: "50% 100%",
                          zIndex: fan.z,
                        } as CSSProperties
                      }
                    >
                      <GameCover
                        name={game.name}
                        slug={game.slug}
                        image={game.image}
                        imageFallback={game.imageFallback}
                        width={160}
                        sizes="80px"
                      />
                    </span>
                  );
                })}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
