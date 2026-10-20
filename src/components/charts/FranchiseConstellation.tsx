"use client";

/**
 * A franchise as a constellation: every game is a star, sized by how many
 * people have rated (or, before launch, followed) it, placed left to right
 * in release order and higher the better critics scored it. A line joins
 * each game to the next release, so the series reads as one figure across
 * the sky. Unreleased games are hollow, unscored ones sit on the horizon
 * band, and the biggest few are named.
 *
 * Hover (pointer) or tap (touch) a star for its card; on touch the card's
 * button opens the game, so a tap never navigates by surprise. Arrow keys
 * walk the stars in release order. The same games are listed in an sr-only
 * list, so nothing depends on seeing the sky.
 *
 * Always a night sky (`data-stage="dark"`) in both themes. Reduced motion:
 * no line draw-in and no twinkle. Loaded with `next/dynamic` (`ssr: false`):
 * its geometry needs the real width.
 */

import Link from "next/link";
import { motion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { ScorePill } from "@/components/ui/ScoreRing";
import { cn } from "@/lib/utils/cn";
import type { TimelineGame } from "@/lib/games/timeline";

const HEIGHT = { compact: 340, wide: 420 };
const PAD = { x: 36, top: 44, bottom: 54 };
/** Minimum horizontal room per game; below it the sky scrolls sideways. */
const MIN_PX_PER_GAME = 46;
const NAMED = 6;
/** The scored sky's share of the plot; the rest is the unscored horizon. */
const BAND_TOP = 0.72;
/**
 * A constellation of 150 stars is noise. Big franchises show their most
 * played games (the timeline still has every one), and say so.
 */
const MAX_STARS = { compact: 18, wide: 28 };

/** Deterministic 0–1 from an id, so the sky is the same on every visit. */
function seeded(id: number, salt = 0): number {
  let x = (id * 2654435761 + salt * 40503) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967295;
}

interface Star {
  game: TimelineGame;
  x: number;
  y: number;
  r: number;
  named: boolean;
}

export default function FranchiseConstellation({ games: all, subject }: { games: TimelineGame[]; subject: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [scrollX, setScrollX] = useState(0);
  const calm = useCalmMotion();

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const compact = width > 0 && width < 640;
  const height = compact ? HEIGHT.compact : HEIGHT.wide;
  const limit = compact ? MAX_STARS.compact : MAX_STARS.wide;
  const games = useMemo(() => {
    if (all.length <= limit) return all;
    const keep = new Set([...all].sort((a, b) => b.weight - a.weight).slice(0, limit).map((game) => game.id));
    return all.filter((game) => keep.has(game.id));
  }, [all, limit]);
  const skyWidth = Math.max(width, games.length * MIN_PX_PER_GAME + PAD.x * 2);

  const { stars, years, dust } = useMemo(() => {
    if (skyWidth === 0 || games.length === 0) return { stars: [] as Star[], years: [] as Array<{ x: number; label: string }>, dust: [] as Array<{ x: number; y: number; r: number }> };
    const t0 = games[0].t;
    const t1 = games[games.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const usable = skyWidth - PAD.x * 2;
    // Time decides order and rough spacing; a floor on the gap keeps a burst
    // of same-year releases from piling onto one point.
    const xs: number[] = [];
    games.forEach((game, index) => {
      const byTime = PAD.x + ((game.t - t0) / span) * usable;
      const byIndex = PAD.x + (games.length === 1 ? usable / 2 : (index / (games.length - 1)) * usable);
      const x = byTime * 0.55 + byIndex * 0.45;
      xs.push(index > 0 ? Math.max(x, xs[index - 1] + Math.min(28, usable / games.length)) : x);
    });
    const scale = usable / Math.max(1, xs[xs.length - 1] - xs[0]);
    const maxWeight = Math.max(1, ...games.map((game) => game.weight));
    const plot = height - PAD.top - PAD.bottom;
    const ranked = [...games].sort((a, b) => b.weight - a.weight).slice(0, NAMED).map((game) => game.id);

    const stars: Star[] = games.map((game, index) => {
      const x = games.length === 1 ? skyWidth / 2 : PAD.x + (xs[index] - xs[0]) * scale;
      // Higher is better reviewed (50–100 across the upper sky). Unscored and
      // unreleased games sit on their own horizon band below it, jittered so
      // they don't form a ruler-straight line — never placed as if scored.
      const y =
        game.score !== null
          ? PAD.top + (1 - Math.min(1, Math.max(0, (game.score - 50) / 50))) * plot * BAND_TOP + (seeded(game.id, 1) - 0.5) * 10
          : PAD.top + plot * (BAND_TOP + 0.1 + seeded(game.id) * (0.9 - BAND_TOP));
      const r = 3 + Math.sqrt(game.weight / maxWeight) * (compact ? 8 : 10);
      return { game, x, y: Math.min(height - PAD.bottom, Math.max(PAD.top, y)), r, named: ranked.includes(game.id) };
    });

    const years: Array<{ x: number; label: string }> = [];
    let lastX = -Infinity;
    for (const star of stars) {
      const label = new Date(star.game.t).getUTCFullYear().toString();
      if (years.at(-1)?.label === label || star.x - lastX < 56) continue;
      years.push({ x: star.x, label });
      lastX = star.x;
    }

    const dust = Array.from({ length: Math.round(skyWidth / 9) }, (_, i) => ({
      x: seeded(i, 7) * skyWidth,
      y: seeded(i, 11) * (height - 20),
      r: 0.4 + seeded(i, 13) * 0.9,
    }));
    return { stars, years, dust };
  }, [games, skyWidth, height, compact]);

  const path = stars.map((star, i) => `${i === 0 ? "M" : "L"} ${star.x.toFixed(1)} ${star.y.toFixed(1)}`).join(" ");
  const current = active !== null ? stars[active] : null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = Math.min(stars.length - 1, Math.max(0, (active ?? -1) + (event.key === "ArrowRight" ? 1 : -1)));
    setActive(next);
    setPinned(true);
    frameRef.current?.querySelector<HTMLElement>(`[data-star="${next}"]`)?.focus({ preventScroll: false });
  };

  return (
    <div data-stage="dark" className="relative overflow-hidden rounded-3xl bg-[radial-gradient(120%_90%_at_50%_0%,#1b1840_0%,#0a0a1a_55%,#050509_100%)] text-white ring-1 ring-inset ring-white/10">
      <ul className="sr-only">
        {all.map((game) => (
          <li key={game.id}>
            <Link href={`/game/${game.slug}`}>
              {game.name}, {game.label}
              {game.score !== null ? `, critic score ${game.score}` : ""}
            </Link>
          </li>
        ))}
      </ul>

      <div ref={frameRef} className="no-scrollbar overflow-x-auto overscroll-x-contain" data-scroll-x onScroll={(event) => setScrollX(event.currentTarget.scrollLeft)}>
        {width > 0 && (
          <div
            className="relative"
            style={{ width: skyWidth, height }}
            onKeyDown={onKeyDown}
            onPointerLeave={() => !pinned && setActive(null)}
            role="group"
            aria-label={`${subject}: ${games.length} games as a constellation`}
          >
            <svg width={skyWidth} height={height} className="absolute inset-0" aria-hidden>
              <defs>
                <radialGradient id="star-glow">
                  <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
                  <stop offset="35%" stopColor="#c9c2ff" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#8a72ff" stopOpacity="0" />
                </radialGradient>
              </defs>
              {dust.map((speck, i) => (
                <circle key={i} cx={speck.x} cy={speck.y} r={speck.r} fill="#fff" opacity={0.18 + (i % 5) * 0.06} />
              ))}
              <motion.path
                d={path}
                fill="none"
                stroke="#b9adff"
                strokeOpacity={0.45}
                strokeWidth={1.2}
                initial={{ pathLength: calm ? 1 : 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: calm ? 0 : Math.min(2.4, 0.6 + stars.length * 0.06), ease: [0.16, 1, 0.3, 1] }}
              />
              {stars.some((star) => star.game.score === null) && (
                <g>
                  <line x1={0} x2={skyWidth} y1={PAD.top + (height - PAD.top - PAD.bottom) * BAND_TOP} y2={PAD.top + (height - PAD.top - PAD.bottom) * BAND_TOP} stroke="#fff" strokeOpacity={0.08} strokeDasharray="2 6" />
                  <text x={12} y={PAD.top + (height - PAD.top - PAD.bottom) * BAND_TOP + 14} fontSize={10} fill="#fff" fillOpacity={0.35} fontWeight={600}>
                    No critic score yet
                  </text>
                </g>
              )}
              {years.map((year) => (
                <text key={year.label} x={year.x} y={height - 16} textAnchor="middle" fontSize={11} fill="#ffffff" fillOpacity={0.45} fontWeight={600}>
                  {year.label}
                </text>
              ))}
            </svg>

            {stars.map((star, index) => {
              const on = active === index;
              return (
                <Link
                  key={star.game.id}
                  href={`/game/${star.game.slug}`}
                  prefetch={false}
                  data-star={index}
                  aria-label={`${star.game.name}, ${star.game.label}`}
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") {
                      setActive(index);
                      setPinned(false);
                    }
                  }}
                  onFocus={() => setActive(index)}
                  onClick={(event) => {
                    // Touch: the first tap shows the card; its button opens the game.
                    if (!(event.nativeEvent as PointerEvent).pointerType || (event.nativeEvent as PointerEvent).pointerType === "mouse") return;
                    if (active !== index || !pinned) {
                      event.preventDefault();
                      setActive(index);
                      setPinned(true);
                    }
                  }}
                  className="group absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  style={{ left: star.x, top: star.y }}
                >
                  <span
                    aria-hidden
                    className={cn("pointer-events-none absolute rounded-full transition-transform duration-300", !calm && "motion-safe:animate-[twinkle_4s_ease-in-out_infinite]")}
                    style={{
                      width: star.r * 5,
                      height: star.r * 5,
                      background: "radial-gradient(circle, rgba(255,255,255,0.55) 0%, rgba(201,194,255,0.18) 35%, transparent 70%)",
                      animationDelay: `${seeded(star.game.id, 3) * 4}s`,
                      transform: on ? "scale(1.5)" : undefined,
                    }}
                  />
                  <span
                    aria-hidden
                    className={cn("relative rounded-full transition-transform duration-300", star.game.upcoming ? "border-2 border-white/90 bg-transparent" : "bg-white shadow-[0_0_12px_rgba(201,194,255,0.9)]")}
                    style={{ width: star.r * 2, height: star.r * 2, transform: on ? "scale(1.25)" : undefined }}
                  />
                  {star.named && !on && (
                    <span aria-hidden className="pointer-events-none absolute left-1/2 top-[calc(50%+14px)] w-max max-w-[9rem] -translate-x-1/2 truncate text-center text-[11px] font-semibold text-white/75">
                      {star.game.name}
                    </span>
                  )}
                </Link>
              );
            })}

            {current && (
              <StarCard
                star={current}
                // Kept inside the part of the sky that's scrolled into view.
                view={{ left: scrollX, width }}
                height={height}
                onClose={() => {
                  setActive(null);
                  setPinned(false);
                }}
              />
            )}
          </div>
        )}
        {width === 0 && <div style={{ height: HEIGHT.compact }} />}
      </div>
      <p aria-hidden className="pointer-events-none absolute left-4 top-3 text-[12px] font-medium text-white/55 sm:left-5 sm:top-4">
        {all.length > games.length && <span>The {games.length} most-played of {all.length}<span className="max-sm:hidden"> games</span> · </span>}
        Higher<span className="max-sm:hidden"> means</span><span className="sm:hidden"> =</span> better reviewed
      </p>
      <style href="constellation-twinkle" precedence="default">
        {"@keyframes twinkle{0%,100%{opacity:.55}50%{opacity:1}}"}
      </style>
    </div>
  );
}

function StarCard({ star, view, height, onClose }: { star: Star; view: { left: number; width: number }; height: number; onClose: () => void }) {
  const CARD_W = Math.min(236, view.width - 16);
  const left = Math.min(view.left + view.width - CARD_W - 8, Math.max(view.left + 8, star.x - CARD_W / 2));
  const below = star.y < height / 2;
  return (
    <div
      className="material absolute z-10 flex gap-3 rounded-2xl p-2.5 text-white shadow-[0_18px_40px_-16px_rgba(0,0,0,0.9)] ring-1 ring-white/15"
      style={{ left, width: CARD_W, ...(below ? { top: star.y + 22 } : { bottom: height - star.y + 22 }) }}
      role="dialog"
      aria-label={star.game.name}
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      <span className="relative h-[72px] w-[54px] shrink-0 overflow-hidden rounded-lg ring-1 ring-white/15">
        <GameCover name={star.game.name} slug={star.game.slug} image={star.game.image} imageFallback={star.game.imageFallback} width={120} sizes="54px" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[14px] font-semibold leading-snug">{star.game.name}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[12px] text-white/65">
          {star.game.label}
          {star.game.score !== null && <ScorePill score={star.game.score} />}
        </span>
        <Link
          href={`/game/${star.game.slug}`}
          prefetch={false}
          className="press mt-1.5 inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold text-[#c9c2ff] coarse:min-h-11"
        >
          Open <ArrowUpRight size={13} aria-hidden />
        </Link>
      </span>
    </div>
  );
}
