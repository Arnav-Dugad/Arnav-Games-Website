import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      // Firestore's Node build pulls in gRPC + protobufjs, which generates code
      // with `new Function` — forbidden on Cloudflare Workers, so every SSR'd
      // page that merely imports it would 500. Firestore never initialises on
      // the server (see lib/firebase/config.ts), so the browser build, which
      // talks over fetch, is the right one everywhere.
      "@firebase/firestore": "./node_modules/@firebase/firestore/dist/index.esm.js",
      // The web SDK can't run on the server, so the server build gets
      // throwing stubs instead of ~560 KB of dead weight in the Worker
      // (see src/lib/firebase/server-stubs). Browsers get the real SDK.
      // When adding a new firebase import, add it to the matching stub.
      "firebase/app": { browser: "./node_modules/firebase/app/dist/esm/index.esm.js", default: "./src/lib/firebase/server-stubs/app.ts" },
      "firebase/auth": { browser: "./node_modules/firebase/auth/dist/esm/index.esm.js", default: "./src/lib/firebase/server-stubs/auth.ts" },
      "firebase/firestore": { browser: "./node_modules/firebase/firestore/dist/esm/index.esm.js", default: "./src/lib/firebase/server-stubs/firestore.ts" },
    },
  },
  headers() {
    return [
      {
        // The service worker must be revalidated on every check or updates
        // stall behind the HTTP cache. On Cloudflare, /public files are served
        // by the assets layer before Next runs, so public/_headers carries the
        // same rules there; this entry covers `next start` and other hosts.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  redirects() {
    return [
      // Recommendations now live on the homepage, as rows between the shelves.
      { source: "/for-you", destination: "/#home-top-picks", permanent: true },
      { source: "/series", destination: "/franchises", permanent: true },
      { source: "/series/:slug", destination: "/franchise/:slug", permanent: true },
    ];
  },
  images: {
    // One entry per media host the data providers can hand back. next/image
    // refuses any origin not listed here, so a missing entry shows up as a
    // broken image rather than a silent fallback.
    remotePatterns: [
      // IGDB artwork (covers, screenshots).
      { protocol: "https", hostname: "images.igdb.com", pathname: "/**" },
      // Steam capsules, headers and screenshots. Valve rotates between several
      // CDN fronts for the same asset, so all of them have to be allowed.
      { protocol: "https", hostname: "cdn.cloudflare.steamstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "shared.cloudflare.steamstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "cdn.akamai.steamstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "shared.akamai.steamstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "shared.fastly.steamstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "cdn.steamstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "steamcdn-a.akamaihd.net", pathname: "/**" },
      // YouTube thumbnails for IGDB trailers (the poster only — the player
      // itself is not loaded until the user presses play).
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/**" },
    ],
    // Served straight from the provider CDNs. IGDB and Steam already publish
    // pre-sized assets, and on Cloudflare Workers this avoids routing every
    // poster through the metered Images transformation quota.
    unoptimized: true,
    formats: ["image/avif", "image/webp"],
    // Tuned to the breakpoints the grid actually renders at, so the optimiser
    // never generates sizes nothing requests.
    deviceSizes: [360, 420, 640, 768, 1024, 1280, 1536, 1920],
    imageSizes: [64, 96, 128, 200, 256, 320, 384],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "motion"],
    /*
     * The static-generation throttles that used to live here are gone.
     *
     * `cpus: 1`, `staticGenerationMaxConcurrency: 1` and
     * `staticGenerationMinPagesPerWorker: 1000` existed to stop parallel build
     * workers, each with its own process-local IGDB limiter, bursting past the
     * rate ceiling while prerendering game pages. No catalogue route is
     * prerendered any more — every page renders per request — so they protected
     * nothing and only serialised the build.
     *
     * If prerendering is ever restored, restore these with it.
     */
  },
};

export default nextConfig;

// Lets `next dev` read Cloudflare bindings (R2 cache) from wrangler.jsonc.
import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
