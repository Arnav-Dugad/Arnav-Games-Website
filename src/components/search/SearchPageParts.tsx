"use client";

/**
 * Pieces of the /search results page that need the client: the top-hit
 * card (logo reveal, follow control), entity tiles, and recent searches.
 */

import Link from "next/link";
import { useEffect } from "react";
import { ArrowRight, ChevronRight, Clock, X } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { GameLogo } from "@/components/game/GameLogo";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { WatchButton } from "@/components/game/WatchButton";
import { ScorePill } from "@/components/ui/ScoreRing";
import { SearchHitVisual } from "./SearchHitVisual";
import { useRecentSearches } from "./recent";
import { SEARCH_KIND_LABELS, hrefForSearchHit, type SearchHit } from "@/lib/games/search";
import { releaseLabelLong } from "@/lib/utils/format";
import type { GameSummary } from "@/lib/games/types";

/**
 * The best answer, as a wide card. A game gets its key art, logo, release,
 * platforms, score and a follow control; anything else gets its visual and
 * a way in. Always-dark (white type over art) in both themes.
 */
export function TopHitCard({ hit, game }: { hit: SearchHit; game: GameSummary | null }) {
  const kind = SEARCH_KIND_LABELS[hit.kind].replace(/s$/, "");
  const href = hrefForSearchHit(hit);

  if (hit.kind === "game" && game) {
    const art = game.screenshots[0] ?? game.imageFallback ?? game.image;
    const genres = game.genres.slice(0, 3).map((genre) => genre.name).join(" · ");
    return (
      <article
        data-stage="dark"
        className="group relative isolate overflow-hidden rounded-[28px] bg-[#111] text-white shadow-[0_30px_70px_-40px_#000]"
      >
        <span aria-hidden className="absolute inset-0 -z-10">
          <GameCover
            name={game.name}
            slug={game.slug}
            image={art}
            imageFallback={game.image}
            width={1280}
            sizes="(max-width: 1024px) 100vw, 1100px"
            priority
            rounded="rounded-none"
            className="object-cover transition-transform duration-[1400ms] ease-[var(--ease-out-expo)] fine:group-hover:scale-[1.03]"
          />
        </span>
        <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/50 to-black/10 sm:bg-gradient-to-r sm:from-black/85 sm:via-black/45 sm:to-black/0" />
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_#ffffff14]" />

        <div className="flex min-h-[340px] flex-col justify-end gap-5 p-5 sm:min-h-[360px] sm:flex-row sm:items-end sm:p-8 lg:min-h-[400px] lg:p-10">
          <span className="relative hidden w-[132px] shrink-0 overflow-hidden rounded-2xl shadow-[0_20px_40px_-16px_#000] ring-1 ring-white/15 sm:block lg:w-[152px]">
            <span className="block aspect-[3/4]">
              <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={320} sizes="152px" />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/70">Top hit · {kind}</p>
            <div className="mt-3 max-w-[min(480px,100%)] [--hit-logo:clamp(56px,14vw,96px)]">
              <GameLogo name={game.name} logo={game.logo} height="var(--hit-logo)" surface="dark" reveal priority />
            </div>
            {/* A div, not a p: PlatformIcons renders a list. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px] text-white/75 sm:text-[15px]">
              <span>{releaseLabelLong(game)}</span>
              {genres && <><span aria-hidden className="h-[3px] w-[3px] rounded-full bg-white/45" /><span>{genres}</span></>}
              {game.parentPlatforms.length > 0 && (
                <><span aria-hidden className="h-[3px] w-[3px] rounded-full bg-white/45" /><PlatformIcons platforms={game.parentPlatforms} size={14} max={5} className="gap-2 text-white/70" /></>
              )}
              <ScorePill score={game.metacritic} onImage />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <Link
                href={href}
                className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-black fine:hover:bg-white/90"
              >
                View game <ArrowRight size={16} aria-hidden />
              </Link>
              <WatchButton game={game} variant="full" />
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <Link
      href={href}
      className="glass group flex items-center gap-5 rounded-[28px] p-5 transition-colors sm:p-7"
    >
      <SearchHitVisual hit={hit} size="card" />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-soft">Top hit · {kind}</span>
        <span className="mt-1.5 block break-words text-[24px] font-bold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-[30px]">
          {hit.name}
        </span>
        {hit.subtitle && <span className="mt-1 block text-[15px] text-muted">{hit.subtitle}</span>}
      </span>
      <span className="hidden shrink-0 items-center gap-1 rounded-full bg-fg/[0.08] px-4 py-2.5 text-[14px] font-semibold sm:inline-flex">
        Explore <ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/** A franchise, studio, character, genre or platform as a compact tile. */
export function EntityTile({ hit }: { hit: SearchHit }) {
  return (
    <Link
      href={hrefForSearchHit(hit)}
      className="group flex min-h-[88px] min-w-0 items-center gap-3.5 rounded-2xl p-3 transition-colors fine:hover:bg-fg/[0.05] coarse:active:bg-fg/[0.06]"
    >
      <SearchHitVisual hit={hit} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] transition-colors fine:group-hover:text-brand-soft">
          {hit.name}
        </span>
        {hit.subtitle && <span className="mt-0.5 block truncate text-[13px] text-muted">{hit.subtitle}</span>}
      </span>
      <ChevronRight size={16} aria-hidden className="shrink-0 text-faint transition-transform fine:group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Records a search the reader actually ran, for the overlay's "Recent". */
export function RememberSearch({ term }: { term: string }) {
  const { remember } = useRecentSearches();
  useEffect(() => {
    remember(term);
  }, [term, remember]);
  return null;
}

/** Recent searches as chips, for the empty /search page. Hidden when none. */
export function RecentSearchChips() {
  const { recent, forget, clear } = useRecentSearches();
  if (recent.length === 0) return null;
  return (
    <section aria-labelledby="recent-searches-title" className="mb-10">
      <div className="flex items-center justify-between">
        <h2 id="recent-searches-title" className="text-[13px] font-semibold text-muted">Recent searches</h2>
        <button type="button" onClick={clear} className="min-h-9 text-[13px] font-medium text-brand-soft hover:underline">
          Clear
        </button>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {recent.map((term) => (
          <li key={term} className="flex items-center rounded-full bg-fg/[0.07]">
            <Link href={`/search?q=${encodeURIComponent(term)}`} className="flex min-h-10 items-center gap-2 pl-3.5 pr-1 text-[14px] coarse:min-h-11">
              <Clock size={14} aria-hidden className="text-faint" />
              {term}
            </Link>
            <button
              type="button"
              onClick={() => forget(term)}
              aria-label={`Remove “${term}”`}
              className="grid h-10 w-9 place-items-center rounded-full text-faint hover:text-text coarse:h-11"
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
