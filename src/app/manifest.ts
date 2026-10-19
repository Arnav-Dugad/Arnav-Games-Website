import type { MetadataRoute } from "next";
import { APP_BACKGROUND } from "@/components/pwa/brand-mark";

/**
 * Web app manifest, served at /manifest.webmanifest (Next links it from every
 * page automatically).
 *
 * Static — no request-time APIs — so it's generated once at build and costs
 * the Worker nothing per request. Icon, shortcut and screenshot files are
 * produced by `scripts/generate-pwa-assets.ts`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable id lets browsers recognise the installed app across start_url
    // changes; it is resolved against the origin.
    id: "/?source=pwa",
    name: "Arnav Games",
    short_name: "Arnav Games",
    description:
      "Upcoming video game releases, critic scores and your personal library — on your home screen, and available offline.",
    lang: "en",
    dir: "ltr",
    // The query string tags launches from the home screen in analytics; it is
    // ignored by the page itself and covered by the scope below.
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    // Desktop Chromium: draw the app's own header into the title bar area.
    // Browsers that don't support it fall through to standalone.
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: APP_BACKGROUND,
    theme_color: APP_BACKGROUND,
    categories: ["games", "entertainment", "lifestyle"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
    ],
    shortcuts: [
      {
        // First: on Android the long-press list is ordered, and this is the
        // glance people install the app for.
        name: "Today",
        short_name: "Today",
        description: "Your next releases and what's out today",
        url: "/today",
        icons: [{ src: "/icons/shortcut-today.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Upcoming releases",
        short_name: "Upcoming",
        description: "What's releasing next",
        url: "/upcoming",
        icons: [{ src: "/icons/shortcut-upcoming.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Your library",
        short_name: "Library",
        description: "Games you own, across every storefront",
        url: "/library",
        icons: [{ src: "/icons/shortcut-library.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Search",
        short_name: "Search",
        description: "Find a game, studio or franchise",
        url: "/search",
        icons: [{ src: "/icons/shortcut-search.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Your stats",
        short_name: "Stats",
        description: "Your gaming year in numbers",
        url: "/stats",
        icons: [{ src: "/icons/shortcut-stats.png", sizes: "192x192", type: "image/png" }],
      },
    ],
    screenshots: [
      {
        src: "/screenshots/home-narrow.jpg",
        sizes: "780x1688",
        type: "image/jpeg",
        form_factor: "narrow",
        label: "Home — the biggest upcoming releases",
      },
      {
        src: "/screenshots/upcoming-narrow.jpg",
        sizes: "780x1688",
        type: "image/jpeg",
        form_factor: "narrow",
        label: "Upcoming — every release date in one calendar",
      },
      {
        src: "/screenshots/home-wide.jpg",
        sizes: "1440x900",
        type: "image/jpeg",
        form_factor: "wide",
        label: "Home on desktop",
      },
      {
        src: "/screenshots/upcoming-wide.jpg",
        sizes: "1440x900",
        type: "image/jpeg",
        form_factor: "wide",
        label: "Upcoming releases on desktop",
      },
    ],
  };
}
