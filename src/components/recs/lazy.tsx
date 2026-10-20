"use client";

/**
 * Client-only entry points for the recommendation UI. Picks are personal and
 * live on the device, so nothing here is worth rendering on the server — and
 * keeping it out of the server render keeps it out of the Worker bundle.
 */

import dynamic from "next/dynamic";

/** The homepage's recommendation rows; see `HomeRecRows` for the slots. */
export const HomeRecRows = dynamic(() => import("./HomeRecRows"), { ssr: false });
