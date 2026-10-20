"use client";

/**
 * The game's own artwork as an ambient light under the top of its page —
 * Apple Music's "now playing" backdrop: the art blurred past recognition,
 * its colour pools drifting slowly behind At a glance and the story.
 *
 * Cheap by construction:
 *  - the source is the smallest copy the host has (`ambientImage`);
 *  - it is blurred exactly once, by drawing it down to a 12×7 canvas and
 *    back up to 48×27 with smoothing — no `filter: blur()` anywhere, so
 *    nothing is re-blurred per frame;
 *  - the browser stretches those tiny bitmaps to fill, and CSS keyframes
 *    move them with `transform` only (`.art-ambient` in globals.css);
 *  - the drift pauses while the layer is off screen, and the global
 *    reduced-motion rules freeze it.
 *
 * The light theme gets a lifted, more saturated rendering so it reads as
 * coloured light on the pale page rather than a grey smudge; it redraws when
 * the appearance changes. Drawing a cross-origin image taints the canvas,
 * which is fine — nothing ever reads pixels back.
 *
 * Client-only (loaded through `lazy.tsx`): nothing to server-render, and the
 * layer simply fades in once drawn.
 */

import { useEffect, useRef, useState } from "react";

const SMALL = { w: 12, h: 7 };
const SHOWN = { w: 48, h: 27 };

function paint(canvas: HTMLCanvasElement, image: HTMLImageElement, mirrored: boolean, light: boolean): boolean {
  const small = document.createElement("canvas");
  small.width = SMALL.w;
  small.height = SMALL.h;
  const smallCtx = small.getContext("2d");
  const ctx = canvas.getContext("2d");
  if (!smallCtx || !ctx) return false;

  // Down in two steps: a single 500px → 12px draw aliases (bright specks
  // decide the colour) in engines that only sample bilinearly.
  const mid = document.createElement("canvas");
  mid.width = 64;
  mid.height = 36;
  const midCtx = mid.getContext("2d");
  if (!midCtx) return false;
  midCtx.imageSmoothingQuality = "high";
  midCtx.drawImage(image, 0, 0, mid.width, mid.height);
  smallCtx.imageSmoothingQuality = "high";
  smallCtx.drawImage(mid, 0, 0, SMALL.w, SMALL.h);

  canvas.width = SHOWN.w;
  canvas.height = SHOWN.h;
  ctx.save();
  if (mirrored) {
    ctx.translate(SHOWN.w, 0);
    ctx.scale(-1, 1);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // `filter` on a 2D context is a progressive enhancement (Safari lacks it);
  // without it the colours are simply a little flatter.
  if ("filter" in ctx) ctx.filter = light ? "saturate(1.6) brightness(1.15)" : "saturate(1.5)";
  ctx.drawImage(small, 0, 0, SHOWN.w, SHOWN.h);
  ctx.restore();
  if (light) {
    // Lift the shadows: dark key art should glow on a light page, not stain it.
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.fillRect(0, 0, SHOWN.w, SHOWN.h);
    ctx.globalCompositeOperation = "source-over";
  } else {
    // Dark: keep the hue, drop the light. Bright key art (a daytime sky)
    // otherwise greys out the page and the body text sitting over it.
    ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
    ctx.fillRect(0, 0, SHOWN.w, SHOWN.h);
  }
  return true;
}

export default function ArtAmbient({ src }: { src: string | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLCanvasElement>(null);
  const secondRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!src) return;
    const image = new Image();
    image.decoding = "async";
    let cancelled = false;

    const draw = () => {
      if (cancelled || !image.naturalWidth) return;
      const light = document.documentElement.dataset.theme === "light";
      const first = firstRef.current;
      const second = secondRef.current;
      const ok = Boolean(first && paint(first, image, false, light) && second && paint(second, image, true, light));
      setReady(ok);
    };

    image.onload = draw;
    image.src = src;

    // The appearance can flip at any time (Settings, or the OS at sunset).
    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      cancelled = true;
      image.onload = null;
      themeObserver.disconnect();
    };
  }, [src]);

  // Composited animations keep ticking off screen; stop them there.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setPaused(!entry.isIntersecting));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  if (!src) return null;
  return (
    <div ref={rootRef} aria-hidden className="art-ambient" data-ready={ready} data-paused={paused}>
      <canvas ref={firstRef} width={SHOWN.w} height={SHOWN.h} />
      <canvas ref={secondRef} width={SHOWN.w} height={SHOWN.h} />
    </div>
  );
}
