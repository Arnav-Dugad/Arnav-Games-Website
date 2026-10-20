"use client";

/**
 * DEV PREVIEW ONLY: the stats dashboard with the deeper cards fed from the
 * sample journal, purchases and prices (`sampleDeep`), through the same
 * `useDeepInsights` the live page uses — no network, no account.
 */

import type { ComponentProps } from "react";
import type { WatchlistEntry } from "@/lib/firebase/db";
import { StatsDashboard } from "./StatsDashboard";
import { useDeepInsights, type DeepPreview } from "./useDeepInsights";

export function StatsPreviewClient({
  entries,
  deep,
  ...dashboard
}: Omit<ComponentProps<typeof StatsDashboard>, "deep"> & { entries: WatchlistEntry[]; deep: DeepPreview | null }) {
  const insights = useDeepInsights(entries, deep ?? undefined);
  return <StatsDashboard {...dashboard} deep={deep ? insights : null} />;
}
