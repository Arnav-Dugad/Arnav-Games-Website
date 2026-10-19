"use client";

import Image from "next/image";
import { ImageOff } from "lucide-react";
import { useState } from "react";
import { shouldBypassImageOptimizer } from "@/lib/games/image";
import { cn } from "@/lib/utils/cn";

interface ResilientMediaImageProps {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}

/** A remote media image that never leaves a browser-broken element behind. */
export function ResilientMediaImage({
  src,
  alt,
  sizes,
  className,
  priority = false,
}: ResilientMediaImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) {
    return (
      <span className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(124,92,255,0.2),transparent_55%),linear-gradient(145deg,var(--color-panel-2),var(--color-panel))] text-faint">
        <ImageOff size={24} aria-hidden />
        <span className="sr-only">Media unavailable</span>
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      // IGDB already serves purpose-built transforms. Direct delivery avoids
      // a second optimizer hop, which was intermittently failing valid assets.
      unoptimized={shouldBypassImageOptimizer(src)}
      onError={() => setFailedSrc(src)}
      className={cn(className)}
    />
  );
}
