import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  Building2,
  CalendarDays,
  Clapperboard,
  Cpu,
  Eye,
  Flame,
  Gamepad2,
  Gauge,
  Images,
  Languages,
  Layers,
  MonitorCog,
  ShieldCheck,
  Tag,
  Timer,
  Users,
} from "lucide-react";
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
import { Container, Section, SectionHeading } from "@/components/ui/SectionHeading";
import { DataSourceNotice, SourceAttribution } from "@/components/ui/DataSourceNotice";
import { Collapsible } from "@/components/ui/Collapsible";
import { Reveal } from "@/components/motion/Reveal";
import { getGame, getRelated, isDegraded } from "@/lib/games/source";
import { sizedImage } from "@/lib/games/image";
import { GameCollectionShowcase } from "@/components/game/GameCollectionShowcase";
import { GameEditorialOverview } from "@/components/game/GameDetailEditorial";
import { GameDetailDock, type DetailSectionLink } from "@/components/game/GameDetailDock";
import { GameHero } from "@/components/game/detail/GameHero";
import { GameBento, type BentoData } from "@/components/game/detail/GameBento";
import { GameLiveProvider } from "@/components/game/detail/live";
import { LatestNews, LiveNowStrip } from "@/components/game/detail/LiveSections";
import { ReleaseDates } from "@/components/game/detail/ReleaseDates";
import { ReviewWatch } from "@/components/game/detail/ReviewWatch";
import { Elsewhere, elsewhereLinks } from "@/components/game/detail/Elsewhere";
import { GAME_THEME_CLASS, gameTheme, gameThemeStyle } from "@/components/game/detail/theme";
import { delayCount, localRelease, visitorRegion } from "@/components/game/detail/release";
import {
  compactNumber,
  daysUntil,
  formatDate,
  isUnreleased,
  playtimeLabel,
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
  // fast-moving numbers are fetched client-side, by GameLiveProvider.
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

  // Screenshots first (they show the game running), then key art. Deduped
  // because some providers list the same asset in both collections.
  const media = [...new Set([...game.screenshots, ...game.artworks])];
  const hasCollection = Boolean(
    game.parentGame || game.series.length || game.franchises.length || game.dlcs.length ||
    game.expansions.length || game.standaloneExpansions.length || game.editions.length ||
    game.bundles.length || game.remakes.length || game.remasters.length || game.ports.length,
  );
  /**
   * Whether the "Themes & modes" block has anything to say.
   *
   * Themes and game modes are what it leads with; tags are the fallback when
   * IGDB has neither; keywords render as their own sub-list. Any one of them is
   * enough — and `hasDetails` has to agree, or the dock offers a "Game details"
   * link to a section that renders nothing.
   */
  const hasThemeContent = Boolean(
    game.themes.length || game.gameModes.length || game.tags.length || game.keywords.length,
  );
  const hasDetails = Boolean(
    game.characters.length || game.companies.length || game.platformDetails.length ||
    hasThemeContent || game.requirements.length,
  );
  const changes = game.releaseChanges ?? [];
  const hasReleaseDates = game.releases.length > 1 || changes.length > 0;
  const hasElsewhere = elsewhereLinks(game).length > 0 || game.websites.some((site) => site.kind !== "official");

  const sections: DetailSectionLink[] = [
    { id: "glance", label: "At a glance" },
    ...(game.description ? [{ id: "overview", label: "Overview" }] : []),
    ...(game.trailers.length || media.length ? [{ id: "media-archive", label: "Media" }] : []),
    ...(hasReleaseDates ? [{ id: "release-dates", label: "Release dates" }] : []),
    ...(hasCollection ? [{ id: "collection", label: "Universe & content" }] : []),
    ...(hasDetails ? [{ id: "details", label: "Game details" }] : []),
    ...(hasElsewhere ? [{ id: "elsewhere", label: "Elsewhere" }] : []),
    { id: "reviews", label: "Reviews" },
  ];

  const bento: BentoData = {
    name: game.name,
    critic: {
      score: game.metacritic,
      label: criticLabel,
      caption: source === "steam" ? "Metacritic" : "IGDB critic aggregate",
    },
    userRating: game.rating > 0 ? { rating: game.rating, count: game.ratingsCount } : null,
    hasSteam,
    canHaveGamePass: Boolean(game.externalIds?.microsoft),
    timeToBeat: game.timeToBeat ?? null,
    howLongToBeatUrl: game.links?.howLongToBeat ?? null,
    hype: game.hypeIndex ?? null,
    platforms: game.parentPlatforms,
    release: {
      label: local.date ? formatDate(local.date) : game.releaseWindow ?? "To be announced",
      sublabel: local.date ? relativeRelease(local.date) : game.releaseWindow ? "Release window" : null,
      region: local.region,
      delays,
      upcoming,
    },
    stores: game.stores,
  };

  const jsonLd = videoGameJsonLd(game);

  return (
    <div style={gameThemeStyle(theme)} className={GAME_THEME_CLASS}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <GameLiveProvider
        request={{
          id: game.id,
          steam: game.steamAppId,
          twitch: game.externalIds?.twitch ?? null,
          microsoft: game.externalIds?.microsoft ?? null,
          name: game.name,
        }}
      >
        <GameHero game={game} local={local} delays={delays} showCountdown={showCountdown} criticLabel={criticLabel} />

        <GameDetailDock gameName={game.name} sections={sections} />

        <div className="relative">
          {/* The cover's colour carries on past the hero as a faint ambient wash. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(ellipse_at_50%_0%,var(--game-glow),transparent_70%)] opacity-40" />
          <Container className="space-y-3 pt-6 sm:pt-8">
            <section id="glance" aria-label="At a glance" className="scroll-mt-32">
              <h2 className="sr-only">At a glance</h2>
              <GameBento data={bento} />
            </section>
            <DataSourceNotice source={source} degraded={isDegraded(source)} />
            <SourceAttribution source={source} />
          </Container>
        </div>

        <Container className="grid gap-10 pb-8 pt-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-14 lg:pb-12 lg:pt-10">
          <div className="min-w-0 space-y-14">
            {reviewWatch && local.date && (
              <ReviewWatch
                launchDate={local.date}
                critic={{ score: game.metacritic, label: criticLabel }}
                links={{ openCritic: game.links?.openCritic ?? null, metacritic: game.links?.metacritic ?? game.metacriticUrl }}
                hasSteam={hasSteam}
              />
            )}

            {game.description && <GameEditorialOverview game={game} />}

            <LiveNowStrip />

            {(game.trailers.length > 0 || media.length > 0) && (
              <section id="media-archive" className="space-y-12 scroll-mt-32">
                <Reveal className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--game-accent)]"><Clapperboard size={13} /> Cinematic archive</p>
                    <h2 className="text-3xl font-black sm:text-4xl">See the world in motion</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">Official footage, in-game captures, and production artwork—collected into one immersive gallery.</p>
                  </div>
                  <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-fg/[0.03] px-3 py-1.5 text-xs text-faint"><Images size={13} /> {game.trailers.length + media.length} assets</span>
                </Reveal>

                {game.trailers.length > 0 && (
                  <div id="trailers">
                    <Reveal><h3 className="mb-5 text-xl font-bold sm:text-2xl">Official trailers</h3></Reveal>
                    <MediaGallery items={game.trailers.map((trailer) => ({ kind: "trailer" as const, trailer }))} gameName={game.name} />
                  </div>
                )}

                {media.length > 0 && (
                  <div id="media">
                    <Reveal><h3 className="mb-5 text-xl font-bold sm:text-2xl">{game.artworks.length > 0 ? "Screenshots & key art" : "Screenshots"}</h3></Reveal>
                    <MediaGallery items={media.map((src) => ({ kind: "image" as const, src }))} gameName={game.name} variant="cinematic" />
                  </div>
                )}
              </section>
            )}

            <ReleaseDates releases={game.releases} changes={changes} visitorRegion={region} countryName={local.countryName} />

            <GameCollectionShowcase game={game} />

            <LatestNews expected={hasSteam} />

            {hasDetails && <section id="details" className="space-y-14 scroll-mt-32">
              <Reveal>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--game-accent)]">Production dossier</p>
                <h2 className="text-3xl font-black sm:text-4xl">The complete game record</h2>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">Cast, creators, hardware, and the details that define how this game plays.</p>
              </Reveal>

              {game.characters.length > 0 && <div><Reveal><h3 className="mb-5 text-2xl font-bold sm:text-3xl">Characters</h3></Reveal><CharacterRail characters={game.characters} /></div>}

              {game.companies.length > 0 && <Reveal><h3 className="mb-5 text-2xl font-bold sm:text-3xl">Who made it</h3><CompanyGrid companies={game.companies} />{game.engines.length > 0 && <div className="mt-5"><h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">Built with</h4><EngineRow engines={game.engines} /></div>}</Reveal>}

              {game.platformDetails.length > 0 && <Reveal><h3 className="mb-5 text-2xl font-bold sm:text-3xl">Platforms</h3><PlatformGrid platforms={game.platformDetails} /></Reveal>}

              {/* Gated on what this block actually renders. It previously tested
                  `tags`/`keywords` while rendering `themes`/`gameModes`, so a game
                  with themes but no tags showed nothing, and a game with only
                  keywords rendered an empty row above the tag list. */}
              {hasThemeContent && <Reveal><h3 className="mb-4 text-2xl font-bold sm:text-3xl">Themes & modes</h3>
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
                    {game.themes.length === 0 &&
                      game.gameModes.length === 0 &&
                      game.tags.map((tag) => <Badge key={tag.id}>{tag.name}</Badge>)}
                  </div>
                )}

                {game.keywords.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
                      Tags
                    </h3>
                    <ul className="flex flex-wrap gap-2">
                      {game.keywords.map((keyword) => (
                        <li key={keyword.id}>
                          <Chip href={`/browse?search=${encodeURIComponent(keyword.name)}`}>
                            {keyword.name}
                          </Chip>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Reveal>}

              {/* Bulky, and relevant to a minority of readers — so it sits at the
                  end of the article, closed, rather than between the media and the
                  conversation about the game. */}
              {game.requirements.length > 0 && <Requirements game={game} />}
            </section>}

            <Elsewhere game={game} />

            <section id="reviews" className="scroll-mt-32">
              <ReviewSection game={game} />
            </section>
          </div>

          <GameSidebar game={game} />
        </Container>

        {related.length > 0 && (
          <Section className="border-t border-line pt-12">
            <Container>
              <SectionHeading
                eyebrow="More like this"
                title="Related games"
                // Without genres the link would be a bare `?genres=`, which browses
                // nothing — so the CTA is dropped rather than pointing at an empty
                // filter.
                href={
                  game.genres.length > 0
                    ? `/browse?genres=${game.genres.map((g) => g.slug).join(",")}`
                    : undefined
                }
                linkLabel="Browse genre"
              />
            </Container>
            <div className="mt-7">
              <GameRail games={related} />
            </div>
          </Section>
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
 * The reference column. Scores, platforms, stores and outbound links moved
 * into the bento and "Elsewhere"; what stays is the fact sheet people scan.
 */
function GameSidebar({ game }: { game: GameDetail }) {
  const franchises = game.franchises.length > 0 ? game.franchises : game.series;
  const facts: { label: string; value: React.ReactNode; icon: React.ReactNode }[] = [
    {
      label: "Released",
      value: releaseLabelLong(game, "To be announced"),
      icon: <CalendarDays size={14} />,
    },
    ...(game.developers.length
      ? [
          {
            label: game.developers.length > 1 ? "Developers" : "Developer",
            value: <StudioLinks studios={game.developers} />,
            icon: <Building2 size={14} />,
          },
        ]
      : []),
    ...(game.publishers.length
      ? [
          {
            label: game.publishers.length > 1 ? "Publishers" : "Publisher",
            value: <StudioLinks studios={game.publishers} />,
            icon: <Users size={14} />,
          },
        ]
      : []),
    ...(game.supportingStudios.length
      ? [
          {
            label: "Additional work",
            value: game.supportingStudios.map((s) => s.name).join(", "),
            icon: <Building2 size={14} />,
          },
        ]
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
            icon: <Layers size={14} />,
          },
        ]
      : []),
    ...(game.engines.length
      ? [
          {
            label: game.engines.length > 1 ? "Engines" : "Engine",
            value: game.engines.map((e) => e.name).join(", "),
            icon: <Cpu size={14} />,
          },
        ]
      : []),
    ...(game.playerPerspectives.length
      ? [
          {
            label: "Perspective",
            value: game.playerPerspectives.map((p) => p.name).join(", "),
            icon: <Eye size={14} />,
          },
        ]
      : []),
    ...(game.gameModes.length
      ? [
          {
            label: "Modes",
            value: game.gameModes.map((m) => m.name).join(", "),
            icon: <Gamepad2 size={14} />,
          },
        ]
      : []),
    ...(game.multiplayerModes
      ? [
          {
            label: "Multiplayer",
            value: multiplayerSummary(game.multiplayerModes),
            icon: <Users size={14} />,
          },
        ]
      : []),
    // The bento's "Time to beat" tile is the better answer when IGDB has it;
    // RAWG-style median playtime is the fallback for records without one.
    ...(game.playtime && !game.timeToBeat
      ? [
          {
            label: "Typical playtime",
            value: playtimeLabel(game.playtime),
            icon: <Timer size={14} />,
          },
        ]
      : []),
    // Ratings get their own panel below when IGDB has content descriptors,
    // since the descriptors are the half people actually want. This row is the
    // fallback for records that only carry the bare rating.
    ...(game.ageRatings.length === 0 && game.esrb
      ? [{ label: "Age rating", value: game.esrb, icon: <ShieldCheck size={14} /> }]
      : []),
    ...(game.languages.length
      ? [
          {
            label: "Languages",
            value: `${game.languages.slice(0, 6).join(", ")}${
              game.languages.length > 6 ? ` +${game.languages.length - 6} more` : ""
            }`,
            icon: <Languages size={14} />,
          },
        ]
      : []),
    ...(game.alternativeNames.length
      ? [
          {
            label: "Also known as",
            value: game.alternativeNames.slice(0, 4).join(", "),
            icon: <Tag size={14} />,
          },
        ]
      : []),
    // `popScore` is deliberately not shown: IGDB returns it as a normalised
    // float far below 1, which is meaningful for ordering shelves and search
    // but answers no question a reader would ask. It ranks, it doesn't display.
    ...(game.added
      ? [
          {
            label: "In player libraries",
            value: compactNumber(game.added),
            icon: <Gauge size={14} />,
          },
        ]
      : []),
    ...(game.hypes > 0
      ? [
          {
            label: "Anticipating this",
            value: compactNumber(game.hypes),
            icon: <Flame size={14} />,
          },
        ]
      : []),
  ];

  return (
    <aside className="space-y-5 lg:sticky lg:top-32 lg:self-start">
      <Reveal className="glass rounded-3xl p-5">
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
          Details
        </h2>
        <dl className="space-y-3.5">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="flex gap-3 text-[11px] uppercase tracking-[0.08em] text-faint">
                <span className="mt-0.5 shrink-0" aria-hidden>{fact.icon}</span>
                <span>{fact.label}</span>
              </dt>
              <dd className="mt-0.5 min-w-0 pl-7 text-sm leading-snug">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </Reveal>

      {game.ageRatings.length > 0 && (
        <Reveal delay={0.06} className="glass rounded-3xl p-5">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
            {game.ageRatings.length > 1 ? "Age ratings" : "Age rating"}
          </h2>
          <AgeRatingPanel ratings={game.ageRatings} />
        </Reveal>
      )}

      {game.genres.length > 0 && (
        <Reveal delay={0.12} className="glass rounded-3xl p-5">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
            Genres
          </h2>
          <div className="flex flex-wrap gap-2">
            {game.genres.map((genre) => (
              <Chip key={genre.id} href={`/browse?genres=${genre.slug}`}>
                {genre.name}
              </Chip>
            ))}
          </div>
        </Reveal>
      )}
    </aside>
  );
}

function Requirements({ game }: { game: GameDetail }) {
  const platforms = game.requirements.map((req) => req.platform).join(", ");

  return (
    <Reveal>
      <Collapsible
        title="System requirements"
        subtitle={platforms}
        icon={<MonitorCog size={17} />}
      >
        <div className="space-y-4">
          {game.requirements.map((req) => (
            <div key={req.platform} className="overflow-hidden rounded-xl border border-line">
              <h3 className="border-b border-line bg-fg/[0.03] px-4 py-3 text-sm font-semibold">
                {req.platform}
              </h3>
              <div className="grid gap-px bg-line sm:grid-cols-2">
                {req.minimum && (
                  <div className="bg-bg p-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
                      Minimum
                    </p>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
                      {req.minimum}
                    </p>
                  </div>
                )}
                {req.recommended && (
                  <div className="bg-bg p-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
                      Recommended
                    </p>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
                      {req.recommended}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Collapsible>
    </Reveal>
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
