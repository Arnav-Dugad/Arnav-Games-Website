"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import {
  buildPersonalAnalytics,
  personalGameIds,
  type CatalogueBenchmark,
  type TimeToBeatLike,
} from "@/lib/games/stats";
import type { Ref } from "@/lib/games/types";
import { StatsDashboard, type HoursStatus } from "./StatsDashboard";

/**
 * Time-to-beat figures are catalogue data, identical for every user and slow
 * to change, so they are cached for the life of the tab. Revisiting /stats or
 * adding one game then costs one small request for the new id, not the
 * whole library again.
 */
const ttbCache = new Map<number, TimeToBeatLike | null>();
let ttbSourceAvailable: boolean | null = null;
const EMPTY_TTB: Record<number, TimeToBeatLike> = {};

interface MetadataResponse {
  timeToBeat?: Record<string, TimeToBeatLike>;
  timeToBeatAvailable?: boolean;
}

async function loadTimeToBeat(ids: number[]): Promise<boolean> {
  const missing = ids.filter((id) => !ttbCache.has(id));
  if (missing.length === 0) return ttbSourceAvailable ?? false;

  const chunks: number[][] = [];
  for (let offset = 0; offset < missing.length; offset += 100) chunks.push(missing.slice(offset, offset + 100));

  const results = await Promise.all(chunks.map(async (chunk) => {
    const response = await fetch("/api/library/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: chunk, include: ["timeToBeat"] }),
    });
    if (!response.ok) return false;
    const payload = await response.json() as MetadataResponse;
    if (!payload.timeToBeatAvailable) return false;
    // Cache misses too, so a game IGDB doesn't know isn't re-asked every visit.
    for (const id of chunk) ttbCache.set(id, payload.timeToBeat?.[String(id)] ?? null);
    return true;
  }));

  // One answering chunk is enough to show hours; the coverage note then says
  // how many games actually had data.
  ttbSourceAvailable = results.some(Boolean) || Boolean(ttbSourceAvailable);
  return ttbSourceAvailable;
}

export function StatsView({ genreDirectory, benchmark }: { genreDirectory: Ref[]; benchmark: CatalogueBenchmark | null }) {
  const { entries, loading } = useWatchlist();
  const ids = useMemo(() => personalGameIds(entries), [entries]);
  const idsKey = ids.join(",");
  const [hours, setHours] = useState<{ key: string; status: HoursStatus; data: Record<number, TimeToBeatLike> | null }>({
    key: "",
    status: "loading",
    data: null,
  });

  useEffect(() => {
    if (loading || !idsKey) return;
    let active = true;
    const wanted = idsKey.split(",").map(Number);
    loadTimeToBeat(wanted)
      .then((available) => {
        if (!active) return;
        const data: Record<number, TimeToBeatLike> = {};
        for (const id of wanted) {
          const value = ttbCache.get(id);
          if (value) data[id] = value;
        }
        setHours({ key: idsKey, status: available ? "ready" : "unavailable", data: available ? data : null });
      })
      .catch(() => {
        if (active) setHours({ key: idsKey, status: "unavailable", data: null });
      });
    return () => {
      active = false;
    };
  }, [idsKey, loading]);

  // Until the lookup for *this* set of games lands, keep showing the previous
  // figures (or a skeleton on first load) instead of flashing zero hours.
  // No IGDB ids at all (e.g. only Steam-sourced records) means there is
  // nothing to look up: hours are "ready" with no data, which the cards
  // report honestly rather than spinning forever.
  const hoursStatus: HoursStatus = !idsKey
    ? "ready"
    : hours.key === idsKey ? hours.status : hours.status === "ready" ? "ready" : "loading";
  const hoursData = idsKey ? hours.data : EMPTY_TTB;
  const analytics = useMemo(
    () => buildPersonalAnalytics(entries, { genreDirectory, timeToBeat: hoursStatus === "ready" ? hoursData : null }),
    [entries, genreDirectory, hoursStatus, hoursData],
  );

  if (loading) return <StatsSkeleton />;
  if (analytics.totalGames === 0) {
    return (
      <Container className="py-12">
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
    <Container className="py-6 lg:py-10">
      <StatsDashboard analytics={analytics} benchmark={benchmark} hoursStatus={hoursStatus} />
    </Container>
  );
}

function StatsSkeleton() {
  return (
    <Container className="grid grid-cols-1 gap-4 py-6 md:grid-cols-2 lg:grid-cols-12 lg:py-10">
      <Skeleton className="h-64 rounded-[1.75rem] md:col-span-2 lg:col-span-7" />
      <Skeleton className="h-64 rounded-[1.75rem] lg:col-span-5" />
      <Skeleton className="h-96 rounded-[1.75rem] lg:col-span-6" />
      <Skeleton className="h-96 rounded-[1.75rem] lg:col-span-6" />
    </Container>
  );
}
