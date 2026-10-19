/*
 * Arnav Games service worker. Hand-written (no Workbox) to stay small and
 * fully understood.
 *
 * Strategy by request type
 *   Page navigations ........ network-first; on failure the saved copy of that
 *                             page, else the /offline page. Successful pages
 *                             are saved (capped) so anything visited reopens
 *                             offline. Slow networks fall back to the saved
 *                             copy after NAV_TIMEOUT_MS when one exists.
 *   /_next/static/* ......... cache-first. These files are content-hashed and
 *                             immutable, so a cached copy is never stale and
 *                             revalidating it would only re-download the same
 *                             bytes. (Fonts from next/font live here too.)
 *   IGDB / Steam / YouTube
 *   images .................. stale-while-revalidate with expiry: fresh for a
 *                             day, served-then-refreshed up to a week, then
 *                             refetched; size-capped. Fetched in CORS mode (all
 *                             three CDNs send ACAO: *) so responses are real,
 *                             measurable entries rather than opaque ones,
 *                             which browsers pad to megabytes of quota each.
 *   App icons, manifest ..... stale-while-revalidate.
 *   Everything else ......... untouched: non-GET, /api/*, /admin, auth pages,
 *                             Firebase/Google endpoints, RSC payloads, ranges.
 *
 * Install precaches the offline page and icons (required), then warms the
 * library/watchlist/stats/profile/home shells and the scripts and styles they
 * reference (best effort), so those open offline on the first offline launch
 * even if never visited. Their data comes from Firestore's on-device cache.
 *
 * Updating: bump VERSION whenever this file changes. The new worker installs
 * alongside the old one and waits; the page shows "Update available —
 * Reload", which posts SKIP_WAITING. Activation deletes every cache from
 * older versions.
 */

const VERSION = "2026-10-19.1";

const CACHE = {
  shell: `ag-shell-${VERSION}`,
  pages: `ag-pages-${VERSION}`,
  static: `ag-static-${VERSION}`,
  images: `ag-images-${VERSION}`,
};

const OFFLINE_URL = "/offline";

/** Must all succeed or the install fails (and is retried on the next visit). */
const REQUIRED = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/favicon.ico",
  "/icon.svg",
  "/apple-icon.png",
];

/** App shells that should open offline even if never visited. Best effort. */
const WARM_PAGES = ["/", "/library", "/watchlist", "/stats", "/profile"];

const LIMITS = { pages: 40, static: 400, images: 250 };

const NAV_TIMEOUT_MS = 6000;
const DAY = 24 * 60 * 60 * 1000;
const IMAGE_FRESH_MS = DAY;
const IMAGE_MAX_AGE_MS = 7 * DAY;
const STAMP_HEADER = "x-sw-cached-at";

const IMAGE_HOSTS = [
  /^images\.igdb\.com$/,
  /(^|\.)steamstatic\.com$/,
  /^steamcdn-a\.akamaihd\.net$/,
  /^i\.ytimg\.com$/,
];

/** Same-origin paths the worker must never touch. */
const BYPASS_PREFIXES = ["/api/", "/admin", "/login", "/signup", "/__/", "/sw.js"];

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(CACHE.shell);
      await shell.addAll(REQUIRED.map((url) => new Request(url, { cache: "reload" })));
      // The offline page needs its own scripts and styles too.
      await warmPages([OFFLINE_URL, ...WARM_PAGES]);
    })(),
  );
  // No skipWaiting() here: an update waits for the page to ask (see message).
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set(Object.values(CACHE));
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("ag-") && !keep.has(n)).map((n) => caches.delete(n)));
      // Lets the browser start the navigation request while the worker boots.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (BYPASS_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p))) return;

    if (request.mode === "navigate") {
      event.respondWith(networkFirstPage(event, url));
      return;
    }
    // Client-side navigations fetch RSC payloads; their shape depends on the
    // router state sent in headers, so they aren't safely cacheable. When one
    // fails offline, Next falls back to a full navigation, which lands above.
    if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

    if (url.pathname.startsWith("/_next/static/")) {
      event.respondWith(cacheFirst(event, CACHE.static, LIMITS.static));
      return;
    }
    if (
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/favicon.ico" ||
      url.pathname === "/icon.svg" ||
      url.pathname === "/apple-icon.png"
    ) {
      event.respondWith(staleWhileRevalidate(event, CACHE.shell));
      return;
    }
    return;
  }

  // The Steam CDNs also serve trailer videos; only images belong in this cache.
  const isImage =
    request.destination === "image" ||
    (request.destination === "" && /\.(jpe?g|png|webp|avif|gif)$/i.test(url.pathname));
  if (isImage && IMAGE_HOSTS.some((re) => re.test(url.hostname))) {
    event.respondWith(cachedImage(event));
  }
});

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

async function networkFirstPage(event, url) {
  const cache = await caches.open(CACHE.pages);
  const key = pageKey(url);
  const saved = await cache.match(key);

  const network = (async () => {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(event.request));
    if (response.ok && response.type === "basic") {
      const copy = await storable(response.clone());
      event.waitUntil(
        cache
          .put(key, copy)
          .then(() => trim(CACHE.pages, LIMITS.pages))
          .catch(() => {}),
      );
    }
    return response;
  })();

  try {
    if (!saved) return await network;
    // Network wins if it answers in time; otherwise show the saved copy now
    // and let the network response refresh the cache in the background.
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    event.waitUntil(network.catch(() => {}));
    return saved;
  } catch {
    if (saved) return saved;
    // Same page with a different query string (e.g. ?source=pwa) is a good
    // stand-in for the shell; the page reads its own params client-side.
    const similar = await cache.match(key, { ignoreSearch: true });
    if (similar) return similar;
    const offline = await caches.match(OFFLINE_URL);
    return offline || new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function cacheFirst(event, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (response.ok) {
    event.waitUntil(
      cache
        .put(event.request, response.clone())
        .then(() => trim(cacheName, limit))
        .catch(() => {}),
    );
  }
  return response;
}

async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request, { ignoreSearch: true });
  const network = fetch(event.request)
    .then(async (response) => {
      if (response.ok) await cache.put(stripSearch(event.request.url), response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(network);
    return hit;
  }
  return (await network) || fetch(event.request);
}

async function cachedImage(event) {
  const url = event.request.url;
  const cache = await caches.open(CACHE.images);
  const hit = await cache.match(url);
  const age = hit ? Date.now() - Number(hit.headers.get(STAMP_HEADER) || 0) : Infinity;

  const refresh = () =>
    fetch(url, { mode: "cors", credentials: "omit" })
      .then(async (response) => {
        if (!response.ok) return response;
        const stamped = await stamp(response.clone());
        await cache
          .put(url, stamped)
          .then(() => trim(CACHE.images, LIMITS.images))
          .catch(async (err) => {
            // Out of quota: images are the expendable cache.
            if (err && err.name === "QuotaExceededError") await caches.delete(CACHE.images);
          });
        return response;
      })
      .catch(() => null);

  if (hit && age < IMAGE_FRESH_MS) return hit;
  if (hit && age < IMAGE_MAX_AGE_MS) {
    event.waitUntil(refresh());
    return hit;
  }
  const fresh = await refresh();
  if (fresh) return fresh;
  if (hit) return hit; // expired, but better than a broken image offline
  // CORS refused or network down: let the browser make its normal request.
  return fetch(event.request);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pages are keyed without tracking params so ?source=pwa doesn't fork the cache. */
function pageKey(url) {
  const key = new URL(url.href);
  key.hash = "";
  key.searchParams.delete("source");
  key.searchParams.delete("_rsc");
  return key.href;
}

function stripSearch(href) {
  const url = new URL(href);
  url.search = "";
  return url.href;
}

/**
 * A response that followed redirects can't be replayed for a navigation
 * (Safari rejects it), so cache a clean copy with the same body and headers.
 */
async function storable(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function stamp(response) {
  const headers = new Headers(response.headers);
  headers.set(STAMP_HEADER, String(Date.now()));
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
}

/** Deletes the oldest entries beyond `max` (Cache keys come back in insertion order). */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

/**
 * Fetches each page, saves it, and saves the /_next/static assets its HTML
 * references, so the shell can boot offline. Every step is best effort.
 */
async function warmPages(paths) {
  const shell = await caches.open(CACHE.shell);
  const pages = await caches.open(CACHE.pages);
  const statics = await caches.open(CACHE.static);
  const assets = new Set();

  await Promise.all(
    paths.map(async (path) => {
      try {
        const url = new URL(path, self.location.origin);
        // The offline page was just precached; read it back rather than refetch.
        const precached = path === OFFLINE_URL ? await shell.match(url.href) : undefined;
        const response = precached || (await fetch(url, { cache: "no-cache", credentials: "same-origin" }));
        if (!response.ok || response.type !== "basic") return;
        const html = await response.clone().text();
        // Only plain asset URLs; the inline RSC payload escapes its quotes,
        // which the character class stops at.
        for (const match of html.matchAll(/\/_next\/static\/[^"'`\s\\)<>&]+/g)) assets.add(match[0]);
        if (!precached) await pages.put(pageKey(url), await storable(response));
      } catch {
        /* offline or server error: this shell will be saved on first visit instead */
      }
    }),
  );

  await Promise.all(
    [...assets].slice(0, 150).map(async (path) => {
      try {
        if (await statics.match(path)) return;
        const response = await fetch(path);
        if (response.ok) await statics.put(path, response);
      } catch {
        /* skip */
      }
    }),
  );
}
