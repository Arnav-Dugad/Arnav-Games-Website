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
5. **Firestore → Rules** → paste [`firestore.rules`](./firestore.rules) and publish
6. **Authentication → Settings → Authorised domains** → add your deployed domain

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
npm run check:data  # self-checks for date parsing, slug round-trips, platform mapping
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
