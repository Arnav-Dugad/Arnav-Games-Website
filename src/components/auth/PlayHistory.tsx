"use client";

/**
 * Play history, grouped by the platform the user actually played on.
 *
 * Deliberately distinct from the watchlist: this answers "what have I played,
 * and where?" rather than "what am I waiting for". Only games marked played or
 * playing appear, most recently finished first, so the list reads as a record
 * rather than a backlog.
 */

import Link from "next/link";
import { useMemo } from "react";
import { CircleDot, Gamepad2, Trophy } from "lucide-react";
import { Monitor } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { brandIcon } from "@/components/brand/brand-icons";
import { GameCover } from "@/components/game/GameCover";
import { ScorePill } from "@/components/ui/ScoreRing";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { cn } from "@/lib/utils/cn";
import type { WatchlistEntry } from "@/lib/firebase/db";
import type { PlatformKey } from "@/lib/utils/format";

const PLATFORM_LABELS: Record<string, string> = {
  pc: "PC",
  playstation: "PlayStation",
  xbox: "Xbox",
  nintendo: "Nintendo",
  mac: "macOS",
  linux: "Linux",
  mobile: "Mobile",
  web: "Browser",
  unassigned: "Platform not set",
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

interface Group {
  key: string;
  label: string;
  entries: WatchlistEntry[];
}

export function PlayHistory() {
  const { entries, loading } = useWatchlist();

  const groups = useMemo<Group[]>(() => {
    const played = entries.filter(
      (entry) => entry.status === "played" || entry.status === "playing",
    );

    const byPlatform = new Map<string, WatchlistEntry[]>();
    for (const entry of played) {
      const key = entry.platform ?? "unassigned";
      const bucket = byPlatform.get(key);
      if (bucket) bucket.push(entry);
      else byPlatform.set(key, [entry]);
    }

    return [...byPlatform.entries()]
      .map(([key, list]) => ({
        key,
        label: PLATFORM_LABELS[key] ?? key,
        entries: list.sort(
          (a, b) => (b.finishedAt ?? b.startedAt ?? b.addedAt) - (a.finishedAt ?? a.startedAt ?? a.addedAt),
        ),
      }))
      // Biggest platform first; "unassigned" always sinks to the bottom.
      .sort((a, b) => {
        if (a.key === "unassigned") return 1;
        if (b.key === "unassigned") return -1;
        return b.entries.length - a.entries.length;
      });
  }, [entries]);

  const finished = entries.filter((entry) => entry.status === "played").length;
  const inProgress = entries.filter((entry) => entry.status === "playing").length;

  if (loading) {
    return <div className="shimmer-bg mt-6 h-40 rounded-3xl" />;
  }

  if (groups.length === 0) {
    return (
      <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-line py-16 text-center">
        <Gamepad2 size={22} className="text-faint" />
        <p className="mt-3 max-w-sm text-sm text-muted">
          Nothing here yet. Mark a tracked game as <span className="text-text">playing</span> or{" "}
          <span className="text-text">played</span> and set the platform, and it&rsquo;ll show up
          in your history.
        </p>
        <Button href="/watchlist" variant="secondary" size="sm" className="mt-5">
          Go to your watchlist
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      <div className="flex flex-wrap gap-3">
        <Stat icon={<Trophy size={15} className="text-gold" />} value={finished} label="finished" />
        <Stat
          icon={<CircleDot size={15} className="text-brand-soft" />}
          value={inProgress}
          label="in progress"
        />
        <Stat
          icon={<Gamepad2 size={15} className="text-neon" />}
          value={groups.filter((group) => group.key !== "unassigned").length}
          label="platforms"
        />
      </div>

      {groups.map((group, index) => (
        <Reveal key={group.key} delay={Math.min(index, 4) * 0.05} blur={false}>
          <div className="mb-3 flex items-center gap-2.5">
            <PlatformGlyph platform={group.key} />
            <h3 className="font-display text-lg font-bold">{group.label}</h3>
            <span className="rounded-full bg-fg/6 px-2 py-0.5 text-[11px] font-medium text-muted tabular-nums">
              {group.entries.length}
            </span>
          </div>

          <ul className="grid gap-2.5 sm:grid-cols-2">
            {group.entries.map((entry) => (
              <li key={entry.gameId}>
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
                    <span className="mt-0.5 block text-[11px] text-faint">
                      {entry.status === "played"
                        ? entry.finishedAt
                          ? `Finished ${DATE_FMT.format(new Date(entry.finishedAt))}`
                          : "Finished"
                        : entry.startedAt
                          ? `Playing since ${DATE_FMT.format(new Date(entry.startedAt))}`
                          : "Playing"}
                    </span>
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

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-fg/[0.04] px-4 py-2 text-sm">
      {icon}
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-muted">{label}</span>
    </span>
  );
}

function PlatformGlyph({ platform }: { platform: string }) {
  const usable = platform !== "pc" && platform !== "unassigned" && brandIcon(platform);
  return (
    <span className={cn("grid h-8 w-8 place-items-center rounded-lg border border-line bg-fg/[0.04]")}>
      {usable ? (
        <BrandIcon name={platform as PlatformKey} size={15} tinted title={null} />
      ) : (
        <Monitor size={15} className="text-faint" aria-hidden />
      )}
    </span>
  );
}
