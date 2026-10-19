"use client";

/**
 * "For you": the signed-in reader's own shelf, directly under the hero.
 *
 * Replaces the old command-centre dashboard (stat tiles, briefing cards, a
 * taste panel) with the two things a returning reader actually acts on:
 *  1. their library in motion — what they're playing, what they follow that
 *     lands soon, what's next in the backlog — as one horizontal shelf;
 *  2. recommendations that say why they were picked.
 * The numbers moved to /stats, where they have room to mean something.
 *
 * Renders nothing for signed-out visitors (the page's closing call-to-action
 * speaks to them), a skeleton while the library loads, and a one-action
 * onboarding card for a signed-in reader with an empty library. Nothing here
 * is guessed: every card is a game the reader saved, with its saved state.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { GameRail } from "@/components/game/GameRail";
import { Button } from "@/components/ui/Button";
import { Container, SectionHeading } from "@/components/ui/SectionHeading";
import { GameRailSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { entryAsGameSummary, useGameMenuTarget } from "@/components/interactions/game-menu-targets";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import type { WatchlistEntry } from "@/lib/firebase/db";
import { daysUntilRelease } from "@/lib/games/dashboard";
import { buildTasteProfile, MIN_TASTE_STRENGTH } from "@/lib/games/taste";
import { canonicalEntryHref } from "@/lib/notifications/model";
import { releaseState } from "@/lib/games/release-state";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";
import { readLocalCache, writeLocalCache } from "@/lib/utils/local-cache";
import type { GameSummary, Ref } from "@/lib/games/types";

const MAX_CARDS = 10;
/** How far ahead a followed release still counts as "landing soon". */
const SOON_DAYS = 120;

interface ShelfCard {
  entry: WatchlistEntry;
  kicker: string;
  detail: string;
  tone: "neon" | "brand" | "mint";
}

/** Playing first, then followed releases by date, then the backlog. */
function buildShelf(entries: WatchlistEntry[], now: number): ShelfCard[] {
  const seen = new Set<number>();
  const cards: ShelfCard[] = [];
  const push = (card: ShelfCard) => {
    if (seen.has(card.entry.gameId) || cards.length >= MAX_CARDS) return;
    seen.add(card.entry.gameId);
    cards.push(card);
  };
  const recency = (entry: WatchlistEntry) => entry.startedAt ?? entry.finishedAt ?? entry.addedAt;

  entries
    .filter((entry) => entry.status === "playing")
    .sort((a, b) => recency(b) - recency(a))
    .forEach((entry) =>
      push({
        entry,
        kicker: "Continue playing",
        detail: entry.startedAt ? `Started ${formatDate(new Date(entry.startedAt).toISOString())}` : "In progress",
        tone: "neon",
      }),
    );

  entries
    .filter((entry) => releaseState(entry, new Date(now)) === "upcoming" && entry.released)
    .map((entry) => ({ entry, days: daysUntilRelease(entry.released, now) }))
    .filter(({ days }) => days >= 0 && days <= SOON_DAYS)
    .sort((a, b) => a.days - b.days)
    .forEach(({ entry, days }) =>
      push({
        entry,
        kicker: days === 0 ? "Out today" : days === 1 ? "Out tomorrow" : `Out in ${days} days`,
        detail: formatDate(entry.released),
        tone: "brand",
      }),
    );

  entries
    .filter((entry) => entry.status === "want" && releaseState(entry, new Date(now)) !== "upcoming")
    .sort((a, b) => b.addedAt - a.addedAt)
    .forEach((entry) =>
      push({
        entry,
        kicker: "Up next",
        detail: (entry.ownedOn ?? []).length > 0 ? "In your backlog · owned" : "In your backlog",
        tone: "mint",
      }),
    );

  return cards;
}

function greeting(now: number): string {
  const hour = new Date(now).getHours();
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export function ForYou({
  genres,
  previewEntries,
}: {
  genres: Ref[];
  /** Dev preview only (see the homepage): renders as if signed in with these. */
  previewEntries?: WatchlistEntry[];
}) {
  const { user, loading: authLoading } = useAuth();
  const watchlist = useWatchlist();
  const entries = previewEntries ?? watchlist.entries;
  const watchlistLoading = previewEntries ? false : watchlist.loading;
  const signedIn = Boolean(previewEntries) || Boolean(user);
  const name = previewEntries ? "Arnav" : user?.displayName?.trim().split(/\s+/)[0] ?? null;

  // Time is read after mount: server and client clocks (and time zones)
  // differ, and a greeting that hydrates wrong flickers.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(frame);
  }, []);

  const shelf = useMemo(() => (now ? buildShelf(entries, now) : []), [entries, now]);
  const recommendations = useRecommendations(entries, genres, signedIn && now > 0);

  if (!signedIn || (authLoading && !previewEntries) || now === 0) return null;
  if (watchlistLoading) return <ForYouSkeleton />;

  const eyebrow = name ? `${greeting(now)}, ${name}` : greeting(now);

  if (entries.length === 0) {
    return (
      <section data-track-src="home:for-you" className="py-9 sm:py-12 lg:py-14">
        <Container>
          <div className="glass relative isolate overflow-hidden rounded-3xl p-6 sm:p-8">
            <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_0%_0%,color-mix(in_oklab,var(--color-brand)_16%,transparent),transparent_50%)]" />
            <p className="text-[13px] font-semibold text-brand-soft">{eyebrow}</p>
            <h2 className="mt-1.5 text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">Make this page yours</h2>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
              Follow a game or mark one you own to fill this with your releases and picks.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Button href="/browse">Find games</Button>
              <Button href="/upcoming" variant="secondary">See what’s coming</Button>
            </div>
          </div>
        </Container>
      </section>
    );
  }

  return (
    <section data-track-src="home:for-you" aria-labelledby="home-for-you-title" className="py-9 sm:py-12 lg:py-14">
      <Container>
        <SectionHeading
          eyebrow={eyebrow}
          title={<span id="home-for-you-title">For you</span>}
          href="/library"
          linkLabel="Library"
        />
      </Container>

      {shelf.length > 0 ? (
        <ul aria-label="From your library" className="snap-rail rail-gutter mt-6 gap-3 py-1 sm:mt-7 sm:gap-4">
          {shelf.map((card) => (
            <li key={card.entry.gameId} className="w-[80vw] max-w-[360px] sm:w-[360px]">
              <LibraryCard card={card} />
            </li>
          ))}
        </ul>
      ) : (
        <Container className="mt-6">
          <p className="text-[15px] text-muted">
            Nothing in progress or landing soon. Mark a game as playing to pick it up here.
          </p>
        </Container>
      )}

      {recommendations.state !== "off" && (
        <div className="mt-10 sm:mt-12">
          <Container>
            <h3 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] sm:text-[20px]">
              <Sparkles size={16} className="text-brand-soft" aria-hidden />
              {recommendations.title}
            </h3>
          </Container>
          <div className="mt-4 sm:mt-5">
            {recommendations.state === "loading" ? (
              <Container>
                <GameRailSkeleton count={6} />
              </Container>
            ) : (
              <GameRail games={recommendations.games} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const TONE_TEXT: Record<ShelfCard["tone"], string> = {
  neon: "text-[#64d2ff]",
  brand: "text-[#b9adff]",
  mint: "text-[#30d158]",
};

/**
 * A library entry as a wide card: the cover, sharp, beside a blurred,
 * darkened copy of itself — so every card is tinted by its own game without
 * needing landscape art the library snapshot doesn't store.
 */
function LibraryCard({ card }: { card: ShelfCard }) {
  const { entry } = card;
  const game = useMemo(() => entryAsGameSummary(entry), [entry]);
  const menuRef = useGameMenuTarget(game);

  return (
    <div ref={menuRef} data-game-menu className="press-menu-target">
      <Link prefetch={false}
        href={canonicalEntryHref(entry)}
        data-stage="dark"
        data-menu-preview
        className="group relative isolate flex h-[136px] items-center gap-4 overflow-hidden rounded-[22px] bg-[#141416] p-3 pr-4 text-white shadow-[0_18px_40px_-26px_#000] transition-transform duration-500 ease-[var(--ease-apple)] coarse:active:scale-[0.98] coarse:active:duration-150"
      >
        <span aria-hidden className="absolute inset-0 -z-10 scale-150 opacity-70 blur-2xl saturate-150">
          <GameCover name={entry.name} slug={entry.slug} image={entry.image} imageFallback={entry.imageFallback} width={120} sizes="60px" rounded="rounded-none" />
        </span>
        <span aria-hidden className="absolute inset-0 -z-10 bg-black/45" />
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_#ffffff17,inset_0_1px_0_#ffffff21]" />

        <span className="relative h-full w-[84px] shrink-0 overflow-hidden rounded-[14px] shadow-[0_10px_24px_-12px_#000]">
          <GameCover
            name={entry.name}
            slug={entry.slug}
            image={entry.image}
            imageFallback={entry.imageFallback}
            width={200}
            sizes="84px"
            className="transition-transform duration-700 ease-[var(--ease-out-expo)] fine:group-hover:scale-[1.06]"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[11px] font-semibold uppercase tracking-[0.07em]", TONE_TEXT[card.tone])}>
            {card.kicker}
          </span>
          <span className="mt-1 line-clamp-2 text-[17px] font-semibold leading-tight tracking-[-0.01em]">{entry.name}</span>
          <span className="mt-1.5 block truncate text-[13px] text-white/65">{card.detail}</span>
        </span>
      </Link>
    </div>
  );
}

type RecommendationView =
  | { state: "off" }
  | { state: "loading"; title: string }
  | { state: "ready"; title: string; games: GameSummary[] };

/**
 * Taste-profile recommendations. Only the anonymous shape of the reader's
 * taste (genre ids, platform slugs) leaves the browser; see the API route.
 */
/** Recommendations for an unchanged taste profile are reused on the device this long. */
const RECS_TTL_MS = 6 * 60 * 60_000;

function useRecommendations(entries: WatchlistEntry[], genres: Ref[], enabled: boolean): RecommendationView {
  const profile = useMemo(
    () =>
      buildTasteProfile(
        entries.map((entry) => ({
          gameId: entry.gameId,
          genreIds: entry.genreIds ?? [],
          platformSlugs: entry.platformSlugs ?? [],
          status: entry.status,
          platform: entry.platform ?? null,
          addedAt: entry.addedAt,
          finishedAt: entry.finishedAt ?? null,
        })),
      ),
    [entries],
  );
  const usable = enabled && profile.strength >= MIN_TASTE_STRENGTH && profile.genreIds.length > 0;
  const key = usable
    ? [profile.genreIds.join(","), profile.platformSlugs.join(","), profile.excludeIds.slice(0, 40).join(",")].join("|")
    : "";
  const [result, setResult] = useState<{ key: string; games: GameSummary[]; personalised: boolean } | null>(null);

  useEffect(() => {
    if (!key) return;
    const [genreIds, platforms, exclude] = key.split("|");
    // The same taste profile gets the same picks for hours; reuse them on this
    // device instead of a Worker request on every home visit.
    const cacheKey = `recs:${key}`;
    const cached = readLocalCache<{ games: GameSummary[]; personalised: boolean }>(cacheKey, RECS_TTL_MS);
    if (cached) {
      const frame = requestAnimationFrame(() => setResult({ key, ...cached }));
      return () => cancelAnimationFrame(frame);
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ genres: genreIds, platforms, exclude, limit: "14" });
    fetch(`/api/recommendations?${params}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { results: [], personalised: false }))
      .then((data: { results?: GameSummary[]; personalised?: boolean }) => {
        const answer = { games: Array.isArray(data.results) ? data.results : [], personalised: data.personalised === true };
        if (answer.games.length > 0) writeLocalCache(cacheKey, answer);
        setResult({ key, ...answer });
      })
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError") setResult({ key, games: [], personalised: false });
      });
    return () => controller.abort();
  }, [key]);

  const named = useMemo(() => {
    const byId = new Map(genres.map((genre) => [genre.id, genre.name]));
    return profile.genreIds.map((id) => byId.get(id)).filter((name): name is string => Boolean(name)).slice(0, 2);
  }, [genres, profile.genreIds]);

  if (!usable) return { state: "off" };
  const current = result?.key === key ? result : null;
  const title = current && !current.personalised
    ? "Highly rated, not in your library"
    : named.length > 0
      ? `Because you play ${named.join(" and ")}`
      : "Picked from what you play";
  if (!current) return { state: "loading", title };
  // An empty answer isn't worth a heading that promises picks.
  if (current.games.length === 0) return { state: "off" };
  return { state: "ready", title, games: current.games };
}

function ForYouSkeleton() {
  return (
    <section aria-hidden className="py-9 sm:py-12 lg:py-14">
      <Container>
        <Skeleton className="h-4 w-40 rounded-full" />
        <Skeleton className="mt-3 h-8 w-32" />
      </Container>
      <div className="rail-gutter mt-7 flex gap-3 overflow-hidden sm:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[136px] w-[80vw] max-w-[360px] shrink-0 rounded-[22px] sm:w-[360px]" />
        ))}
      </div>
    </section>
  );
}
