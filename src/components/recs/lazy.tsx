"use client";

/**
 * Client-only entry points for the recommendation UI. Picks are personal and
 * live on the device, so nothing here is worth rendering on the server — and
 * keeping it out of the server render keeps it out of the Worker bundle.
 */

import dynamic from "next/dynamic";
import { RecRailSkeleton } from "./RecSkeleton";

export const ForYouView = dynamic(() => import("./ForYouView"), {
  ssr: false,
  loading: () => (
    <div className="space-y-12 pb-12 sm:space-y-16">
      <RecRailSkeleton variant="feature" />
      <RecRailSkeleton />
    </div>
  ),
});
