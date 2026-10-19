"use client";

import { useAnimationFrame, useMotionValue, type MotionValue } from "motion/react";
import { useEffect, useRef } from "react";

/** When a slide's duration shrinks below what has already elapsed, finish over this long rather than cutting. */
const MIN_FINISH_MS = 1400;
/** A frame delta above this is a stall (tab switch, debugger), not time the reader watched. */
const MAX_FRAME_MS = 100;

/**
 * The carousel's clock, as a motion value rather than React state.
 *
 * Progress drives the active pill's fill directly on the compositor, so a
 * running slide costs zero React renders. It is *re-timed*, not restarted,
 * when the slide's duration changes mid-flight: a slide whose trailer starts
 * playing three seconds in earns the longer hold, and the pill simply slows
 * from where it is instead of jumping backwards. Each frame advances by the
 * share of the remaining distance that the frame represents of the remaining
 * time, which is linear within any fixed duration and continuous across a
 * change.
 *
 * `running` false freezes it exactly in place (hover, focus, drag, off-screen,
 * the pause button); `resetKey` changing starts a fresh slide at zero.
 */
export function useSlideClock({
  durationMs,
  running,
  resetKey,
  onComplete,
}: {
  durationMs: number;
  running: boolean;
  resetKey: string | number;
  onComplete: () => void;
}): MotionValue<number> {
  const progress = useMotionValue(0);
  const elapsed = useRef(0);
  const end = useRef(durationMs);
  const done = useRef(false);
  const durationRef = useRef(durationMs);
  const runningRef = useRef(running);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    runningRef.current = running;
    onCompleteRef.current = onComplete;
  });

  // Declared before the reset below so a slide change that also changes the
  // duration starts from the new value.
  useEffect(() => {
    durationRef.current = durationMs;
    end.current = Math.max(durationMs, elapsed.current + MIN_FINISH_MS);
  }, [durationMs]);

  useEffect(() => {
    elapsed.current = 0;
    end.current = durationRef.current;
    done.current = false;
    progress.set(0);
  }, [resetKey, progress]);

  useAnimationFrame((_, delta) => {
    if (!runningRef.current || done.current) return;
    const step = Math.min(delta, MAX_FRAME_MS);
    elapsed.current += step;
    const remaining = end.current - elapsed.current;
    if (remaining <= 0) {
      done.current = true;
      progress.set(1);
      onCompleteRef.current();
      return;
    }
    const p = progress.get();
    progress.set(p + (1 - p) * (step / (remaining + step)));
  });

  return progress;
}
