"use client";

/**
 * The homepage hero: a full-bleed, Apple TV-style featured carousel.
 *
 * Per slide, the key art appears instantly and drifts (Ken Burns), then — on
 * desktop, after a beat — the muted trailer dissolves in over it once the
 * player has *proven* it is playing real footage (see `BackdropTrailer`).
 * Art-first is deliberate: a video that has to buffer before anything appears
 * reads as a slow page, whereas a still that dissolves into motion reads as
 * intentional. A blocked, age-gated or refused trailer is simply never shown.
 *
 * Trailer autoplay is desktop-only (fine pointer, wide viewport, no reduced
 * motion): on a phone it costs data and battery for something the reader
 * didn't ask for, so touch devices get the artwork.
 *
 * The rest, briefly:
 *  - The game's official logo replaces a typeset title (a visually hidden h2
 *    carries the name); `GameLogo` falls back to a wordmark.
 *  - Scrims, glow and the progress fill are tinted from a palette sampled
 *    server-side from the exact image on stage (`getSpotlight`).
 *  - Navigation: progress pills that fill over the slide (and freeze while
 *    the carousel waits), swipe with drag-follow and momentum, arrow keys,
 *    and an "Up next" card on desktop.
 *  - Auto-advance pauses on hover/keyboard focus over the controls, while
 *    dragging, when the hero is scrolled away or the tab is hidden, and
 *    stays off entirely under reduced motion.
 *  - Scrolling away shrinks the stage into a rounded card while the art
 *    parallaxes and the copy lifts away — transform and opacity only.
 */

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useScroll,
  useTransform,
  type MotionValue,
  type PanInfo,
  type Variants,
} from "motion/react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { preload } from "react-dom";
import { ArrowRight, ChevronRight, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { BackdropTrailer } from "@/components/game/BackdropTrailer";
import { GameCover } from "@/components/game/GameCover";
import { GameLogo } from "@/components/game/GameLogo";
import { OwnershipPicker } from "@/components/game/OwnershipPicker";
import { WatchButton } from "@/components/game/WatchButton";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { useIsMobile, useRichMotion } from "@/hooks";
import { isIgdbImage, sizedImage } from "@/lib/games/image";
import { cn } from "@/lib/utils/cn";
import type { SpotlightGame } from "@/lib/games/types";
import { HeroArt } from "./hero/HeroArt";
import { HeroMeta } from "./hero/HeroMeta";
import { HeroPills } from "./hero/HeroPills";
import { heroTint } from "./hero/tint";
import { useSlideClock } from "./hero/useSlideClock";

/**
 * How long a slide holds, by what it actually has to show.
 *
 * A slide that will run a trailer earns real screen time — cutting away a few
 * seconds into a trailer is worse than not playing one — and the clock is
 * re-timed rather than restarted if the trailer turns out to be unplayable,
 * so the slide then finishes at the artwork pace.
 */
const TRAILER_SLIDE_MS = 18_000;
const ARTWORK_SLIDE_MS = 8_000;
/** Beat before the trailer starts loading behind the still. */
const TRAILER_DELAY_MS = 1600;
/** A swipe commits past this share of the stage width, or on a flick. */
const SWIPE_DISTANCE = 0.18;
const SWIPE_VELOCITY = 420;
/** The stage's size once it has fully settled into a card. */
const CARD_SCALE = 0.92;

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The hero is always a dark stage — white type over art and video in both
 * themes — so the light theme's token swap is undone inside it. Shared
 * components (Follow, I own this, platform glyphs) read these tokens, which
 * is what keeps them legible here without hero-specific variants.
 * `--color-bg` is deliberately *not* overridden: the scroll-card corners are
 * painted in the real page colour.
 */
const HERO_TOKENS = {
  colorScheme: "dark",
  "--color-text": "#f5f5f7",
  "--color-muted": "rgb(255 255 255 / 0.72)",
  "--color-faint": "rgb(255 255 255 / 0.55)",
  "--color-fg": "#ffffff",
  "--color-line": "#ffffff17",
  "--color-line-strong": "#ffffff2b",
  "--color-panel": "#1c1c1e",
  "--color-panel-2": "#2c2c2e",
  "--color-brand": "#8a72ff",
  "--color-brand-soft": "#b9adff",
  "--color-neon": "#64d2ff",
  "--color-flare": "#ff375f",
  "--color-gold": "#ffd60a",
  "--color-mint": "#30d158",
} as CSSProperties;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Never changes; `useSyncExternalStore` only distinguishes server from client. */
const subscribeNothing = () => () => {};

/** How the current slide was reached; decides how the art transitions. */
type Change = "auto" | "manual" | "swipe";

export function CinematicHero({ games }: { games: SpotlightGame[] }) {
  const featured = useMemo(
    () => games.filter((game) => game.screenshots[0] || game.image).slice(0, 6),
    [games],
  );
  const count = featured.length;

  const [index, setIndex] = useState(0);
  const [change, setChange] = useState<Change>("auto");
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [inView, setInView] = useState(true);
  const [tabHidden, setTabHidden] = useState(false);
  const [muted, setMuted] = useState(true);
  /** Which game's trailer has been cleared to load. Keyed by id, so changing slides resets it implicitly. */
  const [trailerReadyFor, setTrailerReadyFor] = useState<number | null>(null);
  /** Which game's trailer has proven it is playing. */
  const [playingFor, setPlayingFor] = useState<number | null>(null);
  /** Trailers that failed this visit; not retried when the carousel comes back round. */
  const [failed, setFailed] = useState<number[]>([]);
  const [announcement, setAnnouncement] = useState("");

  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(1);

  /*
   * Gated on hydration: motion's reduced-motion read is live on the client's
   * very first render but always false on the server, so using it directly
   * renders different markup (corner caps, drift, transforms) and fails
   * hydration. The hydrating render matches the server; calm applies one
   * commit later.
   */
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const calm = useCalmMotion() && hydrated;
  const richMotion = useRichMotion();
  const isMobile = useIsMobile();

  const active = featured[index] as SpotlightGame | undefined;
  const next = count > 1 ? featured[(index + 1) % count] : undefined;
  const prev = count > 1 ? featured[(index - 1 + count) % count] : undefined;
  const activeId = active?.id ?? null;

  const trailer = active?.heroTrailer ?? null;
  const canAutoplay =
    richMotion && !isMobile && !calm && Boolean(trailer) && activeId !== null && !failed.includes(activeId);
  const trailerPlaying = activeId !== null && playingFor === activeId;
  const showTrailer = canAutoplay && trailerReadyFor === activeId;
  const visible = inView && !tabHidden;
  const slideMs = canAutoplay || trailerPlaying ? TRAILER_SLIDE_MS : ARTWORK_SLIDE_MS;

  const tint = heroTint(active?.palette);

  /* --- Navigation --------------------------------------------------------- */

  const goTo = useCallback(
    (target: number, how: Change) => {
      if (count === 0) return;
      const nextIndex = ((target % count) + count) % count;
      setChange(how);
      setIndex(nextIndex);
      // Announced only when the reader asked for it — an auto-rotating
      // carousel that talks every eight seconds is noise.
      if (how !== "auto") {
        setAnnouncement(`${featured[nextIndex].name}, ${nextIndex + 1} of ${count}`);
      }
    },
    [count, featured],
  );

  /*
   * Auto-advance never runs under reduced motion: an unprompted change of the
   * whole stage is exactly the movement that setting asks us to avoid. The
   * pills and swipe still navigate.
   */
  const clockRunning =
    !calm && count > 1 && !userPaused && !hovered && !keyboardFocus && !dragging && visible;

  const progress = useSlideClock({
    durationMs: slideMs,
    running: clockRunning,
    resetKey: index,
    onComplete: () => goTo(index + 1, "auto"),
  });

  /* --- Trailer lifecycle -------------------------------------------------- */

  // Bring the trailer in a beat after the art — and only while someone can
  // actually see it play.
  useEffect(() => {
    if (!canAutoplay || userPaused || !visible || activeId === null) return;
    const timer = setTimeout(() => setTrailerReadyFor(activeId), TRAILER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [activeId, canAutoplay, userPaused, visible]);

  const onPlayingChange = useCallback(
    (playing: boolean) => {
      setPlayingFor((current) => (playing ? activeId : current === activeId ? null : current));
    },
    [activeId],
  );
  const onUnavailable = useCallback(() => {
    if (activeId === null) return;
    setFailed((list) => (list.includes(activeId) ? list : [...list, activeId]));
  }, [activeId]);

  // Warm the next slide's art so an auto-advance crossfades onto a finished
  // image rather than a blur-up. The URL matches what `GameCover` requests.
  useEffect(() => {
    const art = next ? (next.screenshots[0] ?? next.image) : null;
    const url = sizedImage(art, 1920);
    if (url && isIgdbImage(url)) preload(url, { as: "image", fetchPriority: "low" });
  }, [next]);

  /* --- Pausing conditions ------------------------------------------------- */

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.intersectionRatio >= 0.3),
      { threshold: [0, 0.3, 0.6] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A carousel that ran while the tab was hidden is disorienting on return.
  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const hoverHandlers = {
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") setHovered(true);
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") setHovered(false);
    },
  };

  /* --- Swipe -------------------------------------------------------------- */

  const dragX = useMotionValue(0);
  // The copy recedes as the art is pulled away, and returns with the new slide.
  const copyDragOpacity = useTransform(dragX, (x) => 1 - Math.min(1, Math.abs(x) / (widthRef.current * 0.35)));

  const trackRef = useRef<HTMLDivElement>(null);
  const swipeResetPending = useRef(false);

  /*
   * Runs after React has swapped the slides in the DOM but before paint. The
   * motion value only re-renders on the next animation frame, so the track's
   * transform is also cleared directly — otherwise the browser could paint
   * one frame of the new slide still offset by a full width.
   */
  useLayoutEffect(() => {
    if (!swipeResetPending.current) return;
    swipeResetPending.current = false;
    dragX.jump(0);
    if (trackRef.current) trackRef.current.style.transform = "none";
    setDragging(false);
  }, [index, dragX]);

  const onDragStart = () => {
    widthRef.current = stageRef.current?.offsetWidth || window.innerWidth;
    setDragging(true);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const width = widthRef.current;
    const { offset, velocity } = info;
    const direction =
      Math.abs(velocity.x) > SWIPE_VELOCITY
        ? velocity.x < 0 ? 1 : -1
        : offset.x < -width * SWIPE_DISTANCE
          ? 1
          : offset.x > width * SWIPE_DISTANCE
            ? -1
            : 0;

    if (direction === 0 || count <= 1) {
      void animate(dragX, 0, { type: "spring", stiffness: 420, damping: 40, velocity: velocity.x });
      setDragging(false);
      return;
    }

    /*
     * The neighbour is already on stage beside the current slide, so the
     * commit is just finishing the throw (carrying the finger's velocity)
     * and then swapping which slide is "current". The track's snap back to
     * zero happens in the layout effect below, in the same commit as the
     * swap, so there is never a painted frame of the wrong art.
     */
    const commit = () => {
      swipeResetPending.current = true;
      goTo(index + direction, "swipe");
    };
    if (calm) {
      commit();
      return;
    }
    void animate(dragX, -direction * (width + 12), {
      type: "spring",
      stiffness: 260,
      damping: 34,
      velocity: velocity.x,
      restDelta: 1,
      onComplete: commit,
    });
  };

  /* --- Keyboard ----------------------------------------------------------- */

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || count <= 1) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(index + 1, "manual");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(index - 1, "manual");
    }
  };

  /* --- Scroll-driven card --------------------------------------------------- */

  const { scrollYProgress } = useScroll({
    // No stage, no target: the empty state renders without the ref attached.
    target: count > 0 ? sectionRef : undefined,
    offset: ["start start", "end start"],
  });
  /*
   * Function transforms on purpose. Given range arrays, motion hands opacity
   * to a native scroll timeline, whose offset resolution disagreed with the
   * JS-driven transforms here — the copy sat at ~77% opacity at scroll 0 on
   * phones. A function can't be offloaded, so every value below shares the
   * one measured progress and stays in lockstep.
   */
  const stageScale = useTransform(scrollYProgress, (p) => 1 - (1 - CARD_SCALE) * clamp01(p));
  const cornerScale = useTransform(scrollYProgress, (p) => clamp01(p / 0.3));
  const artY = useTransform(scrollYProgress, (p) => `${12 * clamp01(p)}%`);
  const copyOpacity = useTransform(scrollYProgress, (p) => 1 - clamp01((p - 0.04) / 0.38));
  const copyY = useTransform(scrollYProgress, (p) => -64 * clamp01(p / 0.5));

  if (!active) return <HeroEmpty />;

  const artVariants: Variants = {
    enter: (how: Change) => ({ opacity: how === "swipe" || calm ? 1 : 0, zIndex: 2 }),
    center: { opacity: 1, zIndex: 2, transition: { duration: calm ? 0 : 1.2, ease: EASE } },
    // The outgoing art stays opaque underneath while the new one fades in on
    // top, so a crossfade never dips through the black stage.
    exit: (how: Change) => ({
      opacity: 0,
      zIndex: 1,
      transition: how === "swipe" || calm ? { duration: 0 } : { delay: 1.1, duration: 0.1 },
    }),
  };

  const copyVariants: Variants = {
    hidden: {},
    shown: { transition: { staggerChildren: calm ? 0 : 0.06, delayChildren: calm ? 0 : 0.08 } },
    gone: { opacity: 0, transition: { duration: calm ? 0 : 0.2 } },
  };
  const itemVariants: Variants = {
    hidden: { opacity: 0, y: calm ? 0 : 18 },
    shown: { opacity: 1, y: 0, transition: { duration: calm ? 0 : 0.62, ease: EASE } },
  };

  const trailerPaused = userPaused || !visible;

  return (
    <section
      ref={sectionRef}
      aria-roledescription="carousel"
      aria-label="Featured games"
      onKeyDown={onKeyDown}
      onFocusCapture={(event) => {
        if ((event.target as Element).matches?.(":focus-visible")) setKeyboardFocus(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardFocus(false);
      }}
      className={cn(
        "relative isolate text-white",
        // Phones: exactly the space above the floating tab bar, so the pills
        // and pause control are never hidden behind it (iPhone SE included).
        "h-[calc(100svh_-_5.75rem_-_env(safe-area-inset-bottom))] min-h-[440px]",
        "sm:h-[88svh] sm:min-h-[600px] lg:h-[94vh] max-h-[1080px]",
      )}
      data-stage="dark"
      style={HERO_TOKENS}
    >
      <h1 className="sr-only">Featured games</h1>

      {/* ---------------------------------------------------------------- Stage */}
      <motion.div
        ref={stageRef}
        className="absolute inset-0 overflow-hidden bg-black will-change-transform"
        style={calm ? undefined : { scale: stageScale, transformOrigin: "50% 100%" }}
      >
        <motion.div className="absolute inset-0" style={calm ? undefined : { y: artY }}>
          <motion.div
            className="absolute inset-0"
            ref={trackRef}
            style={{ x: dragX }}
            drag={count > 1 ? "x" : false}
            dragDirectionLock
            dragMomentum={false}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            {prev && (
              <div className="absolute inset-y-0 right-full mr-3 w-full">
                <HeroArt game={prev} index={(index - 1 + count) % count} />
              </div>
            )}

            <AnimatePresence initial={false} custom={change}>
              <motion.div
                key={active.id}
                className="absolute inset-0"
                custom={change}
                variants={artVariants}
                initial="enter"
                animate="center"
                exit="exit"
              >
                <HeroArt
                  game={active}
                  index={index}
                  priority={index === 0}
                  drift={!calm}
                  driftPaused={userPaused || !visible}
                  media={
                    showTrailer ? (
                      <BackdropTrailer
                        trailer={trailer}
                        muted={muted}
                        paused={trailerPaused}
                        delayMs={0}
                        onPlayingChange={onPlayingChange}
                        onUnavailable={onUnavailable}
                      />
                    ) : null
                  }
                />
              </motion.div>
            </AnimatePresence>

            {next && (
              <div className="absolute inset-y-0 left-full ml-3 w-full">
                <HeroArt game={next} index={(index + 1) % count} />
              </div>
            )}
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Inverse-rounded corners in the page colour. Scaling them up from
          nothing is a border-radius that grows on the compositor — the stage
          becomes a card without a single repaint of the artwork. They ride a
          sibling layer with the stage's exact transform rather than living
          inside it: inside, they were clipped by the same anti-aliased edge
          as the art, which left a hairline seam along each curve. Outside,
          they overhang the edge and cover it. */}
      {!calm && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ scale: stageScale, transformOrigin: "50% 100%" }}
        >
          <CardCorners scale={cornerScale} />
        </motion.div>
      )}

      {/* ----------------------------------------------------------------- Copy */}
      <motion.div
        className="pointer-events-none relative z-10 flex h-full flex-col justify-end"
        style={calm ? undefined : { opacity: copyOpacity, y: copyY }}
      >
        <Container className="pb-5 sm:pb-8 lg:pb-11">
          <motion.div style={{ opacity: copyDragOpacity }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${count}`}
                variants={copyVariants}
                initial="hidden"
                animate="shown"
                exit="gone"
                className="max-w-[min(640px,100%)]"
              >
                <h2 className="sr-only">{active.name}</h2>

                <motion.div
                  variants={itemVariants}
                  aria-hidden
                  className={cn(
                    "max-w-[min(520px,74vw)] [--hero-logo-h:clamp(64px,19vw,92px)] md:[--hero-logo-h:clamp(96px,10vw,150px)]",
                    "drop-shadow-[0_6px_30px_rgba(0,0,0,0.45)]",
                  )}
                >
                  <GameLogo
                    name={active.name}
                    logo={active.logo}
                    height="var(--hero-logo-h)"
                    priority={index === 0}
                    // The stage stays dark in the light theme too.
                    surface="dark"
                    className="object-[0%_100%]!"
                  />
                </motion.div>

                <motion.div variants={itemVariants} className="mt-4 sm:mt-5">
                  <HeroMeta game={active} />
                </motion.div>

                {active.tagline && (
                  <motion.p
                    variants={itemVariants}
                    className="mt-3 line-clamp-2 max-w-xl text-[15px] leading-snug text-white/80 max-[359px]:hidden sm:text-[17px]"
                  >
                    {active.tagline}
                  </motion.p>
                )}

                {/* Phones: a full-width primary with the two secondary actions
                    sharing the row beneath, instead of wrapping into an orphan. */}
                <motion.div
                  variants={itemVariants}
                  className="pointer-events-auto mt-6 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3"
                  {...hoverHandlers}
                >
                  <Link
                    href={`/game/${active.slug}`}
                    className={cn(
                      "press col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-[16px] font-semibold text-black sm:col-span-1 sm:min-h-[52px] sm:text-[17px]",
                      "shadow-[0_12px_32px_-14px_rgba(0,0,0,0.8)] transition-[background-color] duration-300 fine:hover:bg-white/88",
                      "focus-visible:outline-white",
                    )}
                  >
                    View details
                    <ArrowRight size={17} aria-hidden />
                  </Link>
                  <WatchButton
                    game={active}
                    variant="full"
                    // `!` because cn() doesn't merge: these must beat the
                    // button's own padding so "Follow game" fits on one line
                    // in a half-width column at 320px.
                    className="w-full whitespace-nowrap max-[379px]:gap-1.5! max-[379px]:px-3! max-[379px]:text-[14px]! sm:w-auto"
                  />
                  <OwnershipPicker
                    game={active}
                    className="[&>button]:w-full [&>button]:justify-center [&>button]:whitespace-nowrap max-[379px]:[&>button]:px-3! max-[379px]:[&>button]:text-[14px]! sm:[&>button]:w-auto"
                  />
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </motion.div>

          {/* ----------------------------------------------------- Controls */}
          <div
            className="pointer-events-auto mt-5 flex items-center justify-between gap-3 sm:mt-7"
            {...hoverHandlers}
          >
            <div className="-ml-[5px] coarse:-ml-[6px]">
              <HeroPills
                names={featured.map((game) => game.name)}
                index={index}
                progress={calm ? null : progress}
                accent={tint.accent}
                onSelect={(i) => goTo(i, "manual")}
              />
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {trailerPlaying && (
                <ControlButton
                  label={muted ? "Unmute trailer" : "Mute trailer"}
                  pressed={!muted}
                  onClick={() => setMuted((value) => !value)}
                >
                  {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                </ControlButton>
              )}
              {!calm && count > 1 && (
                <ControlButton
                  label={userPaused ? "Play featured games" : "Pause featured games"}
                  pressed={userPaused}
                  onClick={() => setUserPaused((value) => !value)}
                >
                  {userPaused ? <Play size={16} className="translate-x-px" /> : <Pause size={16} />}
                </ControlButton>
              )}
              {next && (
                <UpNext game={next} onSelect={() => goTo(index + 1, "manual")} className="ml-2 hidden lg:flex" />
              )}
            </div>
          </div>
        </Container>
      </motion.div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function ControlButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn(
        "press grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/30 text-white/85",
        "backdrop-blur-xl transition-colors duration-300 fine:hover:bg-black/50 fine:hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

/** Desktop peek at the next slide: its art, its name, one click to go. */
function UpNext({
  game,
  onSelect,
  className,
}: {
  game: SpotlightGame;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.button
        key={game.id}
        type="button"
        onClick={onSelect}
        aria-label={`Next: ${game.name}`}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -8 }}
        transition={{ duration: 0.45, ease: EASE }}
        className={cn(
          "press group items-center gap-3 rounded-2xl border border-white/15 bg-black/30 p-1.5 pr-4 text-left backdrop-blur-xl",
          "transition-colors duration-300 fine:hover:border-white/25 fine:hover:bg-black/45",
          className,
        )}
      >
        <span className="relative block h-[54px] w-24 shrink-0 overflow-hidden rounded-[11px]">
          <GameCover
            name={game.name}
            slug={game.slug}
            image={game.screenshots[0] ?? game.image}
            imageFallback={game.imageFallback}
            width={320}
            sizes="96px"
            className="transition-transform duration-700 ease-[var(--ease-apple)] group-hover:scale-105"
          />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-white/55">
            Up next
          </span>
          <span className="mt-0.5 flex max-w-[190px] items-center gap-1 text-[14px] font-semibold text-white">
            <span className="truncate">{game.name}</span>
            <ChevronRight size={14} aria-hidden className="shrink-0 text-white/60 transition-transform group-hover:translate-x-0.5" />
          </span>
        </span>
      </motion.button>
    </AnimatePresence>
  );
}

/**
 * Four inverse-rounded corners, filled with the page background and scaled
 * from their own corner. At scale 0 the stage is square and full-bleed; at 1
 * it reads as a 28px-radius card.
 */
function CardCorners({ scale }: { scale: MotionValue<number> }) {
  // Each cap overhangs the stage edge by 2px (30px box, curve centred 28px
  // in), so the stage's own anti-aliased edge is painted over, not beside.
  const corners = [
    { className: "-left-0.5 -top-0.5", origin: "0% 0%", at: "100% 100%" },
    { className: "-right-0.5 -top-0.5", origin: "100% 0%", at: "0% 100%" },
    { className: "-bottom-0.5 -left-0.5", origin: "0% 100%", at: "100% 0%" },
    { className: "-bottom-0.5 -right-0.5", origin: "100% 100%", at: "0% 0%" },
  ];
  return (
    <>
      {corners.map((corner) => (
        <motion.span
          key={corner.origin}
          aria-hidden
          className={cn("absolute h-[30px] w-[30px]", corner.className)}
          style={{
            scale,
            transformOrigin: corner.origin,
            background: `radial-gradient(circle at ${corner.at}, transparent 27.5px, var(--color-bg) 28px)`,
          }}
        />
      ))}
    </>
  );
}

/** No spotlight data: an honest, still-useful front door rather than an empty stage. */
function HeroEmpty() {
  return (
    <section className="noise relative isolate flex min-h-[62svh] items-end overflow-hidden border-b border-line">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_24%,rgba(124,92,255,0.24),transparent_36%),radial-gradient(circle_at_82%_12%,rgba(34,211,238,0.12),transparent_32%)]"
      />
      <Container className="pb-14 pt-32 sm:pb-18 lg:pb-24 lg:pt-44">
        <p className="text-sm font-semibold text-brand-soft">Your game universe, one place</p>
        <h1 className="mt-4 max-w-4xl font-display text-[clamp(2.6rem,8vw,5.8rem)] font-black leading-[0.92] tracking-[-0.05em]">
          Never miss the game worth waiting for.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          Explore releases, build your collection, and follow only the games whose launches and DLC matter to you.
          Live discovery will refill automatically when the catalogue reconnects.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button href="/browse" size="lg" iconRight={<ArrowRight size={17} />}>
            Explore the catalogue
          </Button>
          <Button href="/stats" size="lg" variant="secondary">
            Open personal stats
          </Button>
        </div>
      </Container>
    </section>
  );
}
