"use client";

/**
 * The large right-hand preview in desktop search (lg+), modelled on macOS
 * Spotlight: as the highlighted result moves — arrow keys or hover — the
 * pane re-renders for it with a short cross-fade, so you can judge a result
 * without opening it.
 *
 * Games get the full treatment: key-art backdrop, official logo (via
 * `GameLogo`, which falls back to a typographic wordmark), release date or
 * countdown, critic score, platforms, genres and a Follow control. Everything
 * beyond what the search hit already carries is fetched lazily for the one
 * highlighted game, after a short dwell so sweeping the cursor through ten
 * results doesn't fire ten requests, and cached for the session.
 *
 * Other kinds (franchise, studio, character, genre, platform) get a
 * proportionate card: their visual, what they are, and a way in.
 */

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarClock } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { GameLogo } from "@/components/game/GameLogo";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { WatchButton } from "@/components/game/WatchButton";
import { ScorePill } from "@/components/ui/ScoreRing";
import { Skeleton } from "@/components/ui/Skeleton";
import { SearchHitVisual } from "@/components/search/SearchHitVisual";
import { hitAsGame } from "@/components/search/hit-game";
import { LogoMorph, useSharedLogo } from "@/components/search/LogoMorph";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { sizedImage } from "@/lib/games/image";
import { SEARCH_KIND_LABELS, hrefForSearchHit, type SearchHit } from "@/lib/games/search";
import { isUnreleased, releaseLabelLong, relativeReleaseLabel } from "@/lib/utils/format";
import type { CoverPalette, GameLogo as GameLogoData, GameSummary } from "@/lib/games/types";

type Extras = { logo?: GameLogoData | null; palette?: CoverPalette | null };

/**
 * Two independent lookups, so the fast one never waits on the slow one: the
 * catalogue summary (score, platforms, genres) is a cheap batch query, while
 * the logo and palette come from the full detail record, which can take a
 * moment on a cold cache.
 *
 * `undefined` means "still loading"; `null` means "looked, nothing there".
 */
interface SpotlightDetail {
  summary: GameSummary | null | undefined;
  extras: Extras | undefined;
}

interface CacheEntry {
  summary: Promise<GameSummary | null>;
  extras: Promise<Extras>;
}

/** Session cache, keyed by slug. Stores promises so concurrent asks share a request. */
const detailCache = new Map<string, CacheEntry>();
const DWELL_MS = 140;

function loadDetail(hit: SearchHit): CacheEntry {
  const cached = detailCache.get(hit.slug);
  if (cached) return cached;

  const summary = fetch("/api/library/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [hit.id] }),
  })
    .then((res) => (res.ok ? (res.json() as Promise<{ games?: GameSummary[] }>) : { games: [] }))
    .then((data) => data.games?.find((game) => game.id === hit.id) ?? null)
    .catch(() => null);

  // Addressed by slug: Steam-only titles have no IGDB id to look up.
  const extras: Promise<Extras> = fetch(`/api/game/${encodeURIComponent(hit.slug)}`)
    .then((res) => (res.ok ? (res.json() as Promise<Extras>) : {}))
    .catch(() => ({}));

  const entry = { summary, extras };
  detailCache.set(hit.slug, entry);
  // A failed lookup shouldn't be cached forever; the next highlight retries.
  void Promise.all([summary, extras]).then(([game, extra]) => {
    if (!game && !extra.logo) detailCache.delete(hit.slug);
  });
  return entry;
}

function useSpotlightDetail(hit: SearchHit | null): SpotlightDetail | null {
  const [summary, setSummary] = useState<{ slug: string; value: GameSummary | null } | null>(null);
  const [extras, setExtras] = useState<{ slug: string; value: Extras } | null>(null);
  const slug = hit?.kind === "game" ? hit.slug : null;

  useEffect(() => {
    if (!hit || hit.kind !== "game") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const entry = loadDetail(hit);
      void entry.summary.then((value) => {
        if (!cancelled) setSummary({ slug: hit.slug, value });
      });
      void entry.extras.then((value) => {
        if (!cancelled) setExtras({ slug: hit.slug, value });
      });
    }, DWELL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hit]);

  if (!slug) return null;
  return {
    summary: summary?.slug === slug ? summary.value : undefined,
    extras: extras?.slug === slug ? extras.value : undefined,
  };
}

export function SpotlightPreview({
  hit,
  onNavigate,
  onOpenGame,
}: {
  hit: SearchHit | null;
  /** Called when a link inside the preview is followed (closes the overlay). */
  onNavigate: () => void;
  /** Opening the previewed game: the overlay hands off instead of closing. */
  onOpenGame?: (href: string) => void;
}) {
  const calm = useCalmMotion();
  const detail = useSpotlightDetail(hit);

  return (
    <div className="relative h-full min-h-[26rem] overflow-hidden rounded-[24px] border border-line bg-panel/60">
      <AnimatePresence initial={false} mode="popLayout">
        {hit && (
          <motion.div
            key={`${hit.kind}-${hit.id}`}
            className="absolute inset-0"
            initial={calm ? false : { opacity: 0, scale: 1.015 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={calm ? undefined : { opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          >
            {hit.kind === "game" ? (
              <GamePreview hit={hit} detail={detail} onNavigate={onNavigate} onOpenGame={onOpenGame} />
            ) : (
              <EntityPreview hit={hit} onNavigate={onNavigate} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GamePreview({
  hit,
  detail,
  onNavigate,
  onOpenGame,
}: {
  hit: SearchHit;
  detail: SpotlightDetail | null;
  onNavigate: () => void;
  onOpenGame?: (href: string) => void;
}) {
  const game = detail?.summary ?? hitAsGame(hit);
  // The preview's logo is the best source for the logo morph: same mark,
  // already large. (The list row claims its own name when it is the one used.)
  const logoMorph = useSharedLogo(hit.slug);
  const href = `/game/${game.slug}`;
  const loading = detail?.summary === undefined;
  const logo = detail?.extras?.logo ?? detail?.summary?.logo ?? null;
  // Only wait for the logo while it could still arrive; a known-absent
  // logo falls straight through to the typographic wordmark.
  const logoPending = !logo && detail?.extras === undefined;
  const backdrop = sizedImage(game.screenshots[0], 900) ?? null;
  const upcoming = isUnreleased(game);
  const tint = detail?.extras?.palette?.vibrant ?? detail?.extras?.palette?.dominant ?? null;

  return (
    <div className="relative flex h-full flex-col">
      {/* Key art up top, fading into the panel. */}
      <div className="relative h-[46%] min-h-40 shrink-0 overflow-hidden">
        <GameCover
          name={game.name}
          slug={game.slug}
          image={backdrop ?? game.image}
          imageFallback={backdrop ? game.image : null}
          width={900}
          sizes="360px"
          rounded="rounded-none"
          className="object-cover"
        />
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-panel via-panel/35 to-transparent" />
        {tint && (
          <span
            aria-hidden
            className="absolute inset-0 opacity-50 mix-blend-soft-light"
            style={{ background: `radial-gradient(120% 90% at 20% 100%, ${tint}, transparent 70%)` }}
          />
        )}
        <ScorePill score={game.metacritic} onImage className="absolute right-3 top-3" />
      </div>

      <div className="relative -mt-12 flex min-h-0 flex-1 flex-col px-5 pb-5">
        <div className="flex min-h-14 items-end">
          {logoPending ? (
            <Skeleton className="h-10 w-3/4 rounded-lg" />
          ) : (
            <LogoMorph slug={hit.slug} active={logoMorph.active}>
              <GameLogo name={game.name} logo={logo} height={52} className="max-h-[52px]" />
            </LogoMorph>
          )}
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted">
          <CalendarClock size={14} className="shrink-0 text-brand-soft" aria-hidden />
          <span className="truncate">{releaseLabelLong(game)}</span>
          {upcoming && game.released && (
            <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand-soft">
              {relativeReleaseLabel(game)}
            </span>
          )}
        </p>

        <div className="mt-3 flex min-h-6 flex-wrap items-center gap-2">
          {loading ? (
            <>
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </>
          ) : (
            <>
              <PlatformIcons platforms={game.parentPlatforms.length ? game.parentPlatforms : game.platforms} max={5} size={15} />
              {game.genres.slice(0, 3).map((genre) => (
                <span key={genre.id} className="rounded-full border border-fg/10 bg-fg/[0.05] px-2.5 py-1 text-[11px] font-medium text-muted">
                  {genre.name}
                </span>
              ))}
            </>
          )}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-5">
          <WatchButton game={game} variant="full" className="min-h-11 flex-1 px-4 text-sm" />
          <Link
            href={href}
            onClick={() => {
              if (!onOpenGame) return onNavigate();
              logoMorph.claim();
              onOpenGame(href);
            }}
            className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-fg px-4 text-sm font-semibold text-bg"
          >
            Open <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function EntityPreview({ hit, onNavigate }: { hit: SearchHit; onNavigate: () => void }) {
  const kindLabel = SEARCH_KIND_LABELS[hit.kind].replace(/s$/, "");
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="scale-125">
        <SearchHitVisual hit={hit} size="card" />
      </div>
      <p className="mt-8 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-soft">{kindLabel}</p>
      <p className="mt-2 max-w-full break-words font-display text-2xl font-bold leading-tight [overflow-wrap:anywhere]">{hit.name}</p>
      {hit.subtitle && <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">{hit.subtitle}</p>}
      <Link prefetch={false}
        href={hrefForSearchHit(hit)}
        onClick={onNavigate}
        className="press mt-7 inline-flex min-h-11 items-center gap-2 rounded-full bg-fg px-5 text-sm font-semibold text-bg"
      >
        Explore {kindLabel.toLowerCase()} <ArrowRight size={15} />
      </Link>
    </div>
  );
}
