"use client";

/**
 * Cookieless pageview + Web Vitals tracker, mounted once in the root layout.
 *
 * Renders nothing. Must sit inside a <Suspense> boundary: `useSearchParams`
 * would otherwise opt every statically-rendered route out of prerendering.
 */

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { deviceClass, externalReferrerHost, isUntrackedPath, send } from "@/lib/analytics/client";
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
    if (isUntrackedPath(pathname)) return;

    const isEntry = !entrySent;
    entrySent = true;
    send([
      {
        type: "pageview",
        path: pathname,
        device: deviceClass(),
        ref: isEntry ? externalReferrerHost() : null,
        value: isEntry ? 1 : 0,
      },
    ]);
  }, [pathname, url]);

  useEffect(() => {
    startWebVitals();
  }, []);

  return null;
}
