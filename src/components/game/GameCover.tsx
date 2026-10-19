"use client";

import Image from "next/image";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isIgdbImage, sizedImage } from "@/lib/games/image";
import { hueFromString, initials } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * Cover art with a two-stage fallback.
 *
 * Providers hand back the best-looking asset they have, which is not always the
 * one that exists. Steam's portrait library capsule is a proper 600x900 poster
 * and looks far better in a 3:4 card than the 16:9 header — but it is missing
 * for a minority of apps and 404s. Rather than settle for the worse asset
 * everywhere, this tries the poster first and swaps to the guaranteed header on
 * a load error.
 *
 * When every source is exhausted (or a title genuinely has no art, which is
 * common for unannounced games), it renders generated art derived
 * deterministically from the slug — never a broken image or a grey box.
 *
 * Failed URLs are tracked by value rather than by index, so changing the `image`
 * prop — as the hero carousel does on every rotation — naturally re-tries the
 * new source without needing a reset.
 *
 * While the full asset downloads, a blurred thumbnail of the *same* artwork
 * sits over it under a soft sheen, then dissolves once the real image has
 * decoded — so a slow connection shows the right colours immediately and the
 * cover sharpens in place instead of popping in. See `CoverPlaceholder`.
 */

interface GameCoverProps {
  name: string;
  slug: string;
  image: string | null;
  /** Tried only if `image` fails to load. */
  imageFallback?: string | null;
  /** Rendered CSS width, used to request a correctly-sized source asset. */
  width?: number;
  className?: string;
  priority?: boolean;
  /** Passed straight to next/image; must describe the real rendered width. */
  sizes?: string;
  rounded?: string;
}

export function GameCover({
  name,
  slug,
  image,
  imageFallback = null,
  width = 480,
  className,
  priority = false,
  sizes = "(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 240px",
  rounded = "rounded-[inherit]",
}: GameCoverProps) {
  const [failed, setFailed] = useState<string[]>([]);
  const imageRef = useRef<HTMLImageElement>(null);

  const sources = useMemo(
    () =>
      [image, imageFallback]
        .filter((src): src is string => Boolean(src))
        .map((src) => sizedImage(src, width) ?? src),
    [image, imageFallback, width],
  );

  const src = sources.find((candidate) => !failed.includes(candidate)) ?? null;

  if (!src) {
    return <GeneratedCover name={name} slug={slug} className={cn(rounded, className)} />;
  }

  return (
    <>
      <Image
        ref={imageRef}
        src={src}
        alt=""
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={isIgdbImage(src)}
        onError={() => setFailed((prev) => (prev.includes(src) ? prev : [...prev, src]))}
        className={cn("object-cover", rounded, className)}
      />
      {/* Keyed by source: a new image (hero rotation, poster → header
          fallback) gets a fresh placeholder lifecycle. */}
      <CoverPlaceholder key={src} src={src} imageRef={imageRef} rounded={rounded} />
    </>
  );
}

/** Never changes, so `useSyncExternalStore` only distinguishes server/client. */
const subscribeNothing = () => () => {};

/**
 * IGDB serves every asset at fixed size tokens. `cover_small` (90x128) keeps
 * a poster's aspect; `thumb` (90x90) is the smallest token for landscape art.
 * At 3–5KB either arrives long before the full image. Other providers publish
 * one size only, so they get the sheen without a preview.
 */
function placeholderSource(src: string): string | null {
  if (!isIgdbImage(src)) return null;
  const match = src.match(/\/t_([a-z0-9_]+)\//i);
  if (!match) return null;
  const token = match[1].startsWith("cover") ? "cover_small" : "thumb";
  return src.replace(/\/t_[a-z0-9_]+\//i, `/t_${token}/`);
}

/**
 * The blurred stand-in that dissolves into the real cover.
 *
 * Driven entirely by direct DOM writes rather than React state: the decision
 * depends on the image element's `complete` flag, which only exists in the
 * DOM, and a state round-trip would cost a render per cover on grids of
 * fifty. It also never renders on the server — before hydration the browser
 * paints the full image progressively as it always has, and a cover that
 * already finished loading by the time React attaches is simply skipped
 * rather than flashing blurry for a frame.
 */
function CoverPlaceholder({
  src,
  imageRef,
  rounded,
}: {
  src: string;
  imageRef: React.RefObject<HTMLImageElement | null>;
  rounded: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const client = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const preview = placeholderSource(src);

  useLayoutEffect(() => {
    const overlay = ref.current;
    const img = imageRef.current;
    if (!overlay || !img) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (instant: boolean) => {
      if (instant) {
        overlay.dataset.state = "done";
        return;
      }
      overlay.dataset.state = "revealed";
      // Once faded, drop it from rendering altogether: an invisible blurred
      // layer still costs compositor memory on a grid of fifty covers. The
      // timer backs up `transitionend`, which never fires if the element is
      // hidden mid-fade.
      const finish = () => {
        clearTimeout(timer);
        overlay.dataset.state = "done";
      };
      overlay.addEventListener("transitionend", finish, { once: true });
      timer = setTimeout(finish, 900);
    };

    // Cached or already-decoded: skip the reveal entirely.
    if (img.complete && img.naturalWidth > 0) {
      settle(true);
      return;
    }

    const onLoad = () => {
      // `decode()` resolves once the bitmap is ready to paint, so the blur
      // lifts onto a finished image rather than a half-rasterised one.
      void img.decode().catch(() => {}).then(() => settle(false));
    };
    // A failed load hands over to the next source (or generated art) via the
    // parent's onError; the placeholder just gets out of the way.
    const onError = () => settle(true);
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
    return () => {
      clearTimeout(timer);
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
  }, [client, imageRef]);

  if (!client) return null;

  return (
    <span
      ref={ref}
      aria-hidden
      data-state="loading"
      className={cn("cover-placeholder pointer-events-none absolute inset-0 overflow-hidden", rounded)}
    >
      {preview && (
        // A 4KB thumbnail served straight from IGDB: next/image would only
        // add a srcset nobody needs for a blurred stand-in.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" decoding="async" className="cover-placeholder-image" />
      )}
    </span>
  );
}

export function GeneratedCover({
  name,
  slug,
  className,
}: {
  name: string;
  slug: string;
  className?: string;
}) {
  const hue = hueFromString(slug);
  const hue2 = (hue + 48) % 360;

  return (
    <div
      aria-hidden
      className={cn("absolute inset-0 overflow-hidden", className)}
      style={{
        background: `linear-gradient(155deg, hsl(${hue} 62% 24%) 0%, hsl(${hue2} 58% 12%) 55%, hsl(${hue} 45% 7%) 100%)`,
      }}
    >
      {/* Soft key light, offset so the composition isn't centred. */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 22% 12%, hsl(${hue2} 85% 62% / 0.42), transparent 62%)`,
        }}
      />
      {/* Diagonal rules add texture without reading as a placeholder pattern. */}
      <div
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, rgba(255,255,255,0.9) 0 1px, transparent 1px 13px)",
        }}
      />
      {/* The container establishes the query context so the initials scale with
          the card's own width, not the viewport. */}
      <div className="absolute inset-0 flex items-center justify-center [container-type:inline-size]">
        <span className="font-display text-[26cqw] font-black leading-none tracking-tighter text-white/[0.13] select-none">
          {initials(name)}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
    </div>
  );
}
