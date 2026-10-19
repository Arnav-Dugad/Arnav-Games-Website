"use client";

/**
 * Cohort retention triangle: rows are the ISO week a browser first visited,
 * columns are weeks since. One hue, light → dark, because the only thing a
 * cell encodes is magnitude; the percentage is always printed, so colour is
 * never the sole carrier.
 */

import type { RetentionCohort, StatsResponse } from "@/lib/analytics/types";
import { formatCount } from "./charts";
import { Caveat, Panel, PanelEmpty } from "./ui";

const weekFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

export function RetentionPanel({ data }: { data: StatsResponse }) {
  const cohorts = data.retention;
  const weeks = cohorts[0]?.weeks.length ?? 0;
  const hasData = cohorts.some((cohort) => cohort.size > 0);

  return (
    <Panel
      className="lg:col-span-12"
      title="Weekly retention"
      subtitle="Share of each week's new browsers that came back in later weeks"
    >
      {!hasData ? (
        <PanelEmpty>
          No cohorts yet. Browsers are counted from their first visit after this feature shipped, so the triangle fills
          in week by week.
        </PanelEmpty>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <table className="w-full min-w-[40rem] border-separate border-spacing-[3px] text-[12px]">
            <caption className="sr-only">Retention by cohort week</caption>
            <thead>
              <tr className="text-faint">
                <th scope="col" className="pb-1.5 pr-2 text-left font-medium">Cohort</th>
                <th scope="col" className="pb-1.5 pr-2 text-right font-medium">New</th>
                {Array.from({ length: weeks }, (_, k) => (
                  <th key={k} scope="col" className="pb-1.5 text-center font-medium">
                    {k === 0 ? "Week 0" : `+${k}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((cohort) => (
                <CohortRow key={cohort.cohort} cohort={cohort} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Caveat>
        Estimated, cookieless. Each browser remembers only the week it first came, so a cleared browser or a second
        device reads as a new visitor, and private windows always do. A return counts once per browser per week.
      </Caveat>
    </Panel>
  );
}

function CohortRow({ cohort }: { cohort: RetentionCohort }) {
  const label = weekFmt.format(cohort.weekStart * 1000);
  return (
    <tr>
      <th scope="row" className="whitespace-nowrap pr-2 text-left font-medium text-text" title={cohort.cohort}>
        {label}
      </th>
      <td className="pr-2 text-right font-semibold tabular-nums text-text">{formatCount(cohort.size)}</td>
      {cohort.weeks.map((cell, k) => {
        if (cell === null) return <td key={k} aria-label="Not reached yet" />;
        if (cohort.size === 0) {
          return (
            <td key={k} className="h-9 rounded-lg bg-fg/[0.03] text-center text-faint">
              ·
            </td>
          );
        }
        // Week 0 is the cohort itself.
        const share = k === 0 ? 1 : Math.min(1, cell.returners / cohort.size);
        const pct = Math.round(share * 100);
        const title =
          k === 0
            ? `${cohort.size} new browsers in the week of ${label}`
            : `${cell.returners} of ${cohort.size} came back in week ${k} (${cell.returnDays} return day${cell.returnDays === 1 ? "" : "s"})`;
        return (
          <td
            key={k}
            title={title}
            className="h-9 min-w-[3.25rem] rounded-lg text-center font-semibold tabular-nums text-text"
            style={{ backgroundColor: `color-mix(in oklab, var(--color-brand) ${Math.round(8 + share * 50)}%, transparent)` }}
          >
            {pct}%
          </td>
        );
      })}
    </tr>
  );
}
