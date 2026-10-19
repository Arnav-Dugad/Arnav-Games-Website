"use client";

/**
 * Apple-Music-style cover-flow for touch.
 *
 * One `MotionValue` — the fractional index under the centre line — drives
 * every cover's transform through `useTransform`, so a swipe updates styles
 * directly on the compositor path without re-rendering React. The component
 * re-renders only when the *centred* game changes (for the caption), which
 * is also exactly when the snap haptic fires.
 *
 * Interaction model:
 *  - the finger drags the strip 1:1 (one cover-step per neighbour spacing);
 *  - release projects the fling velocity forward and springs to the nearest
 *    cover, Apple's "momentum + snap";
 *  - past either end it rubber-bands instead of stopping dead;
 *  - tapping the centre cover opens the game (morphing into its page via the
 *    shared cover transition); tapping a side cover brings it to the centre;
 *  - vertical swipes are left entirely to the browser (`touch-action: pan-y`),
 *    so the page still scrolls through this section naturally.
 *
 * Keyboard and assistive tech get a roving-tabindex row of named buttons with
 * arrow-key navigation, and the caption is a polite live region.
 */

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CalendarClock } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import { isUnreleased, releaseLabel, relativeReleaseLabel } from "@/lib/utils/format";
import type { GameSummary } from "@/lib/games/types";
import { CoverTransition, useSharedCover } from "./CoverTransition";
import { useGameMenuTarget } from "./game-menu-targets";
import { useCalmMotion } from "./motion-prefs";

/** Horizontal distance between the centre cover and its first neighbour, as a fraction of cover width. */
const NEIGHBOUR_GAP = 0.66;
/** Further covers stack tighter, like a shelf seen at an angle. */
const STACK_GAP = 0.2;
const MAX_ROTATE = 52;
/** Covers beyond this many steps are fully hidden (and skipped by the GPU). */
const VISIBLE_RANGE = 4;
/** Below this, a pointer interaction is a tap rather than a drag. */
const TAP_SLOP = 6;

function rubberBand(overshoot: number): number {
  // iOS's resistance curve: progressively harder to pull further.
  return (1 - 1 / (overshoot * 0.55 + 1)) / 0.55;
}

export function CoverFlow({
  games,
  label,
  className,
}: {
  games: GameSummary[];
  /** Accessible name for the carousel. */
  label: string;
  className?: string;
}) {
  const count = games.length;
  const position = useMotionValue(0);
  const [active, setActive] = useState(0);
  const [coverWidth, setCoverWidth] = useState(220);
  const stageRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const animation = useRef<AnimationPlaybackControls | null>(null);
  const suppressClick = useRef(false);
  const calm = useCalmMotion();
  const router = useRouter();

  // Cover size follows the stage width (phones from 320px to small tablets).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setCoverWidth(Math.round(Math.min(260, Math.max(150, stage.clientWidth * 0.56))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const step = coverWidth * NEIGHBOUR_GAP;

  useMotionValueEvent(position, "change", (value) => {
    const index = Math.max(0, Math.min(count - 1, Math.round(value)));
    if (index !== active) {
      setActive(index);
      haptic("selection");
    }
  });

  const settleTo = useCallback(
    (index: number, velocity = 0) => {
      const target = Math.max(0, Math.min(count - 1, index));
      animation.current?.stop();
      if (calm) {
        position.set(target);
        return;
      }
      animation.current = animate(position, target, {
        type: "spring",
        stiffness: 300,
        damping: 34,
        mass: 0.9,
        velocity,
        restDelta: 0.001,
      });
    },
    [calm, count, position],
  );

  /* ---- Drag ---------------------------------------------------------------- */

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || count < 2) return;
    animation.current?.stop();
    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = position.get();
    const samples: { t: number; x: number }[] = [{ t: event.timeStamp, x: startX }];
    let dragging = false;
    suppressClick.current = false;

    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== event.pointerId) return;
      const dx = move.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < TAP_SLOP) return;
        // A mostly vertical start is page scrolling, which the browser owns.
        if (Math.abs(move.clientY - startY) > Math.abs(dx)) return finish(move, true);
        dragging = true;
        suppressClick.current = true;
      }
      samples.push({ t: move.timeStamp, x: move.clientX });
      if (samples.length > 6) samples.shift();

      let next = startPosition - dx / step;
      if (next < 0) next = -rubberBand(-next);
      else if (next > count - 1) next = count - 1 + rubberBand(next - (count - 1));
      position.set(next);
    };

    const finish = (end: PointerEvent, cancelled = false) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (!dragging) return;
      // Velocity over the last ~100ms of samples, in covers per second.
      const first = samples.find((sample) => end.timeStamp - sample.t < 110) ?? samples[0];
      const elapsed = Math.max(1, end.timeStamp - first.t);
      const pxPerMs = cancelled ? 0 : (end.clientX - first.x) / elapsed;
      const velocity = (-pxPerMs * 1000) / step;
      // Project the fling ~0.16s ahead before snapping, so a flick travels
      // further than a slow drag — but never more than five covers.
      const projected = position.get() + Math.max(-5, Math.min(5, velocity * 0.16));
      settleTo(Math.round(projected), velocity);
    };
    const onUp = (end: PointerEvent) => end.pointerId === event.pointerId && finish(end);
    const onCancel = (end: PointerEvent) => end.pointerId === event.pointerId && finish(end, true);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  /* ---- Activation ---------------------------------------------------------- */

  const activate = (index: number, claim: () => void) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (index === active) {
      claim();
      router.push(`/game/${games[index].slug}`);
    } else {
      settleTo(index);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = active + 1;
    else if (event.key === "ArrowLeft") next = active - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    next = Math.max(0, Math.min(count - 1, next));
    settleTo(next);
    buttonsRef.current[next]?.focus({ preventScroll: true });
  };

  if (count === 0) return null;
  const current = games[active];
  const coverHeight = Math.round(coverWidth * (4 / 3));

  return (
    <div className={cn("relative", className)}>
      <div
        ref={stageRef}
        role="group"
        aria-roledescription="carousel"
        aria-label={label}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className="relative select-none overflow-hidden [touch-action:pan-y]"
        style={{
          height: Math.round(coverHeight * 1.2),
          perspective: coverWidth * 4.2,
          perspectiveOrigin: "50% 40%",
        }}
      >
        {games.map((game, index) => (
          <CoverFlowItem
            key={game.id}
            game={game}
            index={index}
            position={position}
            width={coverWidth}
            height={coverHeight}
            step={step}
            centred={index === active}
            buttonRef={(element) => {
              buttonsRef.current[index] = element;
            }}
            onActivate={activate}
          />
        ))}
      </div>

      {/* Caption for the centred cover. */}
      <div aria-live="polite" className="relative mx-auto mt-1 h-[58px] max-w-[min(90%,22rem)] text-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={current.id}
            initial={calm ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={calm ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 top-0"
          >
            <Link prefetch={false}
              href={`/game/${current.slug}`}
              className="block truncate font-display text-[17px] font-semibold tracking-[-0.015em] text-text"
            >
              {current.name}
            </Link>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-[12.5px] text-muted">
              <CalendarClock size={13} className="shrink-0 text-brand-soft" aria-hidden />
              <span className="truncate">
                {releaseLabel(current)}
                {isUnreleased(current) && current.released && (
                  <span className="text-faint"> · {relativeReleaseLabel(current)}</span>
                )}
              </span>
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function CoverFlowItem({
  game,
  index,
  position,
  width,
  height,
  step,
  centred,
  buttonRef,
  onActivate,
}: {
  game: GameSummary;
  index: number;
  position: MotionValue<number>;
  width: number;
  height: number;
  step: number;
  centred: boolean;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onActivate: (index: number, claim: () => void) => void;
}) {
  const cover = useSharedCover(game.slug, game.image);
  const menuRef = useGameMenuTarget(game, cover.claim);

  // Signed distance from the centre line, in covers.
  const offset = useTransform(position, (p) => index - p);
  const x = useTransform(offset, (o) => {
    const near = Math.max(-1, Math.min(1, o));
    const far = o - near;
    return near * step + far * width * STACK_GAP;
  });
  const rotateY = useTransform(offset, (o) => -Math.max(-1, Math.min(1, o)) * MAX_ROTATE);
  const z = useTransform(offset, (o) => {
    const a = Math.abs(o);
    return -Math.min(a, 1) * width * 0.55 - Math.max(0, a - 1) * width * 0.08;
  });
  const zIndex = useTransform(offset, (o) => 100 - Math.round(Math.abs(o) * 10));
  const shade = useTransform(offset, (o) => Math.min(0.62, Math.abs(o) * 0.42));
  const opacity = useTransform(offset, (o) => (Math.abs(o) > VISIBLE_RANGE ? 0 : 1));

  return (
    <motion.div
      ref={menuRef}
      data-game-menu
      className="press-menu-target absolute left-1/2 top-[4%] will-change-transform"
      style={{ width, height, marginLeft: -width / 2, x, z, rotateY, zIndex, opacity }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-menu-preview
        tabIndex={centred ? 0 : -1}
        aria-label={centred ? `Open ${game.name}` : `Show ${game.name}, ${releaseLabel(game)}`}
        aria-current={centred ? "true" : undefined}
        onClick={() => onActivate(index, cover.claim)}
        className="cover-flow-reflect relative block h-full w-full overflow-hidden rounded-[14px] bg-panel shadow-[0_24px_50px_-22px_#000] outline-offset-4 light:shadow-[0_24px_44px_-24px_#00000073]"
      >
        <CoverTransition slug={game.slug} active={cover.active}>
          <GameCover
            name={game.name}
            slug={game.slug}
            image={game.image}
            imageFallback={game.imageFallback}
            width={480}
            priority={index < 2}
            sizes="(max-width: 767px) 60vw, 260px"
          />
        </CoverTransition>
        {/* Neighbours dim as they turn away from the light. */}
        <motion.span aria-hidden className="pointer-events-none absolute inset-0 bg-bg" style={{ opacity: shade }} />
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_#ffffff26] ring-1 ring-inset ring-fg/10" />
      </button>
    </motion.div>
  );
}
