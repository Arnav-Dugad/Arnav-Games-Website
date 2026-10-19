"use client";

import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { buildPersonalAnalytics, type CatalogueBenchmark } from "@/lib/games/stats";
import type { Ref } from "@/lib/games/types";
import { StatsDashboard } from "./StatsDashboard";
import { useTimeToBeat } from "./useTimeToBeat";

/**
 * Live /stats: the reader's library plus IGDB time-to-beat (shared, tab-cached
 * lookup — the same one /library uses, so both pages quote the same hours).
 */
export function StatsView({ genreDirectory, benchmark }: { genreDirectory: Ref[]; benchmark: CatalogueBenchmark | null }) {
  const { entries, loading } = useWatchlist();
  const ttb = useTimeToBeat(entries, { enabled: !loading });
  const analytics = useMemo(
    () => buildPersonalAnalytics(entries, { genreDirectory, timeToBeat: ttb.status === "ready" ? ttb.data : null }),
    [entries, genreDirectory, ttb.status, ttb.data],
  );

  if (loading) return <StatsSkeleton />;
  if (analytics.totalGames === 0) {
    return (
      <Container className="py-8">
        <EmptyState
          icon={<BarChart3 size={24} />}
          title="Your story starts with one game"
          body="Track a game, mark what you own and what you've played, and this page turns it into your personal stats."
          action={{ href: "/browse", label: "Explore the catalogue" }}
          secondaryAction={{ href: "/upcoming", label: "See upcoming games" }}
        />
      </Container>
    );
  }

  return (
    <Container className="pb-10 lg:pb-14">
      <StatsDashboard analytics={analytics} benchmark={benchmark} hoursStatus={ttb.status} />
    </Container>
  );
}

/** Matches the dashboard: headline panel, jump bar, then a group of cards. */
export function StatsSkeleton() {
  return (
    <Container className="pb-10">
      <Skeleton className="h-64 rounded-3xl" />
      <Skeleton className="mt-6 h-9 w-80 max-w-full rounded-full" />
      <Skeleton className="mt-10 h-7 w-32 rounded-lg" />
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Skeleton className="h-80 rounded-3xl lg:col-span-5" />
        <Skeleton className="h-80 rounded-3xl lg:col-span-7" />
      </div>
    </Container>
  );
}
