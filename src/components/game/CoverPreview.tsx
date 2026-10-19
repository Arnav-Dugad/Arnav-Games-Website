"use client";

/**
 * A "dynamic cover": the silent motion a poster plays after the pointer has
 * rested on it (see `GameCard`). Loaded with `next/dynamic` only when a card
 * actually asks for it, so the grid itself carries none of this code.
 *
 * Two layers, so the wait is never dead air:
 *  - a slow Ken Burns across the game's first screenshots starts at once;
 *  - if the game has a trailer, it loads muted underneath that and dissolves
 *    in over it once `BackdropTrailer` has proven it is playing real footage
 *    (YouTube's start-up transport takes ~4 s to clear — revealing sooner
 *    would show its buttons inside the poster). It starts a few seconds in to
 *    skip publisher cards.
 *
 * A game with neither renders nothing and the static cover stays.
 */

import { useState } from "react";
import { isIgdbImage, sizedImage } from "@/lib/games/image";
import type { GameSummary } from "@/lib/games/types";
import { BackdropTrailer } from "./BackdropTrailer";

/** Each still's turn in the Ken Burns, in seconds. */
const STILL_SECONDS = 3.2;
/** Most trailers open on a studio card; the preview starts past it. */
const TRAILER_START_SECONDS = 8;

/** Alternating pan directions, so consecutive stills don't drift the same way. */
const PANS = [
  { from: "scale(1.06) translate3d(-2%, 1%, 0)", to: "scale(1.16) translate3d(2%, -1%, 0)" },
  { from: "scale(1.16) translate3d(2%, -1.5%, 0)", to: "scale(1.06) translate3d(-1.5%, 1%, 0)" },
  { from: "scale(1.08) translate3d(1.5%, 1.5%, 0)", to: "scale(1.18) translate3d(-2%, -1%, 0)" },
];

/**
 * Keyframes for an N-still cycle: each still holds the stage for 1/N of it
 * (crossfading over half a second at either end) while it drifts through its
 * pan. Every still runs the same keyframes, offset by its slot.
 */
function kenBurnsCss(count: number): string {
  const cycle = count * STILL_SECONDS;
  const slot = 100 / count;
  const fade = (0.5 / cycle) * 100;
  const pct = (n: number) => `${Math.min(100, n).toFixed(2)}%`;
  const fadeFrames =
    count > 1
      ? `0%{opacity:0}${pct(fade)}{opacity:1}${pct(slot)}{opacity:1}${pct(slot + fade)}{opacity:0}100%{opacity:0}`
      : "from{opacity:0}to{opacity:1}";
  return (
    `@keyframes cover-kb-fade-${count}{${fadeFrames}}` +
    PANS.map(
      (pan, i) =>
        `@keyframes cover-kb-pan-${count}-${i}{0%{transform:${pan.from}}${pct(slot + fade)}{transform:${pan.to}}100%{transform:${pan.to}}}`,
    ).join("")
  );
}

export default function CoverPreview({ game }: { game: GameSummary }) {
  const [trailerFailed, setTrailerFailed] = useState(false);
  const stills = game.screenshots
    .slice(0, 3)
    .map((url) => (isIgdbImage(url) ? sizedImage(url, 640) : url))
    .filter((url): url is string => Boolean(url));
  const trailer = trailerFailed ? null : game.heroTrailer;
  const count = stills.length;
  const cycle = count * STILL_SECONDS;

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      {count > 0 && (
        <>
          {/* Hoisted and de-duplicated by `href`, like the hero's drift. */}
          <style href={`cover-kenburns-${count}`} precedence="default">
            {kenBurnsCss(count)}
          </style>
          {stills.map((src, i) => {
            const timing = `${cycle}s linear ${i * STILL_SECONDS}s infinite both`;
            return (
              <span
                key={src}
                className="absolute inset-0"
                style={{ animation: count > 1 ? `cover-kb-fade-${count} ${timing}` : "cover-kb-fade-1 600ms ease-out both" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a transient decoration at one known size; next/image's srcset buys nothing here */}
                <img
                  src={src}
                  alt=""
                  decoding="async"
                  className="h-full w-full object-cover will-change-transform"
                  style={{
                    animation: `cover-kb-pan-${count}-${i % PANS.length} ${count > 1 ? timing : `${STILL_SECONDS * 2}s ease-out both`}`,
                  }}
                />
              </span>
            );
          })}
        </>
      )}

      {trailer && (
        <BackdropTrailer
          trailer={trailer}
          delayMs={0}
          startAt={TRAILER_START_SECONDS}
          overscan={1.2}
          onUnavailable={() => setTrailerFailed(true)}
        />
      )}
    </span>
  );
}
