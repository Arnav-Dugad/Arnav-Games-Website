"use client";

/**
 * "Today": large story cards in the spirit of the App Store's Today tab —
 * key art, the game's own logo, and one line saying why it's here today.
 *
 * Phones get a horizontal shelf of tall cards (a vertical stack of four
 * full-screen cards is a lot of thumb travel for one section); tablets a
 * 2-up grid; desktop a bento in which the lead story takes the large tile.
 * One DOM serves all three — the shelf is plain overflow + snap utilities
 * that the `sm:` grid switches off, so nothing is rendered twice.
 *
 * Cards are always-dark stages (`data-stage="dark"`): white type over art in
 * both themes. They register as game-menu targets, so long-press / right-
 * click offers the same actions as any other game card.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { GameLogo } from "@/components/game/GameLogo";
import { useGameMenuTarget } from "@/components/interactions/game-menu-targets";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils/cn";
import { releaseLabel } from "@/lib/utils/format";
import { storyArt, type HomeStory, type StoryTone } from "./stories";

/** Fixed hues: the card is dark in both themes, so theme tokens don't apply. */
const TONE_DOT: Record<StoryTone, string> = {
  flare: "#ff375f",
  brand: "#b9adff",
  neon: "#64d2ff",
  gold: "#ffd60a",
};

/** lg bento placement by story count and position. */
function span(count: number, index: number): { classes: string; large: boolean } {
  if (count === 1) return { classes: "lg:col-span-4 lg:row-span-2", large: true };
  if (count === 2) return { classes: "lg:col-span-2 lg:row-span-2", large: true };
  if (index === 0) return { classes: "lg:col-span-2 lg:row-span-2", large: true };
  if (count === 3 || index === 1) return { classes: "lg:col-span-2", large: false };
  return { classes: "lg:col-span-1", large: false };
}

const GRID =
  // Phone shelf: full-bleed inside the Container, snapping card to card.
  "no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-4 scroll-px-4 py-1 " +
  // Tablet and up: a real grid in the text column.
  "sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:py-0 " +
  "lg:h-[clamp(520px,44vw,640px)] lg:grid-cols-4 lg:grid-rows-2 lg:gap-5";

export function TodayStories({ stories }: { stories: HomeStory[] }) {
  if (stories.length === 0) return null;
  return (
    <ul className={GRID} aria-label="Today’s stories">
      {stories.map((story, index) => {
        const placement = span(stories.length, index);
        // An odd story out on the 2-up tablet grid leads across the row.
        const wide = stories.length % 2 === 1 && index === 0;
        return (
          <li
            key={story.key}
            className={cn(
              "w-[84vw] max-w-[400px] shrink-0 snap-start sm:w-auto sm:max-w-none",
              wide && "sm:col-span-2 lg:col-span-2",
              placement.classes,
            )}
          >
            <StoryCard story={story} large={placement.large} wide={wide} />
          </li>
        );
      })}
    </ul>
  );
}

function StoryCard({ story, large, wide }: { story: HomeStory; large: boolean; wide: boolean }) {
  const { game } = story;
  const menuRef = useGameMenuTarget(game);
  const genres = game.genres.slice(0, 2).map((genre) => genre.name).join(" · ");

  return (
    <div ref={menuRef} data-game-menu className="press-menu-target h-full">
      <Link prefetch={false}
        href={`/game/${game.slug}`}
        data-stage="dark"
        data-menu-preview
        className={cn(
          "group relative isolate flex h-full flex-col justify-end overflow-hidden rounded-[28px] bg-[#111] text-white",
          "aspect-[4/5] sm:aspect-[4/3] lg:aspect-auto",
          wide && "sm:aspect-[16/9] lg:aspect-auto",
          "shadow-[0_24px_60px_-34px_#000] light:shadow-[0_22px_50px_-30px_#00000080]",
          "transition-transform duration-500 ease-[var(--ease-apple)] coarse:active:scale-[0.98] coarse:active:duration-150",
        )}
      >
        <span aria-hidden className="absolute inset-0 -z-10">
          <GameCover
            name={game.name}
            slug={game.slug}
            image={storyArt(game)}
            imageFallback={game.image}
            width={large ? 1280 : 800}
            sizes={large ? "(max-width: 640px) 84vw, 50vw" : "(max-width: 640px) 84vw, (max-width: 1024px) 50vw, 25vw"}
            rounded="rounded-none"
            className="object-cover transition-transform duration-[1400ms] ease-[var(--ease-out-expo)] fine:group-hover:scale-[1.05]"
          />
        </span>
        {/* Legibility: a deep floor for the copy and a light cap for the kicker. */}
        <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/35 to-black/0" />
        <span aria-hidden className="absolute inset-x-0 top-0 -z-10 h-28 bg-gradient-to-b from-black/50 to-transparent" />
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_#ffffff14,inset_0_1px_0_#ffffff1f]" />

        {/* A glass chip, not bare text: some key art is bright right where the
            kicker sits, and a gradient alone didn't hold contrast there. */}
        <p className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90 shadow-[inset_0_0_0_1px_#ffffff1a] backdrop-blur-md sm:left-5 sm:top-5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TONE_DOT[story.tone] }} />
          {story.kicker}
        </p>

        <div className={cn("p-5 sm:p-6", large && "lg:p-8")}>
          <div
            className={cn(
              "max-w-[min(440px,88%)] drop-shadow-[0_6px_24px_rgba(0,0,0,0.5)]",
              large
                ? "[--story-logo:clamp(56px,16vw,76px)] lg:[--story-logo:clamp(76px,7vw,112px)]"
                : "[--story-logo:clamp(56px,16vw,76px)] lg:[--story-logo:60px]",
            )}
          >
            <GameLogo name={game.name} logo={game.logo} height="var(--story-logo)" surface="dark" reveal />
          </div>
          <p
            className={cn(
              "mt-3 max-w-md text-[15px] leading-snug text-white/85",
              large ? "line-clamp-3 sm:text-[17px]" : "line-clamp-2 lg:text-[14px]",
            )}
          >
            {story.why}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white/60">
              {[releaseLabel(game, ""), genres].filter(Boolean).join(" · ")}
            </span>
            <span
              aria-hidden
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-3.5 py-1.5 text-[13px] font-semibold text-white backdrop-blur-md",
                "transition-colors duration-300 fine:group-hover:bg-white fine:group-hover:text-black",
              )}
            >
              View <ArrowRight size={13} className="transition-transform duration-300 fine:group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}

/** Mirrors the bento exactly so the streamed stories don't shift the page. */
export function TodayStoriesSkeleton() {
  return (
    <div className={GRID} role="status" aria-label="Loading today’s stories">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton
          key={index}
          className={cn(
            "aspect-[4/5] w-[84vw] max-w-[400px] shrink-0 rounded-[28px] sm:aspect-[4/3] sm:w-auto sm:max-w-none lg:aspect-auto",
            span(4, index).classes,
          )}
        />
      ))}
    </div>
  );
}
