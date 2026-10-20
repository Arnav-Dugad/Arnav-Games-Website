import Link from "next/link";
import type { CSSProperties } from "react";
import { GameCover } from "@/components/game/GameCover";
import type { Showcase } from "../_lib/showcase";

/**
 * One genre or platform as an art tile: name, the real number of games behind
 * the link, and a small fan of covers from its most-rated games. Shared by
 * /genres and /platforms so the two directories read as one family.
 *
 * Counts and covers are optional — when IGDB couldn't answer, the tile is a
 * clean colour block with a name, never a made-up figure.
 */

const FAN = [
  { rotate: -13, x: -44, z: 1 },
  { rotate: 0, x: -21, z: 3 },
  { rotate: 11, x: 0, z: 2 },
];

const COUNT = new Intl.NumberFormat("en-US");

export function TaxonomyTile({
  href,
  name,
  hue,
  showcase,
  compact = false,
}: {
  href: string;
  name: string;
  hue: number;
  showcase?: Showcase;
  /** A shorter tile with no art — for tag rows. */
  compact?: boolean;
}) {
  const count = showcase?.count ?? null;
  const covers = showcase?.covers ?? [];
  return (
    <Link
      href={href}
      className={`hue-tile press group relative isolate flex flex-col overflow-hidden rounded-2xl p-4 lg:p-5 ${compact ? "h-[84px] justify-end sm:h-[92px]" : "h-[150px] sm:h-[160px]"}`}
      style={{ "--tile-hue": hue, "--tile-hue-2": (hue + 40) % 360 } as CSSProperties}
    >
      <span
        aria-hidden
        className="absolute inset-0 -z-10 opacity-60 transition-opacity duration-500 fine:group-hover:opacity-100"
        style={{ background: `radial-gradient(90% 80% at 100% 100%, hsl(${hue} 90% 65% / 0.35), transparent 65%)` }}
      />
      {/* Full width so names wrap between words; the covers sit low enough
          (see below) to clear two lines of name plus the count. */}
      <span className="relative z-10 font-display text-[17px] font-bold leading-[1.12] tracking-[-0.02em] [overflow-wrap:break-word] lg:text-[19px]">
        {name}
      </span>
      {count !== null && (
        <span className="relative z-10 mt-1 text-[13px] tabular-nums text-white/70">
          {COUNT.format(count)} {count === 1 ? "game" : "games"}
        </span>
      )}
      {covers.length > 0 && (
        <span
          aria-hidden
          className="absolute bottom-[-24px] right-2.5 h-[78px] w-[56px] sm:right-3 sm:h-[88px] sm:w-[62px] lg:h-[96px] lg:w-[68px]"
        >
          {covers.map((cover, i) => {
            // A lone cover stands at a slight tilt instead of sliding left as a fan's back card.
            const fan = covers.length === 1 ? FAN[2] : FAN[i] ?? FAN[FAN.length - 1];
            return (
              <span
                key={cover.id}
                className="absolute inset-0 overflow-hidden rounded-lg shadow-[0_10px_24px_-8px_#000000a6] ring-1 ring-white/15 transition-transform duration-500 ease-[var(--ease-out-expo)] [transform:translateX(calc(var(--x)*1px))_rotate(calc(var(--r)*1deg))] fine:group-hover:[transform:translateX(calc(var(--x)*1.25px))_rotate(calc(var(--r)*1.35deg))_translateY(-6px)]"
                style={{ "--x": fan.x, "--r": fan.rotate, transformOrigin: "50% 100%", zIndex: fan.z } as CSSProperties}
              >
                <GameCover name={cover.name} slug={cover.slug} image={cover.image} width={160} sizes="80px" />
              </span>
            );
          })}
        </span>
      )}
    </Link>
  );
}
