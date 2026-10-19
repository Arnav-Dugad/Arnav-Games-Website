import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Clapperboard,
  Cpu,
  Eye,
  ExternalLink,
  Flame,
  Gamepad2,
  Gauge,
  Globe,
  Languages,
  Layers,
  Images,
  MonitorCog,
  ShieldCheck,
  Star,
  Tag,
  Timer,
  Users,
} from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { Countdown } from "@/components/game/Countdown";
import { GameRail } from "@/components/game/GameRail";
import { PlatformIcons, PlatformList } from "@/components/game/PlatformIcons";
import { BackdropTrailer } from "@/components/game/BackdropTrailer";
import {
  AgeRatingPanel,
  CharacterRail,
  CompanyGrid,
  EngineRow,
  PlatformGrid,
  ReleaseTable,
  StudioCredit,
} from "@/components/game/GameEntities";
import { MediaGallery } from "@/components/game/MediaGallery";
import { CommunityLinks, StoreLinks } from "@/components/game/StoreLinks";
import { ReviewSection } from "@/components/game/ReviewSection";
import { OwnershipPicker } from "@/components/game/OwnershipPicker";
import { SubscriptionAccessPicker } from "@/components/game/SubscriptionAccessPicker";
import { StatusPicker } from "@/components/game/StatusPicker";
import { WatchButton } from "@/components/game/WatchButton";
import { SaveButton } from "@/components/game/SaveButton";
import { ScorePill, ScoreRing } from "@/components/ui/ScoreRing";
import { Badge, Chip } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Container, Section, SectionHeading } from "@/components/ui/SectionHeading";
import { DataSourceNotice, SourceAttribution } from "@/components/ui/DataSourceNotice";
import { Collapsible } from "@/components/ui/Collapsible";
import { Reveal } from "@/components/motion/Reveal";
import { TextReveal } from "@/components/motion/text";
import { Parallax } from "@/components/motion/effects";
import { Aurora, GridLines } from "@/components/motion/Aurora";
import { getGame, getRelated, isDegraded } from "@/lib/games/source";
import { sizedImage } from "@/lib/games/image";
import { GameCollectionShowcase } from "@/components/game/GameCollectionShowcase";
import { GameEditorialOverview, GamePulseStrip } from "@/components/game/GameDetailEditorial";
import { GameDetailDock, type DetailSectionLink } from "@/components/game/GameDetailDock";
import {
  compactNumber,
  isUnreleased,
  playtimeLabel,
  releaseLabelLong,
  relativeRelease,
} from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { GameDetail } from "@/lib/games/types";

// The IGDB query is cached independently. Rendering the shell on demand avoids
// publishing a day-long Steam fallback when IGDB is unreachable during build.
export const revalidate = 0;

type Params = Promise<{ slug: string }>;

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

export default async function GamePage({ params }: { params: Params }) {
  const { slug } = await params;
  // Everything this page renders is identical for every reader, which keeps
  // the detail route safely cacheable.
  const result = await getGame(slug);
  if (!result) notFound();

  const { data: game, source } = result;
  // Pass the source so the rail comes from the same catalogue as the page.
  const related = await getRelated(game, source, 12);

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
    game.releases.length > 1 || hasThemeContent || game.requirements.length,
  );
  const sections: DetailSectionLink[] = [
    ...(game.description ? [{ id: "overview", label: "Overview" }] : []),
    ...(game.trailers.length || media.length ? [{ id: "media-archive", label: "Media" }] : []),
    ...(hasCollection ? [{ id: "collection", label: "Universe & content" }] : []),
    ...(hasDetails ? [{ id: "details", label: "Game details" }] : []),
    { id: "reviews", label: "Reviews" },
  ];
  const jsonLd = videoGameJsonLd(game);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <GameHero game={game} />

      <Container className="relative z-20 space-y-3 pb-2">
        <GamePulseStrip game={game} />
        <DataSourceNotice source={source} degraded={isDegraded(source)} />
        <SourceAttribution source={source} />
      </Container>
      <GameDetailDock gameName={game.name} sections={sections} />

      <Container className="grid gap-10 pb-8 pt-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-14 lg:pb-12 lg:pt-10">
        <div className="min-w-0 space-y-14">
          {game.description && <GameEditorialOverview game={game} />}

          {(game.trailers.length > 0 || media.length > 0) && (
            <section id="media-archive" className="space-y-12 scroll-mt-32">
              <Reveal className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-neon"><Clapperboard size={13} /> Cinematic archive</p>
                  <h2 className="text-3xl font-black sm:text-4xl">See the world in motion</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">Official footage, in-game captures, and production artwork—collected into one immersive gallery.</p>
                </div>
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1.5 text-xs text-faint"><Images size={13} /> {game.trailers.length + media.length} assets</span>
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

          <GameCollectionShowcase game={game} />

          {hasDetails && <section id="details" className="space-y-14 scroll-mt-32">
            <Reveal>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-brand-soft">Production dossier</p>
              <h2 className="text-3xl font-black sm:text-4xl">The complete game record</h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">Cast, creators, hardware, release history, and the details that define how this game plays.</p>
            </Reveal>

            {game.characters.length > 0 && <div><Reveal><h3 className="mb-5 text-2xl font-bold sm:text-3xl">Characters</h3></Reveal><CharacterRail characters={game.characters} /></div>}

            {game.companies.length > 0 && <Reveal><h3 className="mb-5 text-2xl font-bold sm:text-3xl">Who made it</h3><CompanyGrid companies={game.companies} />{game.engines.length > 0 && <div className="mt-5"><h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">Built with</h4><EngineRow engines={game.engines} /></div>}</Reveal>}

            {game.platformDetails.length > 0 && <Reveal><h3 className="mb-5 text-2xl font-bold sm:text-3xl">Platforms</h3><PlatformGrid platforms={game.platformDetails} /></Reveal>}

            {game.releases.length > 1 && <Reveal><h3 className="mb-5 text-2xl font-bold sm:text-3xl">Release history</h3><ReleaseTable releases={game.releases} /></Reveal>}

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
    </>
  );
}

/* -------------------------------------------------------------------------- */

function GameHero({ game }: { game: GameDetail }) {
  const franchise = game.franchises[0] ?? game.series[0];
  const backdrop = game.artworks[0] ?? game.screenshots[0] ?? game.image;

  return (
    <header className="noise relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <Parallax distance={40} scale className="h-full w-full">
          <GameCover
            name={game.name}
            slug={game.slug}
            image={backdrop}
            imageFallback={game.imageFallback}
            width={1920}
            priority
            sizes="100vw"
            rounded="rounded-none"
          />
        </Parallax>

        {/* The trailer dissolves in over the key art, muted and chrome-free.
            Sits under the scrims so the title never loses contrast. */}
        <BackdropTrailer trailer={game.trailers[0] ?? game.heroTrailer} />

        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/90 to-bg/55" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/75 to-transparent lg:via-bg/48" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_34%,transparent_0%,rgba(4,4,10,0.24)_48%,rgba(4,4,10,0.76)_100%)]" />
        <Aurora intensity="subtle" className="mix-blend-screen opacity-25" />
        <GridLines className="opacity-20" />
      </div>

      <Container className="flex min-h-[720px] flex-col justify-end pb-9 pt-24 sm:min-h-[760px] lg:min-h-[820px] lg:pb-14 lg:pt-32">
        <Reveal>
          <div className="mb-7 flex flex-wrap items-center gap-2 text-xs text-white/55">
            <Link
              href="/browse"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-3 py-2 backdrop-blur-md transition-colors hover:border-white/20 hover:text-white"
            >
              <ArrowLeft size={13} />
              Browse
            </Link>
            {franchise && (
              <Link
                href={`/franchise/${franchise.slug}`}
                className="rounded-full border border-white/10 bg-black/20 px-3 py-2 backdrop-blur-md transition-colors hover:border-neon/35 hover:text-neon"
              >
                {franchise.name} franchise
              </Link>
            )}
          </div>
        </Reveal>
        {/*
          Stacks on a phone and goes side-by-side from `sm` up.
          The poster and platform marks together answer "what is this, and can
          I play it?" before any text is read, so they lead on both layouts.
        */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-9 lg:gap-12">
          <div className="flex items-end gap-4 sm:gap-8">
            <Reveal
              direction="right"
              className={cn(
                "relative shrink-0",
                // Shown at every size — the poster is the strongest identifying
                // element on the page, and hiding it on phones wasted that.
                "w-36 sm:w-48 lg:w-64",
              )}
            >
              <span aria-hidden className="absolute -inset-2 rounded-[1.5rem] bg-gradient-to-br from-brand/35 via-white/5 to-neon/25 blur-sm" />
              <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/20 bg-panel shadow-[0_35px_90px_-30px_rgba(0,0,0,0.95)]">
                <GameCover
                  name={game.name}
                  slug={game.slug}
                  image={game.image}
                  imageFallback={game.imageFallback}
                  width={720}
                  sizes="(max-width: 640px) 144px, (max-width: 1024px) 192px, 256px"
                  priority
                />
                <span aria-hidden className="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-white/[0.08]" />
                <span className="absolute inset-x-3 bottom-3 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
              </div>
            </Reveal>

            {/* Platform marks sit directly beside the poster, on every size —
                a column on desktop, a compact stack on a phone. */}
            {game.parentPlatforms.length > 0 && (
              <Reveal delay={0.08} className="shrink-0 self-end pb-1">
                <ul className="flex flex-col gap-2 sm:gap-2.5">
                  {game.parentPlatforms.slice(0, 5).map((platform) => (
                    <li
                      key={platform.id}
                      title={platform.name}
                      className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-white/[0.04] transition-colors hover:border-line-strong sm:h-10 sm:w-10 lg:h-11 lg:w-11"
                    >
                      <PlatformIcons platforms={[platform]} size={17} max={1} tinted />
                    </li>
                  ))}
                </ul>
              </Reveal>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <Reveal className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.07em] text-white/45">
              <span aria-hidden className="h-px w-8 bg-gradient-to-r from-brand-soft to-transparent" />
              Arnav Games dossier
            </Reveal>
            <Reveal className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
              {game.genres.slice(0, 3).map((genre) => (
                <Chip key={genre.id} href={`/browse?genres=${genre.slug}`}>
                  {genre.name}
                </Chip>
              ))}
              {game.esrb && <Badge tone="neutral">{game.esrb}</Badge>}
            </Reveal>

            <TextReveal
              as="h1"
              text={game.name}
              className="max-w-4xl font-display text-[clamp(2.25rem,7vw,5.5rem)] font-black leading-[0.94] tracking-[-0.055em] text-white [text-shadow:0_10px_50px_rgba(0,0,0,0.45)]"
            />

            <Reveal delay={0.1} className="mt-3">
              <StudioCredit developers={game.developers} publishers={game.publishers} />
            </Reveal>

            {/* Score, release and popularity in one scannable row — the three
                things that decide whether someone reads any further. */}
            <Reveal delay={0.14} className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2.5">
              {game.metacritic !== null && (
                <span className="flex items-center gap-2">
                  <ScorePill score={game.metacritic} />
                  <span className="text-xs text-faint">Critics</span>
                </span>
              )}
              {game.rating > 0 && (
                <span className="flex items-center gap-1.5 text-sm text-muted">
                  <Star size={14} className="fill-gold text-gold" />
                  <span className="font-semibold text-text tabular-nums">
                    {game.rating.toFixed(1)}
                  </span>
                  <span className="text-faint">/5</span>
                </span>
              )}
              <span className="flex items-center gap-2 text-sm text-muted">
                <CalendarDays size={15} className="text-faint" />
                {releaseLabelLong(game)}
              </span>
              {/* Only an exact date yields a meaningful "in N months". */}
              {game.released && <Badge tone="brand">{relativeRelease(game.released)}</Badge>}
            </Reveal>

            {/* Only worth showing while a dated release is still ahead. */}
            {game.released && isUnreleased(game) && (
              <Reveal delay={0.18}>
                <Countdown date={game.released} className="mt-5" />
              </Reveal>
            )}
          </div>
        </div>

        {/* Actions span the full width rather than sharing the narrow title
            column, which on a phone left no room for two buttons side by side. */}
        <Reveal delay={0.24} className="mt-7 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          {/* Where you are with this game, and where you own it — the two
              things worth recording, side by side. The segmented control also
              starts tracking the game, so no separate watchlist button is
              needed here. */}
          <SaveButton game={game} className="w-full justify-center sm:w-auto" />
          <WatchButton game={game} variant="full" className="w-full px-4 sm:w-auto sm:px-6" />
          <StatusPicker game={game} className="col-span-2 sm:col-span-1" />
          <OwnershipPicker game={game} className="[&>button]:w-full [&>button]:justify-center sm:[&>button]:w-auto" />
          <SubscriptionAccessPicker game={game} className="[&>button]:w-full [&>button]:justify-center sm:[&>button]:w-auto" />
          {game.website && (
            <Button
              href={game.website}
              external
              variant="secondary"
              icon={<Globe size={16} />}
              iconRight={<ExternalLink size={13} />}
              className="w-full sm:w-auto"
            >
              Official site
            </Button>
          )}
          <Button href="#reviews" variant="ghost" icon={<Star size={16} />} className="w-full sm:w-auto">
            Rate this game
          </Button>
        </Reveal>

      </Container>
    </header>
  );
}

function StudioLinks({ studios }: { studios: GameDetail["developers"] }) {
  return (
    <span className="flex flex-wrap gap-x-1.5 gap-y-1">
      {studios.map((studio, index) => (
        <span key={studio.id}>
          <Link
            href={`/studio/${studio.slug}`}
            className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-brand-soft"
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
                      className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-neon"
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
    ...(game.playtime
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
    <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
      {(game.metacritic !== null || game.rating > 0) && (
        <Reveal className="glass flex items-center gap-5 rounded-2xl p-5">
          {game.metacritic !== null && <ScoreRing score={game.metacritic} />}
          <div className="min-w-0">
            {game.metacritic !== null && (
              <>
                <p className="text-sm font-semibold">Metascore</p>
                <p className="text-xs text-muted">Critic aggregate</p>
              </>
            )}
            {game.rating > 0 && (
              <p
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap text-sm text-muted",
                  game.metacritic !== null && "mt-3",
                )}
              >
                <Star size={13} className="shrink-0 fill-gold text-gold" />
                <span className="font-semibold text-text tabular-nums">
                  {game.rating.toFixed(1)}/5
                </span>
                {game.ratingsCount > 0 && (
                  <span className="text-faint">· {compactNumber(game.ratingsCount)} ratings</span>
                )}
              </p>
            )}
          </div>
        </Reveal>
      )}

      <Reveal delay={0.06} className="glass rounded-2xl p-5">
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
        <Reveal delay={0.09} className="glass rounded-2xl p-5">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
            {game.ageRatings.length > 1 ? "Age ratings" : "Age rating"}
          </h2>
          <AgeRatingPanel ratings={game.ageRatings} />
        </Reveal>
      )}

      {game.parentPlatforms.length > 0 && (
        <Reveal delay={0.12} className="glass rounded-2xl p-5">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
            Platforms
          </h2>
          <PlatformList platforms={game.parentPlatforms} />
        </Reveal>
      )}

      {game.stores.length > 0 && (
        <Reveal delay={0.18} className="glass rounded-2xl p-5">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
            Where to buy
          </h2>
          <StoreLinks stores={game.stores} />
        </Reveal>
      )}

      {game.websites.some((site) => site.kind !== "official") && (
        <Reveal delay={0.21} className="glass rounded-2xl p-5">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
            Links
          </h2>
          <CommunityLinks websites={game.websites} />
        </Reveal>
      )}

      {game.genres.length > 0 && (
        <Reveal delay={0.24} className="glass rounded-2xl p-5">
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
              <h3 className="border-b border-line bg-white/[0.03] px-4 py-3 text-sm font-semibold">
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
