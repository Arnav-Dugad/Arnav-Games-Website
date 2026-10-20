"use client";

/**
 * Client-only game page sections fed by the lazily-loaded extras. Each renders
 * nothing until its data exists, so there is nothing worth server-rendering —
 * and loading them this way keeps them out of the Worker's server bundle.
 */

import dynamic from "next/dynamic";

export const CommunitySection = dynamic(() => import("./CommunitySection"), { ssr: false });
export const KeyPeople = dynamic(() => import("./KeyPeople"), { ssr: false });
// The developers' track records, inside "Credits" beside Key people (same extras request).
export const StudioTrackRecord = dynamic(() => import("./StudioTrackRecord"), { ssr: false });
// The reader's own hours and journal: signed-in, browser-only data.
export const YourPlay = dynamic(() => import("@/components/personal/YourPlay"), { ssr: false });
// The blurred-artwork light under the top of the page: decoration, drawn after load.
export const ArtAmbient = dynamic(() => import("./ArtAmbient"), { ssr: false });
