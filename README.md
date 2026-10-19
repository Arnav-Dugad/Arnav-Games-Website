# Arnav Games

**Live:** https://arnav-games.arnavrival12.workers.dev

A release calendar and reference database for video games — upcoming releases with
live countdowns, critic scores, screenshots, platforms, and a personal watchlist.

Built with Next.js 16 (App Router), React 19, Tailwind CSS v4, Motion and Firebase,
and hosted on Cloudflare Workers via the [OpenNext adapter](https://opennext.js.org/cloudflare).

---

## No placeholder data — ever

Every game on this site is real, live data from IGDB or Steam. There is no
bundled sample catalogue — if neither provider can be reached, the site says
so honestly instead of showing invented games.

```bash
npm install
npm run dev
```

The data layer is a **provider chain** — each request takes the first backend
that can answer it:

| Priority | Provider | Needs | Covers |
| --- | --- | --- | --- |
| 1 | **IGDB** | Free Twitch client id + secret | ~300k games, every platform, covers, screenshots, trailers, critic scores, release windows |
| 2 | **Steam** | **Nothing** | PC titles from the live storefront, with screenshots, MP4 trailers, system requirements and Metacritic scores |

Because Steam needs no credentials, a fresh deploy shows **live data
immediately**, even with zero configuration. Adding IGDB credentials upgrades
it to full console coverage. Steam also stands in automatically if a specific
IGDB request fails, so a transient IGDB hiccup degrades to Steam's live
catalogue rather than to nothing.

A provider returning "I can't answer this" falls through to the next one. A
provider returning *zero results* does not — that's a real answer, so a genuine
"no matches" is never disguised as a data-source problem. If every configured
provider genuinely fails, pages render an honest "live data is unreachable"
notice rather than fabricating content.

---

## Adding IGDB (free, ~2 minutes)

IGDB is run by Twitch/Amazon. The free tier is generous and every response here
is cached, so this app uses a tiny fraction of it.

1. Sign in at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) →
   **Register Your Application**
2. Name it anything; OAuth Redirect URL `http://localhost`; Category *Website*
3. Copy the **Client ID**, then **New Secret** and copy that
4. Put both in `.env.local`:

```bash
cp .env.local.example .env.local
# IGDB_CLIENT_ID=...
# IGDB_CLIENT_SECRET=...
```

Credentials are read server-side only and never reach the browser. The app
handles the OAuth token exchange, caching and refresh itself.

---

## Accounts & database — Firebase (optional)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Add a **Web App**, copy its config into the `NEXT_PUBLIC_FIREBASE_*` variables
3. **Authentication → Sign-in method** → enable *Email/Password* and *Google*
4. **Firestore Database** → create a database
5. Deploy the rules: `firebase deploy --only firestore:rules` ([`firebase.json`](./firebase.json)
   points at [`firestore.rules`](./firestore.rules); pasting them into **Firestore → Rules** works too)
6. **Authentication → Settings → Authorised domains** → add your deployed domain
7. **Project settings → Service accounts → Generate new private key**, then put the
   JSON, base64-encoded, in `FIREBASE_SERVICE_ACCOUNT` (`.env.local` for dev,
   `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT` for the Worker). The server
   uses it to write our sampled statistics; without it those features quietly
   switch off.

The `NEXT_PUBLIC_` prefix is correct here — Firebase web config is public by
design. Access is enforced by the Firestore rules, not by hiding these values.

Without Firebase the site still works; auth screens explain that sign-in isn't
configured instead of failing.

---

## Deploying to Cloudflare Workers

The site runs on Cloudflare Workers through `@opennextjs/cloudflare`. Config
lives in [`wrangler.jsonc`](./wrangler.jsonc) and
[`open-next.config.ts`](./open-next.config.ts).

```bash
npx wrangler login                                   # once
npx wrangler r2 bucket create arnav-games-opennext-cache   # once — Next's data cache
npx wrangler secret put IGDB_CLIENT_ID               # once per secret
npx wrangler secret put IGDB_CLIENT_SECRET
npm run deploy                                       # build + deploy
```

`npm run preview` builds the same bundle and serves it locally in the Workers
runtime, which is the closest thing to production.

The R2 bucket backs Next's incremental cache, so `unstable_cache` and route
`revalidate` windows actually hold between requests — without it every page view
would hit IGDB directly and trip its rate limit.

`NEXT_PUBLIC_*` variables are inlined **at build time**, so they must be present
in `.env.local` (or the shell) on the machine running `npm run deploy`.
`IGDB_*` are runtime secrets and live in Cloudflare (`wrangler secret put`).

| Variable | Needed for | Notes |
| --- | --- | --- |
| `IGDB_CLIENT_ID` | Full multi-platform game data | Server-only |
| `IGDB_CLIENT_SECRET` | Full multi-platform game data | Server-only |
| `NEXT_PUBLIC_SITE_URL` | Canonical URLs, sitemap, social cards | e.g. `https://arnav-games.arnavrival12.workers.dev`, no trailing slash |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Accounts, watchlist, reviews | Public by design |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Accounts | |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Accounts | |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Accounts | |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Accounts | |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Accounts | |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | — | Unused; Analytics is not wired up |
| `CRON_SECRET` | Cron jobs (`/api/cron/*`) | Secret. Sent by the Worker's cron triggers as `x-cron-secret`; without it scheduled jobs don't run |
| `FIREBASE_SERVICE_ACCOUNT` | Price/player/Twitch/review/score/release history, the crons' queue | Secret, server-only. Base64 of the service-account JSON; `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT` |

If you add Firebase after the first deploy, remember step 6 above — add the
`workers.dev` (or custom) domain to Firebase's authorised domains or Google
sign-in will be rejected.

### Notifications

Release and DLC alerts are derived **on the device** from the games you follow,
so the inbox needs no server, no scheduler, no permissions and no extra
configuration — it works as soon as Firebase accounts are set up.

There is deliberately no outbound push or email channel. Both need
infrastructure the free tiers don't comfortably cover: a scheduler to scan
releases for every user, and Resend requires a
sending domain you own. An inbox that always works beats a delivery pipeline
that half-works, so alerts live in the app and nowhere else.

---

## Where data lives

Everything persistent is in **Firestore** (project `ludex-7170f`); Cloudflare
holds no database any more (the D1 tables were migrated with
[`scripts/migrate-d1-to-firestore.ts`](./scripts/migrate-d1-to-firestore.ts)).

| Data | Location | Who reads | Who writes |
| --- | --- | --- | --- |
| Profile, library/watchlist, reviews | `users/{uid}`, `users/{uid}/watchlist/*`, `reviews/*` | Owner (reviews: everyone) | Owner, shape-checked by the rules |
| Preferences: motion, poster sizes, alerts, theme, price region, PC specs, recent searches, wishlist budget | device `localStorage` + `users/{uid}/settings/preferences` | Owner | Owner. The device copy is read first; the account mirrors it and restores it on a new device |
| Player / Twitch / review / critic-score history | `playerHistory/*`, `twitchHistory/*`, `reviewHistory/*`, `scoreHistory/*` (one document per series) | Everyone, **directly from the browser** | Server only (crons) |
| Price history, release-date history (delay tracker) | `priceHistory/{game}`, `releaseHistory/s0…s3` | Everyone | Server only |
| The crons' work queue | `trackedGames/index` | Server only | Server only |

The server talks to Firestore over REST with the service account
(`src/lib/firebase/server/`, RS256 signing via `crypto.subtle`, no Admin SDK).
The model in [`src/lib/games/stats-docs.ts`](./src/lib/games/stats-docs.ts) is
built for the free Spark quotas (50k reads / 20k writes a day): a whole series
is one document of `{ time: value }` fields, so a chart is one read, a sample is
one field write, and pruning happens inside that same write.

---

## Cloudflare usage

The Workers Free plan allows 100,000 requests a day, ~10 ms CPU per request and
50 outbound requests per invocation. Two facts shape the design: **every** page
view, API call and link prefetch that reaches the Worker counts, and on
`workers.dev` Cloudflare does not edge-cache Worker responses, so `s-maxage`
alone saves nothing (the `max-age` part does, in the browser). The work went
into making fewer requests:

| | Before | After |
| --- | --- | --- |
| Game page, after the HTML | 8 API calls (`/live`, `/market`, `/players`, `/pc`, `/patches`, `/reviews`, `/scores`, `/twitch`) | 1 (`/api/game/[id]/insights`); history charts read Firestore directly |
| Live numbers on an open game page | `/live` every 2 min, indefinitely | every 5 min while visible, at most 6 times per view |
| Links in view (game cards, rails, calendars) | prefetched on sight, a request or more per link | prefetched on hover/touch only (`prefetch={false}`) |
| Default price region | `/api/region` per new device | `ag-cc` cookie set by `worker.mjs` on page loads |
| Search suggestions, recommendations, time-to-beat | every page load / home visit | cached on the device (15 min / 6 h / 7 days) |
| API responses on back/forward and reloads | refetched | browser `max-age` on search, insights, live, market, PC |
| Database calls | D1 (free binding) | Firestore over HTTPS: batched (one commit per cron run; one batch read for the release shards) and cached in the R2 data cache where repeated (price and release history, 30 min) |

Estimated Worker requests for a visitor who opens the home page, three game
pages and one other page (estimates, not measurements: prefetch counts depend
on how many links are on screen):

| | Before | After |
| --- | --- | --- |
| Home | ~30 (HTML + prefetches + suggestions + recommendations) | ~2 |
| Game page ×3 | ~23 each ≈ 69 (HTML + 8 API + ~2 polls + ~12 prefetches) | ~3 each ≈ 9 |
| Other page | ~15 | ~2 |
| **Per visitor** | **~115** | **~13** |
| Visitors/day before hitting 100k | ~850 | ~7,500 |

Crons add ~360 requests a day either way (one `*/10` trigger: players every
run, Twitch twice an hour, reviews hourly, prices and scores daily), and each run
stays within 45 outbound requests including its Firestore read and single
commit. Firestore at the cron caps: about 5.9k writes/day for players, 2k for
Twitch, at most 1k for reviews, 0.3k for prices and 1k for scores, and ~220
reads; plus page-view bookkeeping (a write only when a release date or price
actually changed, and a "viewed" mark at most once per game per Worker isolate
per 6 h). A game page view costs up to 4 Firestore reads in the browser.

---

## Community, cloud and recommendation data

Free, keyless sources, each fetched server-side with an identifying
User-Agent, reduced to a compact shape and cached in the R2 data cache (no
outbound request on a hit). Big catalogues are never bundled into the Worker.

| Source | Module | Cached | Used for |
| --- | --- | --- | --- |
| NVIDIA GeForce NOW list (~400 KB) | `games/cloud.ts` | 24 h, as a ~60 KB index | `insights.cloud`, `/api/cloud/match`, `getGeForceNowHighlights()` |
| AreWeAntiCheatYet (~470 KB) | `games/anticheat.ts` | 24 h, compact index | `insights.antiCheat` |
| GOG catalogue + prices | `games/gog.ts` | 7 d search / 30 min price | third local-price store in `market.prices` |
| CheapShark all-time low | `games/live.ts` (existing call) | 30 min | `market.lowestEver`, labelled "Lowest ever (US, all stores)" |
| SteamSpy | `games/steamspy.ts` | 24 h app / 7 d tag | `extras.steamSpy`, recommendation tag neighbours |
| PCGamingWiki (MediaWiki API) | `games/pcgw.ts` | 7 d | `extras.pcgw` (features, accessibility) |
| speedrun.com | `games/speedrun.ts` | 24 h | `extras.speedrun` |
| Thunderstore (+ Nexus / Workshop link-outs) | `games/mods.ts` | 7 d / 24 h | `extras.mods` |
| Wikidata people (P57/P287/P86/P162/P58 via P5794) | `games/people.ts` | 7 d | `extras.people`, `getPerson(qid)` |
| Epic free games | `games/epic.ts` | 3 h (re-checked against the clock) | `getEpicFreeGames(cc)` |

Matching is by Steam appid first, then an exact normalised title
(`games/external-rules.ts`, which holds every parser and is covered by
`check:data`); a miss shows nothing rather than a wrong badge.

| Endpoint | Returns | Outbound, cold / warm |
| --- | --- | --- |
| `GET /api/game/[id]/insights` | `GameInsights` (+ `cloud`, `antiCheat`, GOG price, `market.lowestEver`) | ≤ ~34 / 3–6 |
| `GET /api/game/[id]/extras?steam=&name=&slug=` | `GameExtras` — request lazily, after insights | ≤ ~15 / 0–2 |
| `POST /api/cloud/match { ids }` | `CloudMatchResponse` (Game Pass + GeForce NOW per id) | ≤ ~27 / 0–2 |
| `POST /api/recommendations/v2` | `RecommendationsV2` for a `RecsProfile` | ≤ ~19 / 0 |

**In the UI.** The game page shows GeForce NOW and GOG in "Where to play",
the US all-stores low as its own labelled line, anti-cheat in "Steam Deck and
Linux", PCGamingWiki features and accessibility, a "Community" section (Steam
tags, world records, mods) and key people under Credits; extras load once,
when those sections near the viewport. `useRecommendationsV2`
(`src/lib/recs/use-recommendations.ts`) is the one client for v2 — home, `/for-you`,
the library's "For your devices" and a signed-in "More like this" share one
answer, cached on the device for 6 h per profile; `useCloudMatches` does the
same for the library's "Play in the cloud". Home adds Epic's free games for
the visitor's country; Discover adds "Ready on GeForce NOW".

**Recommendations v2** (`src/lib/recs/`). The browser builds an anonymous
`RecsProfile` with `buildTasteProfile(entries, reviews, feedback, options)`
(game ids and weights only). The server gathers candidates in one IGDB
multi-query (similar games of liked titles, same series/studio, keyword,
theme × genre and perspective × mode matches, hidden gems, new and upcoming
releases, SteamSpy tag neighbours for PC players), scores them with a
weighted model — TF-IDF taste cosine, Bayesian quality prior, popularity
*and* novelty, platform/Game Pass/GeForce NOW availability, length fit,
penalties for dismissed or ignored picks — diversifies each list with MMR and
explains every pick (`reasons`). Pure maths lives in `recs/rank.ts`; the
answer is cached 6 h per profile.

---

## Pages

| Route | What it does |
| --- | --- |
| `/` | Cinematic hero plus a signed-in command center for current games, tracked releases, collection progress, taste signals and explained recommendations; live discovery rails remain for everyone |
| `/upcoming` | Month-grouped release calendar with per-title countdowns |
| `/browse` | Full database with genre/platform filters, sorting and pagination — all URL-driven |
| `/game/[slug]` | Cinematic game dossier: live hero media, active section dock, editorial gallery, distinct DLC/expansion/edition poster shelves, franchise portals, structured metadata, requirements, reviews and related games |
| `/genres`, `/platforms`, `/studios`, `/franchises` | Searchable category and relationship browsing |
| `/login`, `/signup` | Split-screen auth with email/password and Google |
| `/watchlist` | Followed games and play status (want / playing / played), with Firebase-backed ownership and subscription access |
| `/stats` | Private collection intelligence with unique-game ownership, follow, subscription, progress, platform, genre, release-era, timeline and review insights |
| `/profile` | Identity, stats, review history, settings |
| `/for-you` | Recommendations v2, every group with its reasons (top picks, "Because you liked X" per seed, hidden gems, new, coming soon, on your devices); thumbs-up / not-interested feedback saved to `users/{uid}/feedback` (device copy when signed out) |
| `/person/[qid]` | A director, writer, composer… from Wikidata: photo, roles, Wikipedia and every game with the role held on it |

Every game page also generates its own social card at
`/game/[slug]/opengraph-image` — artwork, critic score and release date — so
shared links preview properly instead of falling back to plain text.

Search is a ⌘K command palette available from anywhere (also `/`, the header, and
the mobile Search tab).

---

## Mobile and desktop are designed separately

Not one layout scaled down. Two custom Tailwind variants — `fine:` (mouse) and
`coarse:` (touch) — drive genuinely different behaviour:

| | Desktop | Touch |
| --- | --- | --- |
| Navigation | Inline header nav with a spring-animated active pill | Bottom tab bar, thumb-reachable, safe-area aware |
| Cards | 3D pointer tilt, specular glare, hover-revealed metadata | No tilt, metadata always visible, press feedback |
| Rails | Arrow controls on hover | Native scroll-snap with momentum |
| Filters | Always-visible inline panel | Single button → drag-to-dismiss bottom sheet |
| Overlays | Centred dialogs that scale in | Bottom sheets with a drag handle |
| Cursor | Custom two-part cursor with contextual labels | Not mounted at all |
| Effects | Full aurora blur radius | Reduced blur radius (mobile GPU cost) |

Every heavy effect is gated behind `useRichMotion()` — precise pointer **and** no
`prefers-reduced-motion`. Touch devices attach zero pointer listeners for tilt,
magnetics, spotlight or cursor.

---

## Architecture notes

**Data layer.** Components only ever see a normalised `Game` shape, never a raw
provider payload. `src/lib/games/source.ts` walks the provider chain; each
provider in `src/lib/games/providers/` implements the same interface and returns
`null` rather than throwing when it can't help. Adding a fourth backend means
writing one file and appending it to the chain — no component changes.

**Providers are merged, not just chained.** When IGDB reports that a title has
a Steam listing (via `external_games`), the record is enriched with Steam's
system requirements — data IGDB does not carry. The base
record wins every contested field; the merge only fills gaps and adds what
Steam uniquely has, and a failed lookup returns the original untouched.

**Posters degrade, they don't break.** Steam's portrait library capsule is a
proper 600x900 poster but 404s for a minority of apps, so `GameCover` tries it
first and swaps to the guaranteed 16:9 header on a load error, then to
generated art keyed off the slug. No grey boxes, no broken images.

**Release dates are never invented.** Providers distinguish an exact day from a
window ("Q4 2026") from genuinely unknown. Steam publishes dates as localised
human strings and IGDB stores a precision category alongside each date; both are
parsed so a quarter is shown as a quarter, not silently rounded to a day. The
release calendar groups exact dates by month, windows under their own heading,
and undated titles last.

**No data source, no page.** There is no bundled catalogue to fall back on. If
every configured provider fails on a given request, that request's data is
labelled `"unavailable"` and the page shows an honest outage notice rather than
inventing games to display. Successful requests carry a provider attribution
line instead.

**Firebase never blocks a render.** Config is validated up front and every accessor
short-circuits on the server. With no config the app reports `enabled: false` and
auth screens explain themselves rather than throwing.

**One watchlist subscription.** A single Firestore listener at the provider level
serves every card on a page, rather than one listener per card. Toggles are
optimistic and roll back on failure.

**Accessibility.** Skip link, focus-visible rings, `aria-live` toasts, keyboard-driven
palette and lightbox, trapped/restored dialog focus, 44px minimum touch targets,
pinch-zoom never disabled, and `prefers-reduced-motion` honoured both globally and
per-component (components swap to a static presentation rather than running the
same animation instantly).

**Quality fortress.** Every push and pull request runs type, lint, provider-contract,
production-build, Chromium, responsive, keyboard, image, canonical-link and Axe
accessibility checks. Failed browser runs preserve their trace, screenshot and video
for diagnosis. The dependency gate blocks high and critical advisories without
silently forcing unsafe major-version downgrades.

---

## Scripts

```bash
npm run dev         # development server
npm run build       # production build
npm run start       # serve the production build
npm run preview     # build for Cloudflare and serve locally in the Workers runtime
npm run deploy      # build for Cloudflare and deploy
npm run check:types # TypeScript without emitting files
npm run lint        # eslint
npm run check:data  # self-checks for date parsing, slug round-trips, platform mapping, Firestore value encoding
npm run quality:static  # types + lint + provider/domain contracts
npm run quality:runtime # audit a production server at http://127.0.0.1:3137
npm run test:e2e        # 24 Chromium, responsive, keyboard and Axe checks
npm run audit:security  # fail on high or critical dependency advisories
```

`check:data` exercises the pure logic in the data layer — Steam's human-readable
date parsing, provider slug round-trips, platform vocabulary normalisation and
IGDB image resizing. These decide what date a user is shown and which provider
owns a URL, so they are pinned down rather than assumed.

For the runtime audit, build and start the site on port `3137` first. Set
`QUALITY_BASE_URL` to target another deployment, and `QUALITY_REQUIRE_PROVIDER=1`
when IGDB and storefront connectivity must be live rather than explicitly degraded.

---

Game data from [IGDB](https://www.igdb.com) and the
[Steam](https://store.steampowered.com) storefront. Not affiliated with any
publisher or platform holder.
