"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import type { GameLogo as GameLogoData } from "@/lib/games/types";
import { cn } from "@/lib/utils/cn";

/**
 * A game's official wordmark, with an honest typographic fallback.
 *
 * Logos arrive in three tones (see `GameLogo` in types.ts). On this dark UI:
 *
 *  - "light" (white marks) render as-is, with a soft shadow so they hold up
 *    over bright key art — and are inverted on the light theme's pale
 *    surfaces, unless `surface="dark"`.
 *  - "dark" (black marks) are inverted — otherwise they vanish into the
 *    background. The inversion is a class keyed off `data-logo-tone` and is
 *    undone under `[data-theme="light"]`, so the light theme shows the mark
 *    as drawn — unless `surface="dark"` says the backdrop stays dark.
 *  - "color" marks are designed to work anywhere and are left alone.
 *
 * With no logo, or when the image fails to load, the game's name is set as
 * a wordmark in the display face instead — never a broken image.
 *
 * `reveal` (opt-in) plays a one-time entrance the first time the mark scrolls
 * into view:
 *  - image logos: the mark arrives as vertical slices, staggered left to
 *    right, each rising from a slightly different depth and passing through a
 *    brief over-exposure — which reads as a light sweeping across the logo
 *    without needing a CSS mask (masks over cross-origin IGDB art are blocked
 *    by CORS).
 *  - the wordmark fallback: a true letter-by-letter rise, blur to sharp.
 *  - reduced motion (OS or the in-app switch): a plain fade.
 * `true` picks the style that fits the content. `"slices"` / `"letters"`
 * state a preference; an image asked for `"letters"` gets one unified
 * rise-and-focus instead (an image has no letters), and a wordmark asked for
 * `"slices"` still gets letters.
 */

export type GameLogoReveal = boolean | "letters" | "slices";

export interface GameLogoProps {
  name: string;
  logo?: GameLogoData | null;
  className?: string;
  /** Rendered height of the mark; the width follows its aspect ratio. */
  height?: number | string;
  align?: "start" | "center";
  priority?: boolean;
  fallback?: "wordmark" | "none";
  /**
   * "auto" follows the page theme. "dark" is for surfaces that stay dark in
   * both themes (heroes over key art): black marks are always inverted and
   * the wordmark fallback is always white.
   */
  surface?: "auto" | "dark";
  /** One-time entrance animation on first view. See the component notes. */
  reveal?: GameLogoReveal;
}

/*
 * White marks get the mirror treatment of black ones: on the light theme's
 * pale surfaces they would vanish, so they are inverted to dark (the
 * hue-rotate keeps any accent colour close to its original hue) and lose the
 * shadow that only made sense over art.
 */
const TONE_CLASSES: Record<GameLogoData["tone"], string> = {
  light:
    "drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)] [:root[data-theme=light]_&]:invert [:root[data-theme=light]_&]:hue-rotate-180 [:root[data-theme=light]_&]:drop-shadow-none",
  dark: "invert brightness-110 [:root[data-theme=light]_&]:invert-0 [:root[data-theme=light]_&]:brightness-100",
  color: "drop-shadow-[0_1px_6px_rgba(0,0,0,0.3)]",
};

/** On a surface that is dark regardless of theme, only black marks change. */
const DARK_SURFACE_CLASSES: Record<GameLogoData["tone"], string> = {
  light: "drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)]",
  dark: "invert brightness-110",
  color: "drop-shadow-[0_1px_6px_rgba(0,0,0,0.3)]",
};

/** Seven slices: enough to read as a sweep, few enough to stay cheap. */
const SLICES = 7;
const EASE = [0.16, 1, 0.3, 1] as const;

export function GameLogo({
  name,
  logo,
  className,
  height = 64,
  align = "start",
  priority = false,
  fallback = "wordmark",
  surface = "auto",
  reveal = false,
}: GameLogoProps) {
  // Tracked by URL so a new `logo` (e.g. a rotating hero) retries cleanly.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const usable = logo && logo.url !== failedUrl ? logo : null;
  const cssHeight = typeof height === "number" ? `${height}px` : height;

  if (usable) {
    // Fit and tone are kept apart from sizing so the reveal's slice copies
    // can reuse them at a different size (`cn` doesn't merge conflicts).
    const toneClasses = cn(
      "select-none object-contain",
      align === "center" ? "object-center" : "object-left",
      (surface === "dark" ? DARK_SURFACE_CLASSES : TONE_CLASSES)[usable.tone],
    );
    const imageClasses = cn("block w-auto max-w-full", align === "center" && "mx-auto", toneClasses);
    const image = (
      // eslint-disable-next-line @next/next/no-img-element -- remote transparent PNG/SVG at intrinsic aspect; next/image needs fixed dimensions and images are unoptimized anyway.
      <img
        src={usable.url}
        alt={name}
        data-logo-tone={usable.tone}
        data-logo-source={usable.source}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        draggable={false}
        onError={() => setFailedUrl(usable.url)}
        style={{ height: cssHeight }}
        className={cn(imageClasses, className)}
      />
    );
    if (!reveal) return image;
    return (
      <ImageReveal
        // A new mark is a new entrance (the hero swaps logos per slide).
        key={usable.url}
        url={usable.url}
        name={name}
        tone={usable.tone}
        source={usable.source}
        height={cssHeight}
        align={align}
        priority={priority}
        imageClasses={imageClasses}
        toneClasses={toneClasses}
        className={className}
        unified={reveal === "letters"}
        onError={() => setFailedUrl(usable.url)}
      />
    );
  }

  if (fallback === "none") return null;

  const wordmarkClasses = cn(
    "font-display line-clamp-2 block font-bold leading-[1.02] tracking-[-0.03em] text-balance",
    align === "center" ? "text-center" : "text-left",
    surface === "dark" && "text-white",
    className,
  );
  const fontSize = `calc(${cssHeight} * 0.42)`;

  if (reveal) {
    return <LetterReveal key={name} name={name} className={wordmarkClasses} style={{ fontSize }} />;
  }

  return (
    <span style={{ fontSize }} className={wordmarkClasses}>
      {name}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

const subscribeNothing = () => () => {};

/**
 * Calm motion, but only after hydration. The server can't know the reader's
 * motion setting, so the hydrating render must match the full-motion markup;
 * the calm variant applies one commit later (before anything has played,
 * since a reveal waits for the image and the viewport anyway).
 */
function useHydratedCalm(): boolean {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return useCalmMotion() && hydrated;
}

/**
 * Fires once, the first time the element is at least partly on screen. The
 * observer is dropped immediately afterwards — a reveal never replays.
 */
function useFirstView<T extends Element>(): [(node: T | null) => void, boolean] {
  const [seen, setSeen] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    observer.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.current?.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.current.observe(node);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, seen];
}

function ImageReveal({
  url,
  name,
  tone,
  source,
  height,
  align,
  priority,
  imageClasses,
  toneClasses,
  className,
  unified,
  onError,
}: {
  url: string;
  name: string;
  tone: GameLogoData["tone"];
  source: GameLogoData["source"];
  height: string;
  align: "start" | "center";
  priority: boolean;
  imageClasses: string;
  toneClasses: string;
  className?: string;
  unified: boolean;
  onError: () => void;
}) {
  const calm = useHydratedCalm();
  const [viewRef, seen] = useFirstView<HTMLSpanElement>();
  const [loaded, setLoaded] = useState(false);
  const [done, setDone] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  // A cached image can finish before React attaches `onLoad`.
  useEffect(() => {
    if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) setLoaded(true);
  }, []);

  const playing = seen && loaded;
  const sliced = !calm && !unified;

  return (
    <span
      ref={viewRef}
      className={cn("relative block w-fit max-w-full", align === "center" && "mx-auto", className)}
    >
      {/* The real image: it owns the layout, the alt text and the final
          state. It stays invisible only while slices stand in for it. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- see GameLogo above. */}
      <img
        ref={imageRef}
        src={url}
        alt={name}
        data-logo-tone={tone}
        data-logo-source={source}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={onError}
        style={{
          height,
          opacity: done || (playing && !sliced) ? 1 : 0,
          // Unified/calm entrances animate the image itself.
          transform: !sliced && !done && !playing && !calm ? "translateY(10px)" : undefined,
          filter: !sliced && !done && !playing && !calm ? "blur(8px)" : undefined,
          transition: sliced
            ? "none"
            : calm
              ? "opacity 300ms ease"
              : "opacity 700ms var(--ease-out-expo), transform 700ms var(--ease-out-expo), filter 700ms var(--ease-out-expo)",
        }}
        onTransitionEnd={() => setDone(true)}
        className={imageClasses}
      />

      {sliced && playing && !done && (
        <span aria-hidden className="pointer-events-none absolute inset-0">
          {Array.from({ length: SLICES }, (_, i) => {
            const left = (i / SLICES) * 100;
            const right = 100 - ((i + 1) / SLICES) * 100;
            // A hair of overlap so anti-aliased slice edges never show a seam.
            const clip = `inset(-20% ${Math.max(0, right - 0.6)}% -20% ${Math.max(0, left - 0.6)}%)`;
            // Alternating depths give the slight parallax.
            const depth = i % 2 === 0 ? 16 : 26;
            return (
              <motion.span
                key={i}
                className="absolute inset-0"
                style={{ clipPath: clip, WebkitClipPath: clip } as CSSProperties}
                initial={{ opacity: 0, y: depth, scale: 1.04, filter: "brightness(2.2) blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "brightness(1) blur(0px)" }}
                transition={{ duration: 0.7, delay: i * 0.05, ease: EASE }}
                onAnimationComplete={i === SLICES - 1 ? () => setDone(true) : undefined}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- same cached URL as above. */}
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  className={cn("block h-full w-full", toneClasses)}
                />
              </motion.span>
            );
          })}
        </span>
      )}
    </span>
  );
}

function LetterReveal({
  name,
  className,
  style,
}: {
  name: string;
  className: string;
  style: CSSProperties;
}) {
  const calm = useHydratedCalm();
  const [viewRef, seen] = useFirstView<HTMLSpanElement>();
  const words = name.split(/(\s+)/);
  const letterCount = name.replace(/\s+/g, "").length;
  // Long titles compress their stagger so the whole word lands in ~700ms.
  const step = Math.min(0.035, 0.42 / Math.max(1, letterCount));
  let index = 0;

  return (
    <span ref={viewRef} style={style} className={className}>
      <span className="sr-only">{name}</span>
      <span aria-hidden>
        {words.map((word, w) => {
          if (/^\s+$/.test(word)) return " ";
          return (
            // Words stay unbreakable; lines wrap only between them.
            <span key={w} className="inline-block whitespace-nowrap">
              {[...word].map((letter, l) => {
                const delay = index++ * step;
                // One element for both modes: the server renders the full-
                // motion start state (offset + blur), so the calm variant must
                // reset those too, instantly, or the blur would never clear.
                return (
                  <motion.span
                    key={l}
                    className="inline-block will-change-transform"
                    initial={{ opacity: 0, y: "0.45em", filter: "blur(10px)" }}
                    animate={seen ? { opacity: 1, y: "0em", filter: "blur(0px)" } : undefined}
                    transition={
                      calm
                        ? { opacity: { duration: 0.3 }, y: { duration: 0 }, filter: { duration: 0 } }
                        : { duration: 0.62, delay, ease: EASE }
                    }
                  >
                    {letter}
                  </motion.span>
                );
              })}
            </span>
          );
        })}
      </span>
    </span>
  );
}
