"use client";

/**
 * Pointer-tracked 3D tilt with a soft specular highlight, for covers.
 *
 * The pointer handler does one thing: once per animation frame it writes the
 * pointer's position over the card (−0.5…0.5 on each axis) into `--tilt-x`
 * and `--tilt-y` on the root element. The rotation, the lift and the
 * highlight's position are all derived from those two variables in CSS
 * (`.tilt*` in globals.css), and a short transition does the smoothing a
 * spring used to. No React state, so nothing re-renders while the mouse
 * moves, and an idle card carries no animation machinery at all.
 *
 * Desktop only by construction: the transform exists only under the `fine`
 * pointer media query, the handlers ignore anything but a mouse, and reduced
 * motion (OS or the in-app switch) is checked as the pointer arrives. The
 * markup is identical on the server, on touch and on desktop, so hydration
 * never swaps the card's subtree (which used to remount every cover).
 *
 * Pressing flattens the card, so a click's cover morph (view transition)
 * starts from a level poster.
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  /** Maximum rotation in degrees at the card's edges. */
  intensity?: number;
  /** Perspective distance — lower is a more dramatic effect. */
  perspective?: number;
  scale?: number;
  glare?: boolean;
}

/** Read as the pointer arrives rather than subscribed to: idle cards cost nothing. */
function tiltAllowed(): boolean {
  if (document.documentElement.dataset.reduceMotion === "true") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TiltCard({
  children,
  className,
  intensity = 7,
  perspective = 900,
  scale = 1.02,
  glare = true,
}: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const point = useRef({ x: 0, y: 0 });

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const write = () => {
    frame.current = 0;
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tilt-x", point.current.x.toFixed(3));
    el.style.setProperty("--tilt-y", point.current.y.toFixed(3));
  };

  const rest = () => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    delete el.dataset.tilt;
    el.style.setProperty("--tilt-x", "0");
    el.style.setProperty("--tilt-y", "0");
  };

  const onPointerEnter = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !tiltAllowed()) return;
    ref.current?.setAttribute("data-tilt", "on");
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || el.dataset.tilt !== "on") return;
    // One layout read per event, on the element that already has a layer.
    const rect = el.getBoundingClientRect();
    point.current = {
      x: Math.max(-0.5, Math.min(0.5, (event.clientX - rect.left) / rect.width - 0.5)),
      y: Math.max(-0.5, Math.min(0.5, (event.clientY - rect.top) / rect.height - 0.5)),
    };
    if (!frame.current) frame.current = requestAnimationFrame(write);
  };

  const style = {
    "--tilt-max": `${intensity}deg`,
    "--tilt-scale": scale,
    "--tilt-perspective": `${perspective}px`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={rest}
      onPointerDown={rest}
      style={style}
      className={cn("tilt relative", className)}
    >
      <div className="tilt-body">
        {children}
        {glare && <span aria-hidden className="tilt-glare" />}
      </div>
    </div>
  );
}
