import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ExternalLink, Layers } from "lucide-react";
import { GameRail } from "@/components/game/GameRail";
import {
  AgeRatingPanel,
  CharacterRail,
  CompanyGrid,
  EngineRow,
  PlatformGrid,
} from "@/components/game/GameEntities";
import { MediaGallery } from "@/components/game/MediaGallery";
import { ReviewSection } from "@/components/game/ReviewSection";
import { Badge, Chip } from "@/components/ui/Badge";
import { Container } from "@/components/ui/SectionHeading";
import { DataSourceNotice, SourceAttribution } from "@/components/ui/DataSourceNotice";
import { getGame, getRelated, isDegraded } from "@/lib/games/source";
import { sizedImage } from "@/lib/games/image";
import { GameCollectionShowcase } from "@/components/game/GameCollectionShowcase";
import { GameEditorialOverview } from "@/components/game/GameDetailEditorial";
import { GameDetailDock, type DetailSectionLink } from "@/components/game/GameDetailDock";
import { AtAGlance, type GlanceData } from "@/components/game/detail/AtAGlance";
import { DetailHeading, DetailSection } from "@/components/game/detail/DetailSection";
import { Disclosure } from "@/components/game/detail/Disclosure";
import { Elsewhere } from "@/components/game/detail/Elsewhere";
import { GameHero } from "@/components/game/detail/GameHero";
import { LengthSection } from "@/components/game/detail/LengthSection";
import { GameLiveProvider } from "@/components/game/detail/live";
import { LiveOnTwitch } from "@/components/game/detail/LiveSections";
import { PcSection } from "@/components/game/detail/PcSection";
import { LatestUpdates, OpinionTrends, ScoresSummary } from "@/components/game/detail/PlayersThink";
import { PriceSection } from "@/components/game/detail/PriceSection";
import { ReleaseDates } from "@/components/game/detail/ReleaseDates";
import { ReviewWatch } from "@/components/game/detail/ReviewWatch";
import { PlayersCard } from "@/components/game/detail/StatsSection";
import { describeGame, storyHours } from "@/components/game/detail/summary";
import { GAME_THEME_CLASS, gameTheme, gameThemeStyle } from "@/components/game/detail/theme";
import { delayCount, localRelease, visitorRegion } from "@/components/game/detail/release";
import {
  daysUntil,
  formatDate,
  isUnreleased,
  releaseLabelLong,
  relativeRelease,
} from "@/lib/utils/format";
import type { GameDetail } from "@/lib/games/types";

// The IGDB query is cached independently. Rendering the shell on demand avoids
// publishing a day-long Steam fallback when IGDB is unreachable during build.
export const revalidate = 0;

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Reviews are "news" from two weeks before launch until two weeks after. */
const REVIEW_WATCH_DAYS = 14;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const result = await getGame(slug);
  if (!result) return { title: "Game not found" };

  const game = result.data;
  const released = releaseLabelLong(game, "Release date to be announced");
  const description =
    game.description?.slice(0, 155).trim() ||
    `${game.name} — ${released}. Platforms, critic scores, screenshots and release countdown.`;
  const image = sizedImage(game.image, 1200);

  return {
    title: game.name,
    description,
    openGraph: {
      title: game.name,
      description,
      type: "article",
      images: image ? [{ url: image, width: 1200, height: 630, alt: game.name }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: game.name,
      description,
      images: image ? [image] : undefined,
    },
  };
}

/**
 * The visitor's ISO country, from the header Cloudflare adds to every request
 * in production. Absent locally, so `?country=XX` stands in — in development
 * only, so production can never be told to pretend.
 */
async function visitorCountry(searchParams: SearchParams): Promise<string | null> {
  let code = (await headers()).get("cf-ipcountry");
  if (process.env.NODE_ENV === "development") {
    const override = (await searchParams).country;
    if (typeof override === "string") code = override;
  }
  const normalised = code?.trim().toUpperCase() ?? "";
  // XX = unknown, T1 = Tor: neither is a place with a release date.
  return /^[A-Z]{2}$/.test(normalised) && normalised !== "XX" && normalised !== "T1" ? normalised : null;
}

export default async function GamePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { slug } = await params;
  const result = await getGame(slug);
  if (!result) notFound();

  const { data: game, source } = result;
  // Pass the source so the rail comes from the same catalogue as the page.
  const [related, country] = await Promise.all([getRelated(game, source, 12), visitorCountry(searchParams)]);

  // Everything here is server-rendered from the cached game record plus the
  // reader's country (a request header, so no per-user data); only the
  // fast-moving numbers are fetched client-side, by GameLiveProvider and the
  // section components.
  const theme = gameTheme(game.palette);
  const local = localRelease(game, country);
  const region = visitorRegion(game.releases, country);
  const delays = delayCount(game.releaseChanges);
  const daysToLocal = local.date ? daysUntil(local.date) : null;
  const upcoming = daysToLocal !== null ? daysToLocal > 0 : isUnreleased(game);
  // Today counts: the countdown turns into "Out now" (and celebrates in the
  // first hour) rather than vanishing on launch day.
  const showCountdown = daysToLocal !== null && daysToLocal >= 0;
  const reviewWatch = daysToLocal !== null && Math.abs(daysToLocal) <= REVIEW_WATCH_DAYS;
  const criticLabel = source === "steam" ? "Metascore" : "Critic score";
  const hasSteam = Boolean(game.steamAppId);
  const twitchId = game.externalIds?.twitch ?? null;

  // Screenshots first (they show the game running), then key art. Deduped
  // because some providers list the same asset in both collections.
  const media = [...new Set([...game.screenshots, ...game.artworks])];
  const hasMedia = game.trailers.length > 0 || media.length > 0;
  const hasCollection = Boolean(
    game.parentGame || game.series.length || game.franchises.length || game.dlcs.length ||
    game.expansions.length || game.standaloneExpansions.length || game.editions.length ||
    game.bundles.length || game.remakes.length || game.remasters.length || game.ports.length,
  );
  /**
   * Whether "Themes and modes" has anything to say: themes and game modes
   * lead, tags are the fallback when IGDB has neither, keywords render as
   * their own sub-list. Any one of them is enough.
   */
  const hasThemeContent = Boolean(
    game.themes.length || game.gameModes.length || game.tags.length || game.keywords.length,
  );
  const hasDetails = Boolean(
    game.characters.length || game.companies.length || game.platformDetails.length || hasThemeContent,
  );
  const changes = game.releaseChanges ?? [];
  const ids = { id: game.id, steam: game.steamAppId, microsoft: game.externalIds?.microsoft ?? null };
  // Local prices come from Steam and the Microsoft Store; without a listing
  // on either there is no price to show (the stores still are).
  const marketIds = hasSteam || ids.microsoft ? ids : null;
  const mainHours = storyHours(game.timeToBeat);
  // Main + extras stands in only when there's no main-story figure at all (not when it was ruled out as endless).
  const lengthHours = mainHours ?? (game.timeToBeat?.hastily ? null : game.timeToBeat?.normally ?? null);
  const hasLength = Boolean(lengthHours || game.timeToBeat?.completely || game.playtime > 0);
  // Players and reviews over time are about a game people can already play;
  // Twitch can have an audience before launch.
  const hasPlayers = (hasSteam && !upcoming) || Boolean(twitchId);
  const hasPc = hasSteam || game.requirements.length > 0;
  const hasMore = hasCollection || related.length > 0;
  const moreTitle = hasCollection ? "More from this series" : "More like this";

  // Nav labels are the section titles, word for word.
  const sections: DetailSectionLink[] = [
    { id: "overview", label: "Overview" },
    ...(hasMedia ? [{ id: "watch", label: "Watch" }] : []),
    { id: "prices", label: "Where to play & price" },
    ...(hasLength ? [{ id: "length", label: "How long" }] : []),
    { id: "reviews", label: "What players think" },
    ...(hasPc ? [{ id: "pc", label: "For PC players" }] : []),
    ...(hasMore ? [{ id: "more", label: moreTitle }] : []),
  ];

  const compareSuggestions = related.slice(0, 8).map((item) => ({
    slug: item.slug,
    name: item.name,
    image: item.image,
    year: item.released?.slice(0, 4) ?? item.releaseWindow ?? null,
  }));

  const criticCaption =
    source === "steam"
      ? "Metacritic"
      : game.criticCount
        ? `${game.criticCount.toLocaleString("en-US")} critic ${game.criticCount === 1 ? "review" : "reviews"}`
        : "Critic average";

  const glance: GlanceData = {
    descriptor: describeGame(game, upcoming),
    critic: game.metacritic !== null ? { score: game.metacritic, label: criticCaption } : null,
    userRating: game.rating > 0 ? { rating: game.rating, count: game.ratingsCount } : null,
    hasSteam,
    release: {
      label: local.date ? formatDate(local.date) : game.releaseWindow ?? "To be announced",
      relative: local.date ? relativeRelease(local.date) : null,
      upcoming,
      delays,
    },
    hours: mainHours
      ? { value: mainHours, kind: "main" }
      : lengthHours
        ? { value: lengthHours, kind: "extras" }
        : game.playtime > 0 && !game.timeToBeat?.hastily
          ? { value: game.playtime, kind: "typical" }
          : null,
    hype: upcoming && game.hypeIndex ? { score: game.hypeIndex.score, follows: game.hypes } : null,
    market: marketIds,
    platforms: game.parentPlatforms,
  };

  const detailCounts = [
    game.companies.length ? `${game.companies.length} ${game.companies.length === 1 ? "company" : "companies"}` : null,
    game.platformDetails.length ? `${game.platformDetails.length} ${game.platformDetails.length === 1 ? "platform" : "platforms"}` : null,
    game.characters.length ? `${game.characters.length} ${game.characters.length === 1 ? "character" : "characters"}` : null,
    game.keywords.length ? `${game.keywords.length} tags` : null,
  ].filter(Boolean).join(" · ");

  const jsonLd = videoGameJsonLd(game);

  return (
    <div style={gameThemeStyle(theme)} className={GAME_THEME_CLASS}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <GameLiveProvider request={{ id: game.id, steam: game.steamAppId, twitch: twitchId, microsoft: ids.microsoft, name: game.name }}>
        <GameHero
          game={game}
          local={local}
          delays={delays}
          showCountdown={showCountdown}
          criticLabel={criticLabel}
          compareSuggestions={compareSuggestions}
        />

        <GameDetailDock game={game} sections={sections} compareSuggestions={compareSuggestions} />

        <div className="relative">
          {/* The cover's colour carries on past the hero as a faint ambient wash. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(ellipse_at_50%_0%,var(--game-glow),transparent_70%)] opacity-40" />
          <Container className="space-y-14 pb-16 pt-7 sm:space-y-16 sm:pt-9 lg:space-y-20">
            {/* Overview: what it is, is it good, how long, what it costs — then the story and the fact sheet. */}
            <section id="overview" aria-labelledby="overview-title" className="scroll-mt-36">
              <h2 id="overview-title" className="sr-only">Overview</h2>
              <AtAGlance data={glance} />
              <div className="mt-3 space-y-1">
                <DataSourceNotice source={source} degraded={isDegraded(source)} />
                <SourceAttribution source={source} />
              </div>

              {reviewWatch && local.date && (
                <div className="mt-10">
                  <ReviewWatch
                    launchDate={local.date}
                    critic={{ score: game.metacritic, label: criticLabel }}
                    links={{ openCritic: game.links?.openCritic ?? null, metacritic: game.links?.metacritic ?? game.metacriticUrl }}
                    hasSteam={hasSteam}
                  />
                </div>
              )}

              {/*
                The fact sheet is a sticky right rail beside About *and* Watch.
                When it sat beside About alone, a collapsed "Credits" left the
                left column far shorter than the rail, opening a large empty
                gap above Watch. Phones keep the order About → facts → Watch.
              */}
              <div className="mt-10 grid gap-x-14 gap-y-10 sm:mt-12 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-y-16">
                <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
                  {game.description && <GameEditorialOverview game={game} />}
                  {hasDetails && (
                    <Disclosure icon={<Layers size={17} />} title="Credits, platforms and tags" subtitle={detailCounts || undefined}>
                      <GameDetails game={game} hasThemeContent={hasThemeContent} />
                    </Disclosure>
                  )}
                </div>
                <div className="lg:sticky lg:top-36 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
                  <GameSidebar game={game} />
                </div>
                <div className="min-w-0 lg:col-start-1 lg:row-start-2">
                  {hasMedia ? (
                    <DetailSection id="watch" title="Watch">
                      <div className="space-y-10">
                        {game.trailers.length > 0 && (
                          <div id="trailers">
                            <h3 className="mb-4 text-[17px] font-semibold text-text">Trailers</h3>
                            <MediaGallery items={game.trailers.map((trailer) => ({ kind: "trailer" as const, trailer }))} gameName={game.name} />
                          </div>
                        )}
                        {media.length > 0 && (
                          <div id="screenshots">
                            <h3 className="mb-4 text-[17px] font-semibold text-text">
                              {game.artworks.length > 0 ? "Screenshots and key art" : "Screenshots"}
                            </h3>
                            <MediaGallery items={media.map((src) => ({ kind: "image" as const, src }))} gameName={game.name} variant="cinematic" />
                          </div>
                        )}
                        <LiveOnTwitch />
                      </div>
                    </DetailSection>
                  ) : (
                    <LiveOnTwitch standalone />
                  )}
                </div>
              </div>
            </section>

            <PriceSection
              ids={marketIds}
              name={game.name}
              upcoming={upcoming}
              stores={game.stores}
              mainHours={mainHours}
              releaseDates={<ReleaseDates releases={game.releases} changes={changes} visitorRegion={region} countryName={local.countryName} />}
            />

            {hasLength && (
              <DetailSection id="length" title="How long">
                <LengthSection
                  ttb={game.timeToBeat ?? null}
                  mainHours={mainHours}
                  typicalHours={game.playtime > 0 ? game.playtime : null}
                  hltbUrl={game.links?.howLongToBeat ?? null}
                  market={marketIds}
                />
              </DetailSection>
            )}

            <DetailSection id="reviews" title="What players think">
              <div className="space-y-4">
                <ScoresSummary
                  data={{
                    critic: { score: game.metacritic, label: criticLabel, caption: criticCaption },
                    userRating: game.rating > 0 ? { rating: game.rating, count: game.ratingsCount } : null,
                    hasSteam,
                    links: { openCritic: game.links?.openCritic ?? null, metacritic: game.links?.metacritic ?? game.metacriticUrl },
                  }}
                />
                {!upcoming && <OpinionTrends ids={ids} launch={local.date} />}
                {hasPlayers && <PlayersCard ids={ids} twitchId={twitchId} />}
                {hasSteam && (
                  <div className="pt-6">
                    <LatestUpdates ids={ids} expected={!upcoming} />
                  </div>
                )}
                <div className="pt-6">
                  <ReviewSection game={game} />
                </div>
              </div>
            </DetailSection>

            {hasPc && (
              <DetailSection id="pc" title="For PC players">
                <PcSection ids={ids} rawRequirements={game.requirements} />
              </DetailSection>
            )}
          </Container>
        </div>

        {hasMore && (
          <section id="more" aria-labelledby="more-title" className="scroll-mt-36 border-t border-line pb-6 pt-12 sm:pt-16">
            <Container>
              <DetailHeading titleId="more-title" title={moreTitle} />
              {hasCollection && (
                <div className="mt-6 sm:mt-7">
                  <GameCollectionShowcase game={game} />
                </div>
              )}
            </Container>
            {related.length > 0 && (
              <div className={hasCollection ? "mt-14" : "mt-6 sm:mt-7"}>
                <Container>
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <h3 className="text-[17px] font-semibold text-text">{hasCollection ? "More like this" : "Similar games"}</h3>
                    {/* Without genres the link would browse nothing, so it's dropped. */}
                    {game.genres.length > 0 && (
                      <Link
                        href={`/browse?genres=${game.genres.map((g) => g.slug).join(",")}`}
                        className="text-[13px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))] hover:underline"
                      >
                        Browse genre
                      </Link>
                    )}
                  </div>
                </Container>
                <GameRail games={related} />
              </div>
            )}
          </section>
        )}
      </GameLiveProvider>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function StudioLinks({ studios }: { studios: GameDetail["developers"] }) {
  return (
    <span className="flex flex-wrap gap-x-1.5 gap-y-1">
      {studios.map((studio, index) => (
        <span key={studio.id}>
          <Link
            href={`/studio/${studio.slug}`}
            className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-[var(--game-accent)]"
          >
            {studio.name}
          </Link>
          {index < studios.length - 1 && ","}
        </span>
      ))}
    </span>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Official site";
  }
}

/** Turns IGDB's multiplayer booleans into a phrase worth reading. */
function multiplayerSummary(modes: NonNullable<GameDetail["multiplayerModes"]>): string {
  const parts: string[] = [];
  if (modes.onlineCoop) parts.push("Online co-op");
  if (modes.offlineCoop) parts.push("Local co-op");
  if (modes.lanCoop) parts.push("LAN");
  if (modes.splitScreen) parts.push("Split screen");
  if (modes.campaignCoop) parts.push("Co-op campaign");
  if (modes.dropIn) parts.push("Drop-in");
  if (modes.onlineMax && modes.onlineMax > 1) parts.push(`Up to ${modes.onlineMax} online`);
  return parts.length > 0 ? parts.join(" · ") : "Single player";
}

/**
 * The fact sheet beside the story: who made it and how it plays. Release
 * date, length, platforms and popularity live in "At a glance" with their
 * explanations, so they aren't repeated here.
 */
function GameSidebar({ game }: { game: GameDetail }) {
  const franchises = game.franchises.length > 0 ? game.franchises : game.series;
  const facts: { label: string; value: React.ReactNode }[] = [
    ...(game.developers.length
      ? [{ label: game.developers.length > 1 ? "Developers" : "Developer", value: <StudioLinks studios={game.developers} /> }]
      : []),
    ...(game.publishers.length
      ? [{ label: game.publishers.length > 1 ? "Publishers" : "Publisher", value: <StudioLinks studios={game.publishers} /> }]
      : []),
    ...(franchises.length
      ? [
          {
            label: franchises.length > 1 ? "Franchises" : "Franchise",
            value: (
              <span className="flex flex-wrap gap-x-1.5">
                {franchises.map((franchise, i) => (
                  <span key={franchise.id}>
                    <Link
                      href={`/franchise/${franchise.slug}`}
                      className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-[var(--game-accent)]"
                    >
                      {franchise.name}
                    </Link>
                    {i < franchises.length - 1 && ","}
                  </span>
                ))}
              </span>
            ),
          },
        ]
      : []),
    ...(game.genres.length
      ? [
          {
            label: game.genres.length > 1 ? "Genres" : "Genre",
            value: (
              <span className="flex flex-wrap gap-x-1.5">
                {game.genres.map((genre, i) => (
                  <span key={genre.id}>
                    <Link href={`/browse?genres=${genre.slug}`} className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-[var(--game-accent)]">
                      {genre.name}
                    </Link>
                    {i < game.genres.length - 1 && ","}
                  </span>
                ))}
              </span>
            ),
          },
        ]
      : []),
    ...(game.playerPerspectives.length ? [{ label: "Perspective", value: game.playerPerspectives.map((p) => p.name).join(", ") }] : []),
    ...(game.gameModes.length ? [{ label: "Modes", value: game.gameModes.map((m) => m.name).join(", ") }] : []),
    ...(game.multiplayerModes ? [{ label: "Multiplayer", value: multiplayerSummary(game.multiplayerModes) }] : []),
    ...(game.engines.length ? [{ label: game.engines.length > 1 ? "Engines" : "Engine", value: game.engines.map((e) => e.name).join(", ") }] : []),
    // Ratings get their own panel below when IGDB has content descriptors.
    ...(game.ageRatings.length === 0 && game.esrb ? [{ label: "Age rating", value: game.esrb }] : []),
    ...(game.languages.length
      ? [
          {
            label: "Languages",
            value: `${game.languages.slice(0, 6).join(", ")}${game.languages.length > 6 ? ` +${game.languages.length - 6} more` : ""}`,
          },
        ]
      : []),
    ...(game.website
      ? [
          {
            label: "Website",
            value: (
              <a
                href={game.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline decoration-line-strong underline-offset-2 transition-colors hover:text-[var(--game-accent)]"
              >
                {hostname(game.website)} <ExternalLink size={11} aria-hidden />
              </a>
            ),
          },
        ]
      : []),
    ...(game.alternativeNames.length ? [{ label: "Also known as", value: game.alternativeNames.slice(0, 4).join(", ") }] : []),
  ];

  return (
    <aside className="min-w-0 space-y-4 lg:sticky lg:top-36 lg:self-start">
      {facts.length > 0 && (
        <div className="glass rounded-3xl p-5">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">Details</h3>
          {/* Two columns of short facts on tablets; one tidy list beside the story on desktop. */}
          <dl className="grid gap-x-6 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-1">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-[12px] text-faint">{fact.label}</dt>
                <dd className="mt-0.5 min-w-0 text-[14px] leading-snug text-text">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {game.ageRatings.length > 0 && (
        <div className="glass rounded-3xl p-5">
          <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
            {game.ageRatings.length > 1 ? "Age ratings" : "Age rating"}
          </h3>
          <AgeRatingPanel ratings={game.ageRatings} />
        </div>
      )}

      <Elsewhere game={game} />
    </aside>
  );
}

/** Credits, platforms and tags: the deep record, behind "Show" in the Overview. */
function GameDetails({ game, hasThemeContent }: { game: GameDetail; hasThemeContent: boolean }) {
  return (
    <div className="space-y-8 pb-1">
      {game.characters.length > 0 && (
        <div>
          <h4 className="mb-3 text-[15px] font-semibold text-text">Characters</h4>
          <CharacterRail characters={game.characters} />
        </div>
      )}

      {game.companies.length > 0 && (
        <div>
          <h4 className="mb-3 text-[15px] font-semibold text-text">Who made it</h4>
          <CompanyGrid companies={game.companies} />
          {game.engines.length > 0 && (
            <div className="mt-4">
              <h5 className="mb-2.5 text-[13px] font-semibold text-muted">Built with</h5>
              <EngineRow engines={game.engines} />
            </div>
          )}
        </div>
      )}

      {game.platformDetails.length > 0 && (
        <div>
          <h4 className="mb-3 text-[15px] font-semibold text-text">Platforms</h4>
          <PlatformGrid platforms={game.platformDetails} />
        </div>
      )}

      {hasThemeContent && (
        <div>
          <h4 className="mb-3 text-[15px] font-semibold text-text">Themes and modes</h4>
          {(game.themes.length > 0 || game.gameModes.length > 0 || game.tags.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {game.themes.map((theme) => (
                <Badge key={`theme-${theme.id}`} tone="brand">
                  {theme.name}
                </Badge>
              ))}
              {game.gameModes.map((mode) => (
                <Badge key={`mode-${mode.id}`}>{mode.name}</Badge>
              ))}
              {game.themes.length === 0 && game.gameModes.length === 0 && game.tags.map((tag) => <Badge key={tag.id}>{tag.name}</Badge>)}
            </div>
          )}
          {game.keywords.length > 0 && (
            <div className="mt-4">
              <h5 className="mb-2.5 text-[13px] font-semibold text-muted">Tags</h5>
              <ul className="flex flex-wrap gap-2">
                {game.keywords.map((keyword) => (
                  <li key={keyword.id}>
                    <Chip href={`/browse?search=${encodeURIComponent(keyword.name)}`}>{keyword.name}</Chip>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Search and assistant-readable identity for the same game record shown above. */
function videoGameJsonLd(game: GameDetail) {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const images = [game.image, ...game.artworks.slice(0, 3), ...game.screenshots.slice(0, 3)]
    .filter((image): image is string => Boolean(image));

  return {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: game.name,
    description: game.description || undefined,
    url: site ? `${site}/game/${game.slug}` : undefined,
    image: images.length > 0 ? images : undefined,
    datePublished: game.released ?? undefined,
    genre: game.genres.map((genre) => genre.name),
    gamePlatform: game.platforms.map((platform) => platform.name),
    playMode: game.gameModes.map((mode) => mode.name),
    developer: game.developers.map((developer) => ({
      "@type": "Organization",
      name: developer.name,
    })),
    publisher: game.publishers.map((publisher) => ({
      "@type": "Organization",
      name: publisher.name,
    })),
    aggregateRating: game.rating > 0 && game.ratingsCount > 0 ? {
      "@type": "AggregateRating",
      ratingValue: game.rating,
      bestRating: 5,
      worstRating: 0,
      ratingCount: game.ratingsCount,
    } : undefined,
    sameAs: [...new Set([game.website, ...game.websites.map((website) => website.url)])]
      .filter((url): url is string => Boolean(url)),
  };
}
