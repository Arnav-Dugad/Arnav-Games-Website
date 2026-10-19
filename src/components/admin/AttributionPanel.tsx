"use client";

/**
 * "What drives follows & sign-ups": per source (the shelf or rail tapped
 * before a game view), game views, follows, sign-ups and follow rate. Views
 * get the bar — they're the denominator everything else is read against.
 */

import { motion } from "motion/react";
import type { StatsResponse } from "@/lib/analytics/types";
import { formatCount, useChartMotion } from "./charts";
import { Caveat, Panel, PanelEmpty, formatRate, prettySource } from "./ui";
import { cn } from "@/lib/utils/cn";

export function AttributionPanel({ data }: { data: StatsResponse }) {
  const animate = useChartMotion();
  const rows = data.attribution;
  const maxViews = Math.max(1, ...rows.map((row) => row.views));

  return (
    <Panel
      className="lg:col-span-12"
      title="What drives follows & sign-ups"
      subtitle="By the shelf or rail tapped before viewing a game"
    >
      {rows.length === 0 ? (
        <PanelEmpty>No attributed game views in this range yet.</PanelEmpty>
      ) : (
        <>
        {/* Phones: one grouped row per source, every number visible without
            sideways scrolling. */}
        <ul className="divide-y divide-line sm:hidden">
          {rows.map((row) => (
            <li key={row.src || "(none)"} className="py-3 first:pt-0">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className={cn("min-w-0 truncate font-medium", !row.src && "text-muted")}>
                  {row.src ? prettySource(row.src) : "No recorded source"}
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  {row.views > 0 ? `${formatRate(row.follows / row.views)} follow rate` : "—"}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-fg/[0.06]">
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, (row.views / maxViews) * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-[12px] tabular-nums text-faint">
                <span className="font-semibold text-text">{formatCount(row.views)}</span> views ·{" "}
                <span className="font-semibold text-text">{formatCount(row.follows)}</span> follows ·{" "}
                <span className="font-semibold text-text">{formatCount(row.signups)}</span> sign-ups
              </p>
            </li>
          ))}
        </ul>
        <div className="-mx-1 hidden overflow-x-auto px-1 sm:block">
          <table className="w-full min-w-[34rem] text-left text-[13px]">
            <caption className="sr-only">Game views and conversions by source</caption>
            <thead>
              <tr className="text-[12px] text-faint">
                <th scope="col" className="pb-2 font-medium">Source</th>
                <th scope="col" className="w-[38%] pb-2 font-medium">Game views</th>
                <th scope="col" className="pb-2 text-right font-medium">Follows</th>
                <th scope="col" className="pb-2 text-right font-medium">Sign-ups</th>
                <th scope="col" className="pb-2 text-right font-medium">Follow rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row, index) => (
                <tr key={row.src || "(none)"}>
                  <th scope="row" className={cn("max-w-[14rem] truncate py-2.5 pr-3 font-medium", !row.src && "text-muted")} title={row.src || undefined}>
                    {row.src ? prettySource(row.src) : "No recorded source"}
                  </th>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2.5">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-fg/[0.06]">
                        <motion.div
                          className="h-full rounded-full bg-brand"
                          initial={animate ? { width: 0 } : false}
                          animate={{ width: `${Math.max(2, (row.views / maxViews) * 100)}%` }}
                          transition={{ duration: 0.7, delay: animate ? index * 0.03 : 0, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right font-semibold tabular-nums">{formatCount(row.views)}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right font-semibold tabular-nums">{formatCount(row.follows)}</td>
                  <td className="py-2.5 text-right font-semibold tabular-nums">{formatCount(row.signups)}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted">
                    {row.views > 0 ? formatRate(row.follows / row.views) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      <Caveat>
        A source is remembered for 30 minutes in the tab, so a follow or sign-up is credited to the last shelf that led
        to a game. Typed URLs, back/forward and outside links have no recorded source. Counts are events, not people.
      </Caveat>
    </Panel>
  );
}
