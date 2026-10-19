"use client";

/**
 * Ambient particles behind the game hero, tinted with the cover's accent: a
 * slow drift of soft motes, like dust in a projector beam. Decoration only —
 * `HeroParticlesGate` loads this on desktop with motion allowed.
 *
 * Kept cheap on purpose: ~34 particles on one 2D canvas, additive blending,
 * device pixel ratio capped at 1.5, and the loop stops whenever the hero is
 * off-screen or the tab is hidden (an IntersectionObserver plus
 * `visibilitychange`), so it costs nothing once you scroll past.
 */

import { useEffect, useRef } from "react";

interface Mote {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  phase: number;
  alpha: number;
  tint: number;
}

const COUNT = 34;

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function HeroParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    // The hero's own accent (set on the stage by the page theme); a warm white
    // second tint keeps it from reading as a single flat colour.
    const accent = hexToRgb(getComputedStyle(canvas).getPropertyValue("--game-accent")) ?? [164, 147, 255];
    const tints: [number, number, number][] = [accent, accent, [255, 244, 228]];

    let width = 0;
    let height = 0;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const spawn = (anywhere: boolean): Mote => ({
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : height + 10,
      r: 0.8 + Math.random() * 2.2,
      vy: 6 + Math.random() * 16,
      sway: 6 + Math.random() * 18,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.18 + Math.random() * 0.45,
      tint: Math.floor(Math.random() * tints.length),
    });
    const motes = Array.from({ length: COUNT }, () => spawn(true));

    let frame = 0;
    let last = 0;
    let visible = true;
    let running = false;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";
      for (const mote of motes) {
        mote.y -= mote.vy * dt;
        mote.phase += dt * 0.6;
        if (mote.y < -10) Object.assign(mote, spawn(false));
        const x = mote.x + Math.sin(mote.phase) * mote.sway;
        // Fade in from the bottom and out towards the top, so motes never pop.
        const life = Math.max(0, Math.min(1, mote.y / (height * 0.25), (height - mote.y) / (height * 0.2)));
        const twinkle = 0.75 + 0.25 * Math.sin(mote.phase * 2.3);
        const [r, g, b] = tints[mote.tint];
        const glow = context.createRadialGradient(x, mote.y, 0, x, mote.y, mote.r * 4);
        glow.addColorStop(0, `rgba(${r},${g},${b},${(mote.alpha * life * twinkle).toFixed(3)})`);
        glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
        context.fillStyle = glow;
        context.beginPath();
        context.arc(x, mote.y, mote.r * 4, 0, Math.PI * 2);
        context.fill();
      }
      frame = requestAnimationFrame(draw);
    };

    const sync = () => {
      const shouldRun = visible && document.visibilityState === "visible";
      if (shouldRun && !running) {
        running = true;
        last = performance.now();
        frame = requestAnimationFrame(draw);
      } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(frame);
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(canvas);
    const sizer = new ResizeObserver(resize);
    sizer.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    sync();
    // Eases in rather than appearing: it arrives after the hero has painted.
    canvas.animate([{ opacity: 0 }, { opacity: 0.85 }], { duration: 1400, easing: "ease-out", fill: "forwards" });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      sizer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-0" />;
}
