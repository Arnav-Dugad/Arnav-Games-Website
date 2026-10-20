"use client";

/**
 * The game page's trailer: the backdrop video plus the controls and
 * choreography that let it actually be seen.
 *
 * The trailer used to play under the full scrim stack and behind the cover,
 * logo and two rows of facts — on most screens a few hundred pixels of moving
 * colour in a corner. Now, once playback is proven, the stage goes
 * "cinematic": after a few seconds without input the secondary chrome (cover,
 * breadcrumbs, facts, the personal row) fades away and the scrims thin out,
 * leaving the title, the primary actions and the footage. Any pointer move,
 * touch, scroll or keyboard focus inside the hero brings everything back —
 * the Netflix / Apple TV pattern.
 *
 * State is published on the hero as `data-trailer` ("idle" | "playing" |
 * "cinema") so the server-rendered markup can respond with plain
 * `group-data-[trailer=…]/hero:` classes, without becoming a client tree.
 *
 * Sound is opt-in through the mute button. It pauses when the hero leaves
 * the screen or the tab is hidden — audio from a page you've scrolled past
 * is the worst kind of surprise.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Volume2, VolumeX } from "lucide-react";
import { BackdropTrailer, useConstrainedData } from "@/components/game/BackdropTrailer";
import { GAME_HERO_ID } from "@/components/game/GameDetailDock";
import type { Trailer } from "@/lib/games/types";
import { cn } from "@/lib/utils/cn";

/** Quiet time before the chrome steps aside. */
const CINEMA_AFTER_MS = 3500;

type Phase = "idle" | "playing" | "cinema";

export function HeroTrailer({ trailer }: { trailer: Trailer | null }) {
  const constrained = useConstrainedData();
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [quiet, setQuiet] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The hero element, once mounted: the mute button is portalled into it. */
  const [hero, setHero] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setHero(document.getElementById(GAME_HERO_ID)));
    return () => cancelAnimationFrame(frame);
  }, []);

  const phase: Phase = !playing ? "idle" : quiet ? "cinema" : "playing";

  // Publish the phase on the hero for the server markup's CSS.
  useEffect(() => {
    const hero = document.getElementById(GAME_HERO_ID);
    if (!hero) return;
    hero.dataset.trailer = phase;
    return () => {
      delete hero.dataset.trailer;
    };
  }, [phase]);

  // Interaction wakes the chrome; quiet puts it back to sleep.
  const wake = useCallback(() => {
    setQuiet(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuiet(true), CINEMA_AFTER_MS);
  }, []);

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    const hero = document.getElementById(GAME_HERO_ID);
    if (!hero) return;
    // Playback just started with the chrome up; start the quiet countdown.
    timer.current = setTimeout(() => setQuiet(true), CINEMA_AFTER_MS);
    const events = ["pointermove", "pointerdown", "focusin", "keydown", "wheel"] as const;
    events.forEach((name) => hero.addEventListener(name, wake, { passive: true }));
    return () => {
      events.forEach((name) => hero.removeEventListener(name, wake));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, wake]);

  // Pause off screen and in background tabs.
  useEffect(() => {
    const hero = document.getElementById(GAME_HERO_ID);
    if (!hero || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.intersectionRatio > 0.25), {
      threshold: [0, 0.25, 0.5],
    });
    observer.observe(hero);
    const onVisibility = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Scrolling away wakes the chrome too, so it's there when you come back.
  useEffect(() => {
    if (!onScreen) {
      const frame = requestAnimationFrame(() => setQuiet(false));
      return () => cancelAnimationFrame(frame);
    }
  }, [onScreen]);

  return (
    <>
      {/* Rendered in place: between the key art and the scrims. */}
      <BackdropTrailer
        trailer={trailer}
        muted={muted}
        paused={!onScreen || !tabVisible}
        // Phones too, unless the reader is saving data (reduced motion is
        // still honoured inside BackdropTrailer).
        touch={!constrained}
        onPlayingChange={setPlaying}
      />

      {/* The button lives in the backdrop layer's component but must sit
          above the hero's content, so it is portalled to the hero itself. */}
      {playing && hero && createPortal(
        <button
          type="button"
          onClick={() => {
            setMuted((value) => !value);
            wake();
          }}
          aria-label={muted ? "Unmute trailer" : "Mute trailer"}
          aria-pressed={!muted}
          className={cn(
            "press absolute right-4 top-[calc(env(safe-area-inset-top)+4.75rem)] z-10 inline-flex h-11 items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3.5 text-[13px] font-semibold text-white backdrop-blur-md transition-[background-color,opacity] duration-300 hover:bg-black/55 sm:right-6 sm:top-24 lg:right-10",
            // Fades with the rest of the chrome, but never fully: it is the one
            // control the cinematic view exists for.
            phase === "cinema" && "opacity-70",
          )}
        >
          {muted ? <VolumeX size={17} aria-hidden /> : <Volume2 size={17} aria-hidden />}
          <span className="max-sm:sr-only">{muted ? "Unmute" : "Mute"}</span>
        </button>,
        hero,
      )}
    </>
  );
}
