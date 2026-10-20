import type { Trailer } from "./types";

/**
 * Which of a game's videos should play as its backdrop.
 *
 * IGDB lists videos in upload order, not by kind, so "the first video" is
 * often not a trailer at all — The Witcher 3's is a live orchestra concert.
 * A backdrop should be footage of the game, so names are scored: launch,
 * official, gameplay and reveal trailers first, any other trailer next, and
 * anything that is clearly about the game rather than *of* it (concerts,
 * interviews, dev diaries, soundtracks, reviews, streams) last. Ties keep
 * IGDB's order.
 */
const BEST = /\b(launch|official|gameplay|reveal|announce(ment)?|release date|cinematic|story)\b.*\btrailer\b|\btrailer\b.*\b(launch|official|gameplay|reveal)\b/i;
const TRAILER = /\btrailer\b|\bteaser\b/i;
const NOT_FOOTAGE =
  /\b(orchestra|concert|live|interview|developer|dev diary|diary|behind the scenes|making of|podcast|soundtrack|music|ost|review|panel|q ?& ?a|walkthrough|stream|tutorial|comparison|documentary|unboxing|accolades|reaction)\b/i;

function score(trailer: Trailer): number {
  const name = trailer.name ?? "";
  if (NOT_FOOTAGE.test(name)) return 3;
  if (BEST.test(name)) return 0;
  if (TRAILER.test(name)) return 1;
  return 2;
}

export function pickBackdropTrailer(trailers: readonly Trailer[]): Trailer | null {
  let best: Trailer | null = null;
  let bestScore = Infinity;
  for (const trailer of trailers) {
    const value = score(trailer);
    if (value < bestScore) {
      best = trailer;
      bestScore = value;
    }
  }
  return best;
}
