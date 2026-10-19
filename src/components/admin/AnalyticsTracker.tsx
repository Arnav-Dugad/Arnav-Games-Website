"use client";

/**
 * Cookieless pageview + Web Vitals tracker, mounted once in the root layout.
 * Also tags the day's first pageview for retention cohorts, records which
 * shelf led to a game view, and drives the "online now" heartbeat.
 *
 * Renders nothing. Must sit inside a <Suspense> boundary: `useSearchParams`
 * would otherwise opt every statically-rendered route out of prerendering.
 */

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { startAttribution, takeViewSource } from "@/lib/analytics/attribution";
import { deviceClass, externalReferrerHost, isUntrackedPath, send, trackingAllowed } from "@/lib/analytics/client";
import { presenceNavigate } from "@/lib/analytics/presence-client";
import { takeVisitTags } from "@/lib/analytics/visits";
import { startWebVitals } from "@/lib/analytics/vitals";

/*
 * Module-level rather than refs: React's strict mode mounts effects twice in
 * development, and a page load has exactly one "first pageview" no matter
 * how many times this component mounts.
 */
let lastTrackedUrl: string | null = null;
let entrySent = false;

export function AnalyticsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Query changes count as navigations (a new filter is a new view), but only
  // the pathname is ever sent: query strings can carry search terms, emails
  // in shared links, or tokens, and would explode "top pages" cardinality.
  const url = `${pathname}?${searchParams?.toString() ?? ""}`;

  useEffect(() => {
    if (!pathname || url === lastTrackedUrl) return;
    lastTrackedUrl = url;
    // Runs on /admin too, so leaving the site for the dashboard drops this
    // tab from the live count instead of counting the owner.
    presenceNavigate(pathname);
    if (isUntrackedPath(pathname)) return;
    // `send` checks DNT/GPC too, but the visit tags write to localStorage,
    // which mustn't happen at all for those visitors.
    if (!trackingAllowed()) return;

    const isEntry = !entrySent;
    entrySent = true;
    const tags = takeVisitTags();
    send([
      {
        type: "pageview",
        path: pathname,
        device: deviceClass(),
        ref: isEntry ? externalReferrerHost() : null,
        value: isEntry ? 1 : 0,
        ...(tags ?? {}),
        src: takeViewSource(pathname) ?? undefined,
      },
    ]);
  }, [pathname, url]);

  useEffect(() => {
    startWebVitals();
    startAttribution();
  }, []);

  return null;
}
