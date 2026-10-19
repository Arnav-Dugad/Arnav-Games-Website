"use client";

/**
 * Recent activity on the profile: a short, dated feed of what actually
 * happened — finished, started, added to the library, rated.
 *
 * Every event is a timestamp the app genuinely recorded (`finishedAt`,
 * `startedAt`, `addedAt`, a review's `updatedAt`); nothing is inferred. Each
 * game contributes only its latest event, so one busy evening with one game
 * doesn't fill the feed.
 */

import Link from "next/link";
import { useMemo } from "react";
import { BookmarkPlus, Library, Play, Star, Trophy } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { cn } from "@/lib/utils/cn";
import type { Review, WatchlistEntry } from "@/lib/firebase/db";

type Kind = "finished" | "started" | "owned" | "saved" | "reviewed";

interface ActivityEvent {
  key: string;
  kind: Kind;
  at: number;
  slug: string;
  name: string;
  image: string | null;
  imageFallback: string | null;
  rating?: number;
}

const KIND: Record<Kind, { label: string; icon: typeof Play; tone: string }> = {
  finished: { label: "Finished", icon: Trophy, tone: "bg-gold/15 text-gold" },
  started: { label: "Started playing", icon: Play, tone: "bg-mint/15 text-mint" },
  owned: { label: "Added to library", icon: Library, tone: "bg-brand/15 text-brand-soft" },
  saved: { label: "Saved", icon: BookmarkPlus, tone: "bg-fg/[0.08] text-muted" },
  reviewed: { label: "Rated", icon: Star, tone: "bg-gold/15 text-gold" },
};

function relative(at: number, now: number): string {
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 35) return `${Math.round(days / 7)} wk ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(at));
}

export function PlayHistory({ entries, reviews, now, limit = 8 }: { entries: WatchlistEntry[]; reviews: Review[]; now: number; limit?: number }) {
  const events = useMemo(() => {
    const latest = new Map<string, ActivityEvent>();
    const offer = (event: ActivityEvent) => {
      const current = latest.get(event.slug);
      if (!current || event.at > current.at) latest.set(event.slug, event);
    };
    for (const entry of entries) {
      const base = { slug: entry.slug, name: entry.name, image: entry.image, imageFallback: entry.imageFallback };
      if (entry.finishedAt) offer({ ...base, key: `f-${entry.gameId}`, kind: "finished", at: entry.finishedAt });
      if (entry.startedAt && entry.status !== "played") offer({ ...base, key: `s-${entry.gameId}`, kind: "started", at: entry.startedAt });
      if (entry.addedAt) offer({ ...base, key: `a-${entry.gameId}`, kind: (entry.ownedOn ?? []).length ? "owned" : "saved", at: entry.addedAt });
    }
    for (const review of reviews) {
      offer({ key: `r-${review.id}`, kind: "reviewed", at: review.updatedAt, slug: review.slug, name: review.gameName, image: null, imageFallback: null, rating: review.rating });
    }
    // A review has no art of its own; borrow the library's when the game is there.
    const art = new Map(entries.map((entry) => [entry.slug, entry]));
    return [...latest.values()]
      .map((event) => (event.image || !art.has(event.slug) ? event : { ...event, image: art.get(event.slug)!.image, imageFallback: art.get(event.slug)!.imageFallback }))
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  }, [entries, reviews, limit]);

  if (events.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[14px] text-muted">
        Nothing yet. Save, play or rate a game and it shows up here.
      </p>
    );
  }

  return (
    <ol className="overflow-hidden rounded-2xl border border-line bg-panel/55 light:bg-panel">
      {events.map((event, index) => {
        const kind = KIND[event.kind];
        const Icon = kind.icon;
        return (
          <li key={event.key} className={cn(index > 0 && "border-t border-line")}>
            <Link prefetch={false} href={`/game/${event.slug}`} className="press flex items-center gap-3 px-3 py-2.5 transition-colors fine:hover:bg-fg/[0.04]">
              <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md ring-1 ring-inset ring-fg/10">
                <GameCover name={event.name} slug={event.slug} image={event.image} imageFallback={event.imageFallback} width={96} sizes="36px" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{event.name}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
                  <span aria-hidden className={cn("grid h-[18px] w-[18px] place-items-center rounded-full", kind.tone)}>
                    <Icon size={10} />
                  </span>
                  {kind.label}
                  {event.rating !== undefined && <span className="font-semibold tabular-nums text-text">{event.rating}/10</span>}
                </span>
              </span>
              <time dateTime={new Date(event.at).toISOString()} className="shrink-0 text-[13px] tabular-nums text-faint">
                {relative(event.at, now)}
              </time>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
