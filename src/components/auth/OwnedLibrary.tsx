"use client";

/**
 * The reader's collection, grouped by where they own each game.
 *
 * Distinct from both the watchlist ("what am I waiting for") and play history
 * ("what have I played"). A game can appear under several storefronts, because
 * owning the same title twice is normal and collapsing that would misreport
 * the collection.
 */

import Link from "next/link";
import { useMemo } from "react";
import { Library, PackageOpen } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { GameCover } from "@/components/game/GameCover";
import { ScorePill } from "@/components/ui/ScoreRing";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { OWNERSHIP_PLATFORMS, ownershipPlatform } from "@/lib/games/stores-catalog";
import type { WatchlistEntry } from "@/lib/firebase/db";

interface Group {
  slug: string;
  name: string;
  icon: string | null;
  entries: WatchlistEntry[];
}

export function OwnedLibrary() {
  const { entries, loading } = useWatchlist();

  const groups = useMemo<Group[]>(() => {
    const buckets = new Map<string, WatchlistEntry[]>();

    for (const entry of entries) {
      for (const slug of entry.ownedOn ?? []) {
        const bucket = buckets.get(slug);
        if (bucket) bucket.push(entry);
        else buckets.set(slug, [entry]);
      }
    }

    return [...buckets.entries()]
      .map(([slug, list]) => {
        const platform = ownershipPlatform(slug);
        return {
          slug,
          name: platform?.name ?? slug,
          icon: platform?.icon ?? null,
          entries: [...list].sort((a, b) => b.addedAt - a.addedAt),
        };
      })
      // Largest collection first; the catch-all buckets sink to the bottom.
      .sort((a, b) => {
        const rank = (slug: string) => (slug === "other" || slug === "physical" ? 1 : 0);
        return rank(a.slug) - rank(b.slug) || b.entries.length - a.entries.length;
      });
  }, [entries]);

  const total = useMemo(
    () => entries.filter((entry) => (entry.ownedOn ?? []).length > 0).length,
    [entries],
  );

  if (loading) return <div className="shimmer-bg mt-6 h-40 rounded-3xl" />;

  if (groups.length === 0) {
    return (
      <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-line py-16 text-center">
        <PackageOpen size={22} className="text-faint" />
        <p className="mt-3 max-w-sm text-sm text-muted">
          Nothing here yet. Open any game and use <span className="text-text">I own this</span> to
          record where you bought it — Steam, PlayStation, a physical copy, wherever.
        </p>
        <Button href="/browse" variant="secondary" size="sm" className="mt-5">
          Find your games
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      <div className="flex flex-wrap gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-fg/[0.04] px-4 py-2 text-sm">
          <Library size={15} className="text-mint" />
          <span className="font-semibold tabular-nums">{total}</span>
          <span className="text-muted">{total === 1 ? "game owned" : "games owned"}</span>
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-fg/[0.04] px-4 py-2 text-sm">
          <span className="font-semibold tabular-nums">{groups.length}</span>
          <span className="text-muted">{groups.length === 1 ? "store" : "stores"}</span>
        </span>
      </div>

      {groups.map((group, index) => (
        <Reveal key={group.slug} delay={Math.min(index, 4) * 0.05} blur={false}>
          <div className="mb-3 flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-fg/[0.04]">
              {group.icon ? (
                <BrandIcon name={group.icon} size={15} tinted title={null} />
              ) : (
                <Library size={14} className="text-faint" />
              )}
            </span>
            <h3 className="font-display text-lg font-bold">{group.name}</h3>
            <span className="rounded-full bg-fg/6 px-2 py-0.5 text-[11px] font-medium text-muted tabular-nums">
              {group.entries.length}
            </span>
          </div>

          <ul className="grid gap-2.5 sm:grid-cols-2">
            {group.entries.map((entry) => (
              <li key={`${group.slug}-${entry.gameId}`}>
                <Link
                  href={`/game/${entry.slug}`}
                  className="flex items-center gap-3 rounded-2xl border border-line bg-panel/50 p-2.5 transition-colors fine:hover:border-line-strong"
                >
                  <span className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg">
                    <GameCover
                      name={entry.name}
                      slug={entry.slug}
                      image={entry.image}
                      imageFallback={entry.imageFallback}
                      width={160}
                      sizes="44px"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{entry.name}</span>
                    {(entry.ownedOn ?? []).length > 1 && (
                      <span className="mt-1 flex items-center gap-1.5">
                        {(entry.ownedOn ?? [])
                          .filter((slug) => slug !== group.slug)
                          .slice(0, 4)
                          .map((slug) => {
                            const other = OWNERSHIP_PLATFORMS.find((p) => p.slug === slug);
                            return other?.icon ? (
                              <BrandIcon key={slug} name={other.icon} size={12} title={other.name} />
                            ) : null;
                          })}
                        <span className="text-[10px] text-faint">also owned elsewhere</span>
                      </span>
                    )}
                  </span>
                  <ScorePill score={entry.metacritic} />
                </Link>
              </li>
            ))}
          </ul>
        </Reveal>
      ))}
    </div>
  );
}
