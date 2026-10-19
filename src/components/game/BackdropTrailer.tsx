"use client";

/**
 * A trailer playing as a page backdrop, with no player chrome.
 *
 * Shared by the homepage hero and every game page, so "cinematic backdrop"
 * behaves identically wherever it appears.
 *
 * Hiding YouTube's UI takes two things, because the embed parameters alone are
 * not enough:
 *
 *  1. `controls=0&modestbranding=1&iv_load_policy=3&…` removes the control bar,
 *     annotations and most branding.
 *  2. The iframe is then scaled well beyond the frame and centred, so the
 *     residual title bar and the share/watch-later buttons — which live in the
 *     player's top corners and cannot be disabled by any parameter — are pushed
 *     outside the visible area entirely.
 *
 * `pointer-events: none` covers the rest: nothing in the layer is clickable, so
 * no stray click can navigate to YouTube.
 *
 * ---------------------------------------------------------------------------
 * Proving the video actually plays
 *
 * A large share of game trailers are age-restricted, and those render YouTube's
 * "This video is age-restricted and only available on YouTube" panel *inside*
 * the frame — full-width grey text across the hero, which is worse than having
 * no video at all.
 *
 * None of the cheap server-side checks catch it: oEmbed returns 200 for
 * age-restricted videos (verified against Cyberpunk 2077's trailers), and the
 * embed page resolves its playability client-side, so fetching its HTML reveals
 * nothing either.
 *
 * So the player is asked directly. With `enablejsapi=1` the embed answers a
 * `{"event":"listening"}` handshake over `postMessage` and then reports its own
 * state. The iframe is mounted but held at `opacity: 0` until it confirms it is
 * *playing*; anything else — an error code, a restriction panel, autoplay
 * refused by the browser — simply never reveals it, and the still artwork
 * underneath remains. Proving success rather than guessing failure means every
 * unknown degrades to the artwork, which is the desired fallback anyway.
 *
 * "Playing" is also not enough on its own. For the first couple of seconds the
 * embed overlays its own centre transport (previous / pause / next) on top of
 * the video, and most trailers open on a black studio card besides. Waiting
 * until the player reports a few seconds of *elapsed playback* skips both, so
 * the dissolve lands on actual footage.
 *
 * ---------------------------------------------------------------------------
 * Controlling a running player
 *
 * Mute and pause go over the same channel as player commands rather than by
 * rebuilding the `src`. Changing the URL reloads the embed — the trailer jumps
 * back to its studio card, and the new frame never re-runs the handshake, so
 * it could be shown without ever having proven it plays.
 */

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRichMotion } from "@/hooks";
import { cn } from "@/lib/utils/cn";
import type { Trailer } from "@/lib/games/types";

/** Beat before the trailer replaces the still, so the page never opens blank. */
const DEFAULT_DELAY_MS = 1800;

/**
 * Seconds of confirmed playback before the video is revealed. Long enough to
 * clear YouTube's start-up transport overlay and the usual black studio card.
 */
const REVEAL_AT_SECONDS = 2.6;

/**
 * How long the player gets to prove itself (handshake, buffering, and the
 * reveal threshold above).
 *
 * Generous enough for a cold embed on a slow connection, short enough that a
 * blocked video doesn't leave the page waiting on something that will never
 * arrive.
 */
const PLAYBACK_GRACE_MS = 9000;

/** YouTube's player states; 1 is PLAYING. */
const STATE_PLAYING = 1;

export function youtubeBackdropSrc(id: string, muted: boolean, origin?: string): string {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    modestbranding: "1",
    rel: "0",
    showinfo: "0",
    iv_load_policy: "3",
    disablekb: "1",
    fs: "0",
    playsinline: "1",
    cc_load_policy: "0",
    // A single-video playlist is what makes `loop` actually loop.
    loop: "1",
    playlist: id,
    // Opens the postMessage channel the playback check depends on.
    enablejsapi: "1",
  });
  if (origin) params.set("origin", origin);
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`;
}

export function BackdropTrailer({
  trailer,
  muted = true,
  paused = false,
  delayMs = DEFAULT_DELAY_MS,
  className,
  onPlayingChange,
  onUnavailable,
}: {
  trailer: Trailer | null;
  muted?: boolean;
  /**
   * Freezes playback in place (the frame stays visible). Used when the reader
   * pauses the hero, scrolls it away, or hides the tab — a video nobody can
   * see shouldn't keep decoding.
   */
  paused?: boolean;
  delayMs?: number;
  className?: string;
  /**
   * Fires when playback is confirmed or lost. The carousel uses this to hold a
   * slide longer once a trailer is genuinely running, rather than guessing.
   */
  onPlayingChange?: (playing: boolean) => void;
  /**
   * Fires once if the player errors or never proves itself within the grace
   * period — the artwork is staying, so callers can stop waiting for video.
   */
  onUnavailable?: () => void;
}) {
  const richMotion = useRichMotion();
  const [mounted, setMounted] = useState(false);
  /** Flips true only once the player reports sustained playback. */
  const [confirmed, setConfirmed] = useState(false);
  /**
   * The mute state baked into the embed URL, captured when the player mounts.
   * Later changes go over postMessage — see "Controlling a running player".
   */
  const [srcMuted, setSrcMuted] = useState(muted);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mutedRef = useRef(muted);
  const confirmedRef = useRef(false);
  const onUnavailableRef = useRef(onUnavailable);

  useEffect(() => {
    mutedRef.current = muted;
    onUnavailableRef.current = onUnavailable;
  });

  const youtubeId = trailer?.kind === "youtube" ? trailer.youtubeId ?? null : null;
  const videoUrl = trailer?.kind !== "youtube" ? trailer?.url ?? null : null;

  useEffect(() => {
    if (!richMotion || !trailer) {
      // Deferred a frame so nothing is written during the effect itself.
      const frame = requestAnimationFrame(() => setMounted(false));
      return () => cancelAnimationFrame(frame);
    }
    const id = setTimeout(() => {
      setSrcMuted(mutedRef.current);
      setMounted(true);
    }, delayMs);
    return () => clearTimeout(id);
  }, [richMotion, trailer, delayMs]);

  // A new video is unproven until it says otherwise.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setConfirmed(false));
    return () => cancelAnimationFrame(frame);
  }, [youtubeId, videoUrl]);

  // Reported as an effect rather than from the message handler so the parent
  // hears every transition, including the reset above.
  useEffect(() => {
    confirmedRef.current = confirmed;
    onPlayingChange?.(confirmed);
  }, [confirmed, onPlayingChange]);

  /* --- The postMessage conversation with YouTube's player ---------------- */
  useEffect(() => {
    if (!mounted || !youtubeId) return;

    const win = frameRef.current?.contentWindow;
    if (!win) return;

    const send = (event: string) => {
      try {
        win.postMessage(JSON.stringify({ event, id: youtubeId, channel: "widget" }), "*");
      } catch {
        /* frame torn down mid-handshake */
      }
    };

    // The embed only starts reporting after it hears this, and it can miss the
    // first one if it is still booting — hence the short repeat.
    const handshake = setInterval(() => send("listening"), 400);
    let lastState: number | undefined;
    let settled = false;

    const fail = () => {
      if (settled) return;
      settled = true;
      clearInterval(handshake);
      setConfirmed(false);
      onUnavailableRef.current?.();
    };

    const onMessage = (event: MessageEvent) => {
      let host: string;
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (!/youtube(-nocookie)?\.com$/.test(host)) return;
      let payload: { event?: string; info?: unknown };
      try {
        payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }

      if (payload?.event === "onError") {
        // 101/150 are "embedding disabled by request"; anything else is just as
        // unplayable for our purposes.
        fail();
        return;
      }

      /*
       * The state arrives under two different shapes, and only one of them is
       * the documented `onStateChange`. In practice the embed reports almost
       * everything through `infoDelivery`, whose `info` is a status object
       * carrying `playerState` and `currentTime` — listening only for
       * `onStateChange` means the "it's playing" signal never arrives and
       * every trailer stays hidden.
       */
      if (payload?.event !== "onStateChange" && payload?.event !== "infoDelivery") return;
      const info = payload.info;
      const status = typeof info === "object" && info !== null
        ? (info as { playerState?: number; currentTime?: number })
        : null;
      const state = typeof info === "number" ? info : status?.playerState;
      if (typeof state === "number") lastState = state;

      // Revealed only after sustained playback — see "Proving the video
      // actually plays" above. Once proven it stays proven; a later pause
      // (ours, or a buffering stall) keeps the frame rather than flickering.
      const time = status?.currentTime;
      if (
        !settled &&
        lastState === STATE_PLAYING &&
        typeof time === "number" &&
        time >= REVEAL_AT_SECONDS
      ) {
        settled = true;
        clearInterval(handshake);
        setConfirmed(true);
      }
    };

    window.addEventListener("message", onMessage);
    // Nothing confirmed in time means blocked, restricted, or autoplay refused.
    const giveUp = setTimeout(fail, PLAYBACK_GRACE_MS);

    return () => {
      clearInterval(handshake);
      clearTimeout(giveUp);
      window.removeEventListener("message", onMessage);
    };
  }, [mounted, youtubeId]);

  /* --- Commands: mute and pause without reloading ------------------------ */
  const command = useCallback(
    (func: string) => {
      const win = frameRef.current?.contentWindow;
      if (!win || !youtubeId) return;
      try {
        win.postMessage(
          JSON.stringify({ event: "command", func, args: [], id: youtubeId, channel: "widget" }),
          "*",
        );
      } catch {
        /* frame gone */
      }
    },
    [youtubeId],
  );

  useEffect(() => {
    if (!mounted) return;
    if (youtubeId) command(muted ? "mute" : "unMute");
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [mounted, muted, youtubeId, command]);

  useEffect(() => {
    if (!mounted) return;
    if (youtubeId) command(paused ? "pauseVideo" : "playVideo");
    const video = videoRef.current;
    if (video) {
      if (paused) video.pause();
      else void video.play().catch(() => {});
    }
  }, [mounted, paused, youtubeId, command]);

  // MP4s have no start-up overlay, but the same "sustained playback" rule
  // keeps a stalled first frame from being revealed.
  const onVideoTime = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!confirmedRef.current && event.currentTarget.currentTime >= 0.4) setConfirmed(true);
  }, []);
  const onVideoError = useCallback(() => {
    setConfirmed(false);
    onUnavailableRef.current?.();
  }, []);

  const playable = Boolean(youtubeId || videoUrl);
  if (!mounted || !trailer || !playable) return null;

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden", className)}
      // Nothing inside is interactive, so no click can reach YouTube.
      style={{ pointerEvents: "none" }}
      aria-hidden
    >
      <AnimatePresence>
        {/*
          Always mounted so it can play and report; only ever *revealed* once it
          confirms. An age-restricted video therefore loads, fails, and is never
          shown — the artwork underneath simply stays.
        */}
        <motion.div
          key={youtubeId ?? videoUrl}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: confirmed ? 1 : 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
        >
          {youtubeId ? (
            <iframe
              ref={frameRef}
              key={youtubeId}
              src={youtubeBackdropSrc(
                youtubeId,
                srcMuted,
                typeof window !== "undefined" ? window.location.origin : undefined,
              )}
              title=""
              allow="autoplay; encrypted-media"
              tabIndex={-1}
              aria-hidden
              /*
               * Oversized and centred: this is what actually removes the
               * player's title bar and corner buttons. `min-w-[177.77vh]`
               * keeps the 16:9 crop correct on short, wide viewports where a
               * percentage width alone would letterbox.
               */
              className={cn(
                "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-0",
                "h-[300%] w-[300%] sm:h-[180%] sm:w-[180%] lg:h-[145%] lg:w-[145%]",
                "min-h-[100vh] min-w-[177.77vh]",
              )}
            />
          ) : videoUrl ? (
            <video
              ref={videoRef}
              key={videoUrl}
              src={videoUrl}
              autoPlay
              muted={srcMuted}
              loop
              playsInline
              onTimeUpdate={onVideoTime}
              onError={onVideoError}
              poster={trailer.preview ?? undefined}
              className="h-full w-full object-cover"
            />
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
