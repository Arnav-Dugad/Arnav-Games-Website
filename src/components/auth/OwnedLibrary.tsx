"use client";

/**
 * "Where you play": the profile's platform breakdown.
 *
 * Counts come from the library itself (where each game is marked as owned),
 * so the bars are facts, not self-description. Platforms the reader declared
 * on their profile but hasn't recorded any games on still appear, honestly
 * labelled, because "I have a Switch" is true even with an empty library.
 * The full collection lives on /library; this is the summary.
 */

import Link from "next/link";
import { useMemo } from "react";
import { ChevronRight, Gamepad2 } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { ownershipPlatform } from "@/lib/games/stores-catalog";
import type { WatchlistEntry } from "@/lib/firebase/db";

export function OwnedLibrary({ entries, declared = [] }: { entries: WatchlistEntry[]; declared?: string[] }) {
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) for (const slug of new Set(entry.ownedOn ?? [])) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    for (const slug of declared) if (!counts.has(slug)) counts.set(slug, 0);
    return [...counts.entries()]
      .map(([slug, count]) => ({ slug, count, name: ownershipPlatform(slug)?.name ?? slug, icon: ownershipPlatform(slug)?.icon ?? null }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [entries, declared]);

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[14px] text-muted">
        Mark where you own a game and your platforms appear here.{" "}
        <Link href="/browse" className="font-medium text-brand-soft">Find your games</Link>
      </p>
    );
  }

  const max = Math.max(1, ...rows.map((row) => row.count));
  const shown = rows.slice(0, 6);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel/55 light:bg-panel">
      <ul>
        {shown.map((row, index) => (
          <li key={row.slug} className={index > 0 ? "border-t border-line" : undefined}>
            <div className="flex items-center gap-3 px-4 py-3">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-fg/[0.07] text-text">
                {row.icon ? <BrandIcon name={row.icon} size={15} title={null} /> : <Gamepad2 size={15} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15px] font-medium">{row.name}</span>
                  <span className="shrink-0 text-[13px] tabular-nums text-muted">
                    {row.count ? `${row.count} ${row.count === 1 ? "game" : "games"}` : "No games yet"}
                  </span>
                </span>
                <span aria-hidden className="mt-1.5 block h-1 overflow-hidden rounded-full bg-fg/[0.07]">
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${(row.count / max) * 100}%` }} />
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <Link href="/library" className="press flex min-h-[48px] items-center justify-between border-t border-line px-4 text-[15px] font-medium text-brand-soft fine:hover:bg-fg/[0.04]">
        {rows.length > shown.length ? `See all ${rows.length} platforms in your library` : "Open your library"}
        <ChevronRight size={17} aria-hidden className="text-faint" />
      </Link>
    </div>
  );
}
