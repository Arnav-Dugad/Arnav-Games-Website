"use client";

/**
 * The physics shelf: your library as a pile of real objects.
 *
 * Covers are rigid boxes in a small custom engine (`./physics`): they fall,
 * stack, slide and settle. Grab one and it hangs from the point you grabbed;
 * let go mid-swing and it keeps its momentum, so a flick tosses it across the
 * shelf. A quick tap (no drag) opens the game.
 *
 * Cost control, because this sits on a phone:
 *  - capped at 60 covers by the caller;
 *  - fixed 60 Hz steps, at most three per frame, so a slow frame can't
 *    snowball into a slower one;
 *  - the loop stops entirely once every cover is asleep, and while the shelf
 *    is off-screen or the tab is hidden — a settled shelf costs nothing;
 *  - rendering is one `transform` write per moving cover, no React renders.
 *
 * Reduced motion (OS or in-app) gets a still, neatly stacked shelf instead.
 * Loaded with `next/dynamic` and `ssr: false`: none of this belongs in the
 * server bundle or the first paint.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import type { WatchlistEntry } from "@/lib/firebase/db";
import { World, createBody, createDrag, wake, type Body } from "./physics";

/** Cover proportions in world units; pixels-per-unit is derived from the shelf width. */
const COVER_W = 0.8;
const COVER_H = COVER_W * (4 / 3);
const FLOOR_PX = 14;
const STEP = 1 / 60;
const TAP_SLOP_PX = 6;
const TAP_MS = 350;

export default function PhysicsShelf({ entries }: { entries: WatchlistEntry[] }) {
  const calm = useCalmMotion();
  return calm ? <StillShelf entries={entries} /> : <LiveShelf entries={entries} />;
}

/* -------------------------------------------------------------------------- */
/* Live                                                                       */
/* -------------------------------------------------------------------------- */

interface Layout {
  width: number;
  height: number;
  /** Pixels per world unit. */
  scale: number;
  coverW: number;
  coverH: number;
}

/**
 * Picks the largest cover size whose loose grid still fits in ~85% of the
 * shelf height, so a full library starts as a tidy pile rather than an
 * overflowing heap.
 */
function measure(width: number, height: number, count: number): Layout {
  let coverW = 112;
  for (; coverW > 48; coverW -= 2) {
    const cols = Math.max(1, Math.floor((width - 16) / (coverW * 1.12)));
    const rows = Math.ceil(count / cols);
    if (rows * coverW * (4 / 3) * 1.06 <= (height - FLOOR_PX) * 0.85) break;
  }
  return { width, height, scale: coverW / COVER_W, coverW, coverH: coverW * (4 / 3) };
}

function shelfHeight(width: number) {
  if (typeof window === "undefined") return 520;
  const viewport = window.innerHeight;
  return Math.round(Math.min(640, Math.max(380, width < 640 ? viewport * 0.62 : viewport * 0.66)));
}

function LiveShelf({ entries }: { entries: WatchlistEntry[] }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const coverRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const worldRef = useRef<World | null>(null);
  const bodiesRef = useRef<Body[]>([]);
  const layoutRef = useRef<Layout | null>(null);
  const frameRef = useRef<number | null>(null);
  const visibleRef = useRef(true);
  const gesture = useRef<{ id: number; index: number; x: number; y: number; t: number; moved: number } | null>(null);
  const suppressClick = useRef(false);
  const zRef = useRef(1);
  const [height, setHeight] = useState(520);
  const [cover, setCover] = useState<{ w: number; h: number } | null>(null);
  const [held, setHeld] = useState<number | null>(null);

  const key = useMemo(() => entries.map((entry) => entry.gameId).join(","), [entries]);

  const paint = useCallback(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const { scale, coverW, coverH } = layout;
    bodiesRef.current.forEach((body, index) => {
      const element = coverRefs.current[index];
      if (!element) return;
      element.style.transform = `translate3d(${(body.x * scale - coverW / 2).toFixed(2)}px, ${(body.y * scale - coverH / 2).toFixed(2)}px, 0) rotate(${body.angle.toFixed(4)}rad)`;
    });
  }, []);

  const run = useCallback(() => {
    if (frameRef.current !== null || !visibleRef.current) return;
    let last = performance.now();
    let carry = 0;
    const tick = (now: number) => {
      const world = worldRef.current;
      if (!world) {
        frameRef.current = null;
        return;
      }
      carry = Math.min(carry + (now - last) / 1000, STEP * 3);
      last = now;
      while (carry >= STEP) {
        world.step(STEP);
        carry -= STEP;
      }
      paint();
      if (world.settled || !visibleRef.current) {
        frameRef.current = null;
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [paint]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  /** Static walls for the current size: floor, sides and a lid so nothing escapes. */
  const buildWalls = useCallback((world: World, layout: Layout) => {
    world.bodies = world.bodies.filter((body) => body.invMass > 0);
    const w = layout.width / layout.scale;
    const h = (layout.height - FLOOR_PX) / layout.scale;
    const thick = 10;
    for (const wall of [
      createBody(w / 2, h + thick / 2, w + thick * 4, thick, 0),
      createBody(w / 2, -thick / 2, w + thick * 4, thick, 0),
      createBody(-thick / 2, h / 2, thick, h + thick * 4, 0),
      createBody(w + thick / 2, h / 2, thick, h + thick * 4, 0),
    ]) {
      wall.friction = 0.7;
      wall.restitution = 0.1;
      world.bodies.unshift(wall);
    }
  }, []);

  /** Drops every cover into a loose grid that settles within a second or so. */
  const spawn = useCallback((shuffle: boolean) => {
    const container = containerRef.current;
    if (!container) return;
    const width = container.clientWidth;
    const shelf = shelfHeight(width);
    setHeight(shelf);
    const layout = measure(width, shelf, entries.length);
    layoutRef.current = layout;
    const world = new World({ gravity: 24, iterations: 10 });
    worldRef.current = world;
    buildWalls(world, layout);

    const w = width / layout.scale;
    const floor = (shelf - FLOOR_PX) / layout.scale;
    const gap = COVER_W * 0.12;
    const cols = Math.max(1, Math.floor((w - 0.16) / (COVER_W + gap)));
    const order = entries.map((_, index) => index);
    if (shuffle) order.sort(() => Math.random() - 0.5);
    const bodies: Body[] = new Array(entries.length);
    order.forEach((entryIndex, slot) => {
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const x = (w - cols * (COVER_W + gap)) / 2 + gap / 2 + col * (COVER_W + gap) + COVER_W / 2 + (Math.random() - 0.5) * gap;
      // Rows start a little apart so the pile visibly drops into place.
      const y = Math.max(COVER_H / 2 + 0.05, floor - COVER_H / 2 - row * (COVER_H + 0.12) - 0.25 - Math.random() * 0.2);
      const body = createBody(x, y, COVER_W, COVER_H, 1, (Math.random() - 0.5) * 0.24);
      if (shuffle) {
        body.vx = (Math.random() - 0.5) * 6;
        body.vy = -Math.random() * 4;
        body.w = (Math.random() - 0.5) * 6;
      }
      bodies[entryIndex] = body;
      world.add(body);
    });
    bodiesRef.current = bodies;
    paint();
    setCover({ w: layout.coverW, h: layout.coverH });
    stop();
    run();
  }, [entries, buildWalls, paint, run, stop]);

  // (Re)build whenever the set of covers changes.
  useEffect(() => {
    spawn(false);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on ids, not array identity
  }, [key]);

  // Resizes move the walls; a big width change re-lays the shelf out.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let width = container.clientWidth;
    const observer = new ResizeObserver(() => {
      const next = container.clientWidth;
      if (Math.abs(next - width) < 2) return;
      const layout = layoutRef.current;
      const world = worldRef.current;
      if (!layout || !world || Math.abs(next - width) / width > 0.15) {
        width = next;
        spawn(false);
        return;
      }
      width = next;
      layoutRef.current = { ...layout, width: next };
      buildWalls(world, layoutRef.current);
      const max = next / layout.scale - COVER_W / 2;
      for (const body of bodiesRef.current) {
        if (body.x > max) body.x = max;
        wake(body);
      }
      run();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [spawn, buildWalls, run]);

  // Pause off-screen and in background tabs.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting && !document.hidden;
      if (visibleRef.current) run();
    });
    observer.observe(container);
    const onVisibility = () => {
      visibleRef.current = !document.hidden;
      if (visibleRef.current) run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [run]);

  const toWorld = (event: React.PointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const scale = layoutRef.current!.scale;
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLAnchorElement>, index: number) => {
    if (event.button !== 0 || !worldRef.current || gesture.current) return;
    const body = bodiesRef.current[index];
    if (!body) return;
    event.preventDefault();
    containerRef.current?.setPointerCapture(event.pointerId);
    const point = toWorld(event);
    worldRef.current.drag = createDrag(body, point.x, point.y);
    gesture.current = { id: event.pointerId, index, x: event.clientX, y: event.clientY, t: event.timeStamp, moved: 0 };
    const element = coverRefs.current[index];
    if (element) element.style.zIndex = String(++zRef.current);
    setHeld(index);
    haptic("light");
    run();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || !worldRef.current || event.pointerId !== current.id) return;
    const point = toWorld(event);
    worldRef.current.moveDrag(point.x, point.y);
    current.moved = Math.max(current.moved, Math.hypot(event.clientX - current.x, event.clientY - current.y));
    run();
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.id) return;
    gesture.current = null;
    if (worldRef.current) worldRef.current.drag = null;
    setHeld(null);
    const tap = !cancelled && current.moved < TAP_SLOP_PX && event.timeStamp - current.t < TAP_MS;
    // Pointer capture retargets the click to the shelf, so a tap opens the
    // game here; a drag must never open it.
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (tap) router.push(`/game/${entries[current.index].slug}`);
    run();
  };

  const restack = () => {
    haptic("medium");
    spawn(true);
  };

  return (
    <div>
      <div
        ref={containerRef}
        role="group"
        aria-label={`Shelf of ${entries.length} games. Drag a cover to toss it; tap or press Enter to open it.`}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endGesture(event, false)}
        onPointerCancel={(event) => endGesture(event, true)}
        onDragStart={(event) => event.preventDefault()}
        style={{ height }}
        className="relative touch-pan-y select-none overflow-hidden rounded-3xl border border-line bg-[radial-gradient(120%_80%_at_50%_0%,color-mix(in_oklab,var(--color-brand)_10%,transparent),transparent_70%),linear-gradient(180deg,color-mix(in_oklab,var(--color-fg)_2%,transparent),color-mix(in_oklab,var(--color-fg)_6%,transparent))]"
      >
        {entries.map((entry, index) => (
          <Link
            key={entry.gameId}
            ref={(element) => {
              coverRefs.current[index] = element;
            }}
            href={`/game/${entry.slug}`}
            prefetch={false}
            aria-label={entry.name}
            draggable={false}
            onPointerDown={(event) => onPointerDown(event, index)}
            onClick={(event) => {
              // Keyboard Enter still navigates; pointer taps are handled above.
              if (suppressClick.current) {
                event.preventDefault();
                suppressClick.current = false;
              }
            }}
            style={{ width: cover?.w, height: cover?.h }}
            className={cn(
              "absolute left-0 top-0 touch-none outline-none will-change-transform focus-visible:z-[999]",
              cover ? "opacity-100" : "opacity-0",
              held === index ? "cursor-grabbing" : "cursor-grab",
            )}
          >
            <span
              className={cn(
                "relative block h-full w-full overflow-hidden rounded-[10px] bg-panel ring-1 ring-inset ring-white/10 transition-[transform,box-shadow] duration-200 ease-[var(--ease-apple)]",
                "shadow-[0_10px_22px_-10px_rgba(0,0,0,0.75)] light:shadow-[0_10px_22px_-12px_rgba(0,0,0,0.35)]",
                "[a:focus-visible>&]:ring-2 [a:focus-visible>&]:ring-brand-soft",
                held === index && "scale-[1.06] shadow-[0_28px_50px_-18px_rgba(0,0,0,0.85)]",
              )}
            >
              <GameCover name={entry.name} slug={entry.slug} image={entry.image} imageFallback={entry.imageFallback} width={240} sizes="112px" className="pointer-events-none" />
            </span>
          </Link>
        ))}

        {/* The shelf board the pile rests on. */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 border-t border-line-strong bg-fg/[0.07]" style={{ height: FLOOR_PX }} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 px-1">
        <p className="text-[13px] text-muted">Drag to fling, tap to open.</p>
        <button
          type="button"
          onClick={restack}
          className="press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-brand-soft transition-colors fine:hover:bg-brand/10"
        >
          <RotateCcw size={14} aria-hidden />
          Shake it up
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Still (reduced motion)                                                     */
/* -------------------------------------------------------------------------- */

/** The same shelf at rest: covers stood in rows on boards, nothing moves. */
function StillShelf({ entries }: { entries: WatchlistEntry[] }) {
  return (
    <ul aria-label={`Shelf of ${entries.length} games`} className="grid grid-cols-4 gap-x-2 gap-y-0 rounded-3xl border border-line bg-fg/[0.03] p-3 pb-0 sm:grid-cols-6 lg:grid-cols-10">
      {entries.map((entry) => (
        <li key={entry.gameId} className="flex flex-col justify-end border-b-[10px] border-fg/[0.08] pb-0 pt-3">
          <Link
            href={`/game/${entry.slug}`}
            prefetch={false}
            aria-label={entry.name}
            className="relative block aspect-[3/4] overflow-hidden rounded-t-[8px] ring-1 ring-inset ring-fg/10"
          >
            <GameCover name={entry.name} slug={entry.slug} image={entry.image} imageFallback={entry.imageFallback} width={240} sizes="(max-width: 640px) 22vw, 120px" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
