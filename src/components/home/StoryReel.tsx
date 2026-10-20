"use client";

/**
 * The story strip under the homepage hero: a row of round covers, each with
 * a gradient ring until you've watched it, like Stories in Instagram or
 * App Store "In-App Events". Tapping one opens the full-screen viewer at that
 * story (`StoryViewer`, loaded only then).
 *
 * Designed for the thumb first — it is the quickest way through what's new on
 * a phone — but kept on every width, where the viewer becomes a 9:16 card on
 * a dimmed stage.
 *
 * "Seen" lives on this device only (localStorage) and is read after mount,
 * so the server HTML and the first client render agree; rings settle to grey
 * a frame later.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { GameCover } from "@/components/game/GameCover";
import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";
import { cn } from "@/lib/utils/cn";
import type { ReelStory } from "./reel";

const StoryViewer = dynamic(() => import("./StoryViewer"), { ssr: false });

const SEEN_KEY = `${STORAGE_PREFIX}stories-seen`;
/** Enough to cover a few days of reels without the list growing forever. */
const SEEN_LIMIT = 60;

function readSeen(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function StoryReel({ stories }: { stories: ReelStory[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [seen, setSeen] = useState<string[]>([]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setSeen(readSeen()));
    return () => cancelAnimationFrame(frame);
  }, []);

  const markSeen = useCallback((slug: string) => {
    setSeen((current) => {
      if (current.includes(slug)) return current;
      const next = [...current, slug].slice(-SEEN_LIMIT);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(next));
      } catch {
        // Private mode or full storage: the ring just stays coloured.
      }
      return next;
    });
  }, []);

  const close = useCallback(() => setOpen(null), []);

  if (stories.length < 3) return null;

  return (
    <section aria-labelledby="home-stories-title" data-track-src="home:stories" className="pt-6 sm:pt-8">
      <h2 id="home-stories-title" className="sr-only">
        Stories
      </h2>
      <ul className="snap-rail rail-gutter gap-3.5 py-1 sm:gap-5">
        {stories.map((story, index) => {
          const watched = seen.includes(story.slug);
          return (
            <li key={story.id} className="w-[72px] sm:w-[84px]">
              <button
                type="button"
                onClick={() => setOpen(index)}
                aria-label={`${story.name} — ${story.kicker}${watched ? ", seen" : ""}`}
                className="press group flex w-full flex-col items-center gap-1.5 rounded-2xl outline-offset-2"
              >
                <span
                  data-seen={watched}
                  className="story-ring grid aspect-square w-full place-items-center rounded-full p-[2.5px] transition-[background] duration-500"
                >
                  <span className="grid h-full w-full place-items-center rounded-full bg-bg p-[2.5px]">
                    <span className="relative block h-full w-full overflow-hidden rounded-full bg-panel">
                      <GameCover
                        name={story.name}
                        slug={story.slug}
                        image={story.cover}
                        imageFallback={story.coverFallback}
                        width={160}
                        sizes="84px"
                        rounded="rounded-full"
                        className="transition-transform duration-500 ease-[var(--ease-out-expo)] fine:group-hover:scale-110"
                      />
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    "w-full truncate text-center text-[11px] font-medium leading-tight sm:text-[12px]",
                    watched ? "text-muted" : "text-text",
                  )}
                >
                  {story.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {open !== null && <StoryViewer stories={stories} start={open} onClose={close} onSeen={markSeen} />}
    </section>
  );
}
