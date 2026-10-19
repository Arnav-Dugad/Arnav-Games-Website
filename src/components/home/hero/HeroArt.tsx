"use client";

import { GameCover } from "@/components/game/GameCover";
import { cn } from "@/lib/utils/cn";
import type { SpotlightGame } from "@/lib/games/types";
import { heroTint } from "./tint";

/**
 * Where each slide's Ken Burns drift is anchored. Varying it per slide is what
 * keeps a run of drifts from reading as one repeated zoom.
 */
const DRIFT_ORIGINS = ["30% 40%", "70% 36%", "50% 68%", "26% 64%", "74% 58%", "50% 30%"];

/** Long enough that the drift outlasts even a trailer slide's hold. */
const DRIFT = "hero-drift 26s linear both";

/**
 * One slide's backdrop: the artwork, its slow drift, and the palette-tinted
 * legibility stack.
 *
 * Phones get a portrait-first composition rather than a 16:9 still cropped to
 * a sliver: the art occupies the top of the stage at close to its natural
 * aspect and dissolves into the slide's own base colour, so the logo and
 * actions sit on a calm field instead of over a face cut in half. From `md`
 * up the art is full-bleed and the scrims do the work.
 *
 * The scrims are drawn with the slide (not the stage) so they crossfade, and
 * travel during a swipe, together with the art they were tinted for.
 */
export function HeroArt({
  game,
  index,
  priority = false,
  drift = false,
  driftPaused = false,
  media,
}: {
  game: SpotlightGame;
  index: number;
  priority?: boolean;
  /** Ken Burns on; off for neighbours and calm motion. */
  drift?: boolean;
  driftPaused?: boolean;
  /**
   * The trailer, layered between the art and the scrims so the copy keeps its
   * contrast over video too. Lives inside the slide so it crossfades and
   * travels with it, and inside the art frame so on phones it takes the
   * still's portrait crop and dissolves into the copy field the same way.
   */
  media?: React.ReactNode;
}) {
  const tint = heroTint(game.palette);

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden" style={{ backgroundColor: tint.base() }}>
      {drift && (
        // React 19 hoists and de-duplicates this by `href`, so every slide
        // shares one keyframes rule without a global stylesheet entry.
        <style href="hero-drift" precedence="default">
          {"@keyframes hero-drift{from{transform:scale(1)}to{transform:scale(1.09)}}"}
        </style>
      )}

      <div
        className={cn(
          "absolute inset-x-0 top-0 h-[min(74%,128vw)] md:h-full",
          // Phones: the art fades into the base colour instead of ending on a hard edge.
          "[mask-image:linear-gradient(180deg,#000_58%,transparent)] md:[mask-image:none]",
          // The portrait crop already discards most of a 16:9 frame, so the
          // trailer is overscanned only as far as hiding YouTube's chrome needs.
          "[--trailer-overscan:1.2] md:[--trailer-overscan:1.35]",
        )}
      >
        <div
          className="absolute inset-0 will-change-transform"
          style={
            drift
              ? {
                  animation: DRIFT,
                  animationPlayState: driftPaused ? "paused" : "running",
                  transformOrigin: DRIFT_ORIGINS[index % DRIFT_ORIGINS.length],
                }
              : undefined
          }
        >
          <GameCover
            name={game.name}
            slug={game.slug}
            image={game.screenshots[0] ?? game.image}
            imageFallback={game.imageFallback}
            width={1920}
            priority={priority}
            sizes="100vw"
            rounded="rounded-none"
          />
        </div>
        {media}
      </div>

      {/* Phones: a tall bottom field carrying the copy. */}
      <div
        className="absolute inset-0 md:hidden"
        style={{
          background: `linear-gradient(0deg, #000 0%, ${tint.base(0.94)} 26%, ${tint.base(0.5)} 46%, ${tint.base(0)} 64%)`,
        }}
      />
      {/* Desktop: a bottom pass anchoring the copy and a left pass protecting
          its column. Both clear well before the top-right, so the art and
          trailer stay bright where nothing overlaps them. */}
      <div
        className="absolute inset-0 hidden md:block"
        style={{
          background: `linear-gradient(0deg, #000 0%, ${tint.base(0.82)} 15%, ${tint.base(0.32)} 36%, ${tint.base(0)} 56%)`,
        }}
      />
      <div
        className="absolute inset-0 hidden md:block"
        style={{
          background: `linear-gradient(90deg, ${tint.base(0.9)} 0%, ${tint.base(0.6)} 24%, ${tint.base(0.16)} 48%, ${tint.base(0)} 66%)`,
        }}
      />
      {/* The light source: the slide's own vibrant colour, low behind the copy. */}
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(60% 46% at 6% 94%, ${tint.glow(0.26)}, transparent 72%)` }}
      />
      {/* Keeps the floating header legible over bright skies. */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/45 to-transparent" />
    </div>
  );
}
