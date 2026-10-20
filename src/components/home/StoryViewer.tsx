"use client";

/**
 * Full-screen stories: one game per screen, Instagram-style.
 *
 *   tap right / →        next story          tap left / ←   previous
 *   press and hold       pause               Space          pause / resume
 *   swipe up / "View"    open the game       swipe down / Esc / ×   close
 *
 * Each story runs on its progress segment's CSS animation: `animationend` on
 * the live segment advances the reel, and pausing is just
 * `animation-play-state` (on the segment and on the art's slow push-in), so
 * there is no JavaScript timer to keep in sync with what's drawn. The drag
 * of a swipe is written straight to the card's transform — no React render
 * per pointer move.
 *
 * Reduced motion (OS or in-app): no auto-advance, no push-in and no drag
 * travel — the reader moves through stories with taps, keys or the buttons.
 *
 * A modal dialog: focus moves in and is trapped, page scroll is locked, and
 * the story's name and line are announced as it changes. Always a dark stage
 * (`data-stage="dark"`): white type over art in both themes.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, Pause, Play, X } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { GameLogo } from "@/components/game/GameLogo";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { useDialogFocus, useLockBodyScroll } from "@/hooks";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import type { ReelStory } from "./reel";

/** How long a story stays up before advancing on its own. */
const STORY_MS = 6500;
/** Press longer than this and it's a hold (pause), not a tap. */
const HOLD_MS = 220;
/** Vertical travel that commits a swipe. */
const SWIPE_PX = 70;

const TONE: Record<ReelStory["kind"], string> = {
  soon: "#b9adff",
  trending: "#64d2ff",
  new: "#ffd60a",
};

export default function StoryViewer({
  stories,
  start,
  onClose,
  onSeen,
}: {
  stories: ReelStory[];
  start: number;
  onClose: () => void;
  onSeen: (slug: string) => void;
}) {
  const router = useRouter();
  const calm = useCalmMotion();
  const [index, setIndex] = useState(start);
  const [held, setHeld] = useState(false);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [hidden, setHidden] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number; at: number; hold: number; dy: number; id: number } | null>(null);

  useLockBodyScroll(true);
  useDialogFocus(true, panelRef, closeRef);

  const story = stories[index];
  const paused = held || pausedByUser || hidden;

  useEffect(() => {
    if (story) onSeen(story.slug);
  }, [story, onSeen]);

  // A backgrounded tab shouldn't burn through the reel.
  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const next = useCallback(() => {
    if (index >= stories.length - 1) {
      onClose();
      return;
    }
    haptic("selection");
    setIndex(index + 1);
  }, [index, stories.length, onClose]);

  const previous = useCallback(() => {
    haptic("selection");
    // On the first story, "back" restarts it (the segment is re-keyed below).
    setIndex(Math.max(0, index - 1));
  }, [index]);

  // Restart key for the live segment and art when going back from the first story.
  const [restarts, setRestarts] = useState(0);
  const back = () => {
    if (index === 0) setRestarts((count) => count + 1);
    previous();
  };

  const openGame = useCallback(() => {
    if (!story) return;
    haptic("selection");
    router.push(`/game/${story.slug}`);
    onClose();
  }, [story, router, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (index === 0) setRestarts((count) => count + 1);
        previous();
      } else if (event.key === " " && !(event.target instanceof HTMLButtonElement) && !(event.target instanceof HTMLAnchorElement)) {
        event.preventDefault();
        setPausedByUser((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, next, previous, onClose]);

  const setDrag = (dy: number) => {
    const card = cardRef.current;
    if (!card) return;
    if (dy === 0) {
      card.style.transform = "";
      card.style.transition = "";
      return;
    }
    card.style.transition = "none";
    // Down follows the finger (with a little scale-back); up resists.
    const travel = dy > 0 ? dy : dy * 0.35;
    card.style.transform = `translate3d(0, ${travel}px, 0) scale(${dy > 0 ? 1 - Math.min(dy, 400) / 2400 : 1})`;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Buttons and links inside the story handle their own taps.
    if ((event.target as HTMLElement).closest("button, a")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const hold = window.setTimeout(() => setHeld(true), HOLD_MS);
    gesture.current = { x: event.clientX, y: event.clientY, at: performance.now(), hold, dy: 0, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    g.dy = event.clientY - g.y;
    if (Math.abs(g.dy) > 8) window.clearTimeout(g.hold);
    if (!calm) setDrag(g.dy);
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    window.clearTimeout(g.hold);
    const wasHold = held || performance.now() - g.at >= HOLD_MS;
    setHeld(false);
    setDrag(0);
    if (cancelled) return;
    const dx = event.clientX - g.x;
    if (g.dy > SWIPE_PX && Math.abs(g.dy) > Math.abs(dx)) {
      onClose();
      return;
    }
    if (g.dy < -SWIPE_PX && Math.abs(g.dy) > Math.abs(dx)) {
      openGame();
      return;
    }
    // A horizontal flick also moves between stories.
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(g.dy)) {
      if (dx < 0) next();
      else back();
      return;
    }
    if (wasHold || Math.abs(dx) > 10 || Math.abs(g.dy) > 10) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientX - box.left < box.width / 3) back();
    else next();
  };

  if (!story) return null;
  const upcoming = stories[index + 1];

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Game stories"
      data-stage="dark"
      data-story-paused={paused}
      className="fixed inset-0 z-(--z-media) flex items-center justify-center bg-black text-white [color-scheme:dark]"
      style={{ "--story-ms": `${STORY_MS}ms` } as React.CSSProperties}
    >
      {/* Desktop stage: the story's own art, blurred and dimmed, around the card. Static. */}
      <div aria-hidden className="absolute inset-0 hidden overflow-hidden sm:block">
        <div className="absolute inset-[-10%] opacity-50 blur-3xl saturate-150">
          <GameCover name={story.name} slug={story.slug} image={story.cover} imageFallback={story.coverFallback} width={160} sizes="160px" rounded="rounded-none" />
        </div>
        <div className="absolute inset-0 bg-black/55" />
      </div>

      {/* Desktop: step buttons beside the card (phones tap the halves of the story). */}
      <button
        type="button"
        onClick={back}
        aria-label="Previous story"
        className="press relative z-10 mr-5 hidden h-12 w-12 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20 disabled:opacity-30 sm:grid"
        disabled={index === 0 && calm}
      >
        <ChevronLeft size={22} />
      </button>

      <div
        ref={cardRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endGesture(event)}
        onPointerCancel={(event) => endGesture(event, true)}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          "relative isolate h-full w-full touch-none select-none overflow-hidden bg-[#0b0b0f] [-webkit-touch-callout:none]",
          "transition-transform duration-300 ease-[var(--ease-apple)]",
          "sm:aspect-[9/16] sm:h-[min(92dvh,880px)] sm:w-auto sm:rounded-[28px] sm:shadow-[0_40px_120px_-30px_#000]",
        )}
      >
        {/* The art, with a slow push-in that pauses with the story. */}
        <div key={`${story.id}:${restarts}`} aria-hidden className={cn("absolute inset-0 -z-10", !calm && "story-art")}>
          <GameCover
            name={story.name}
            slug={story.slug}
            image={story.art}
            imageFallback={story.cover}
            width={1080}
            sizes="(max-width: 640px) 100vw, 500px"
            priority
            rounded="rounded-none"
          />
        </div>
        {/* The next story's art, loaded ahead so tapping on never shows a blank. */}
        {upcoming && (
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 opacity-0">
            <GameCover name={upcoming.name} slug={upcoming.slug} image={upcoming.art} imageFallback={upcoming.cover} width={1080} sizes="(max-width: 640px) 100vw, 500px" priority rounded="rounded-none" />
          </div>
        )}
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/60 via-black/0 to-black/90" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-gradient-to-t from-black/85 to-transparent" />

        {/* Progress: one segment per story. */}
        <div className="absolute inset-x-0 top-0 z-10 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3">
          <ol className="flex gap-1" aria-hidden>
            {stories.map((item, i) => (
              <li key={item.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                <span
                  key={i === index ? `${index}:${restarts}` : i}
                  data-state={i < index || (i === index && calm) ? "done" : i === index ? "live" : "pending"}
                  onAnimationEnd={i === index && !calm ? next : undefined}
                  className="story-fill block h-full w-full rounded-full bg-white"
                />
              </li>
            ))}
          </ol>

          <div className="mt-3 flex items-center gap-2.5">
            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full ring-2 ring-white/70">
              <GameCover name={story.name} slug={story.slug} image={story.cover} imageFallback={story.coverFallback} width={80} sizes="36px" rounded="rounded-full" />
            </span>
            <p className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-semibold">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TONE[story.kind] }} />
              <span className="truncate">{story.kicker}</span>
              <span className="shrink-0 font-normal text-white/60 tabular-nums">
                {index + 1}/{stories.length}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setPausedByUser((value) => !value)}
              aria-label={pausedByUser ? "Resume stories" : "Pause stories"}
              aria-pressed={pausedByUser}
              className={cn("press grid h-11 w-11 place-items-center rounded-full text-white/90 transition-colors hover:bg-white/10", calm && "hidden")}
            >
              {pausedByUser ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close stories"
              className="press grid h-11 w-11 place-items-center rounded-full text-white transition-colors hover:bg-white/10"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {/* The story. */}
        <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
          <div className="max-w-[90%] drop-shadow-[0_6px_24px_rgba(0,0,0,0.55)] [--story-logo:clamp(64px,18vw,96px)] sm:[--story-logo:84px]">
            <GameLogo name={story.name} logo={story.logo} height="var(--story-logo)" surface="dark" />
          </div>
          <p className="mt-3 text-[13px] font-medium text-white/70">
            {[story.when, story.genres].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1.5 text-[17px] font-semibold leading-snug sm:text-[18px]">{story.hook}</p>

          <Link
            prefetch={false}
            href={`/game/${story.slug}`}
            onClick={onClose}
            className="press mx-auto mt-6 flex w-fit min-h-12 flex-col items-center justify-center rounded-full px-5 text-[14px] font-semibold text-white"
          >
            <ChevronUp size={20} aria-hidden className={cn(!calm && "animate-[story-nudge_2.2s_var(--ease-out-quart)_infinite]")} />
            <span className="rounded-full bg-white px-5 py-2 text-black shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)]">View game</span>
          </Link>
        </div>

        {/* Announces each new story to screen readers. */}
        <p className="sr-only" aria-live="polite">
          {`Story ${index + 1} of ${stories.length}: ${story.name}. ${story.kicker}. ${story.hook}`}
        </p>
      </div>

      <button
        type="button"
        onClick={next}
        aria-label={index >= stories.length - 1 ? "Close stories" : "Next story"}
        className="press relative z-10 ml-5 hidden h-12 w-12 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20 sm:grid"
      >
        <ChevronRight size={22} />
      </button>
    </div>
  );
}
