import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChevronRight,
  Columns3,
  Compass,
  Flame,
  Gamepad2,
  Heart,
  Layers,
  Shapes,
  Sparkles,
  Trophy,
} from "lucide-react";
import { GamePassShelf, GeForceNowShelf } from "@/components/home/HomeShelves";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container, SectionHeading } from "@/components/ui/SectionHeading";
import { GameRailSkeleton } from "@/components/ui/Skeleton";
import { getGenres } from "@/lib/games/source";
import { hueFromString } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * Discover: the hub behind the phone tab bar's Discover tab and the header's
 * Discover link — every way into the catalogue on one screen, the way the
 * App Store's Apps tab gathers charts and categories.
 *
 * It exists because a phone has no room for a seven-item nav: Genres,
 * Platforms, Studios, Franchises and Compare used to be reachable on a phone
 * only from the footer. Here each one is a single tap from the tab bar.
 *
 * Mostly static, and deliberately so: the tiles render with no data at all,
 * so the hub works when the game database is slow or down. Only the genre
 * shortcuts and the Game Pass / GeForce NOW shelves need data, and they disappear quietly
 * rather than blocking the page. No scroll-triggered reveals either — the
 * tiles are the page, and they must never be waiting on an observer.
 */

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Discover",
  description:
    "Every way into the game database: top charts, new releases, the most anticipated games, genres, platforms, studios, franchises and side-by-side comparisons.",
};

interface Tile {
  href: string;
  title: string;
  body: string;
  icon: ReactNode;
  /** Two hues for the `.hue-tile` gradient (see globals.css). */
  hue: [number, number];
}

const FEATURED: Tile[] = [
  {
    href: "/browse",
    title: "Browse every game",
    body: "The whole database, filtered by genre, platform, score or era and sorted your way.",
    icon: <Compass size={30} strokeWidth={1.7} />,
    hue: [262, 300],
  },
  {
    href: "/browse?ordering=-metacritic",
    title: "Top rated",
    body: "The highest critic scores.",
    icon: <Trophy size={24} strokeWidth={1.8} />,
    hue: [38, 12],
  },
  {
    href: "/upcoming",
    title: "Most anticipated",
    body: "What everyone is waiting for.",
    icon: <Flame size={24} strokeWidth={1.8} />,
    hue: [350, 20],
  },
  {
    href: "/browse?ordering=-released",
    title: "New releases",
    body: "Just out, newest first.",
    icon: <Sparkles size={24} strokeWidth={1.8} />,
    hue: [195, 225],
  },
  {
    href: "/upcoming",
    title: "Release calendar",
    body: "Every date, week by week.",
    icon: <CalendarDays size={24} strokeWidth={1.8} />,
    hue: [150, 185],
  },
];

const COLLECTIONS: Tile[] = [
  {
    href: "/for-you",
    title: "For you",
    body: "Picks from what you play",
    icon: <Heart size={20} strokeWidth={1.9} />,
    hue: [300, 340],
  },
  {
    href: "/genres",
    title: "Genres",
    body: "Action to visual novel",
    icon: <Shapes size={20} strokeWidth={1.9} />,
    hue: [280, 320],
  },
  {
    href: "/platforms",
    title: "Platforms",
    body: "Every console and PC",
    icon: <Gamepad2 size={20} strokeWidth={1.9} />,
    hue: [210, 240],
  },
  {
    href: "/studios",
    title: "Studios",
    body: "Who makes what",
    icon: <Building2 size={20} strokeWidth={1.9} />,
    hue: [20, 45],
  },
  {
    href: "/franchises",
    title: "Franchises",
    body: "Whole series in order",
    icon: <Layers size={20} strokeWidth={1.9} />,
    hue: [160, 195],
  },
  {
    href: "/compare",
    title: "Compare games",
    body: "Scores, length and price side by side",
    icon: <Columns3 size={20} strokeWidth={1.9} />,
    hue: [330, 0],
  },
];

const tileStyle = ([a, b]: [number, number]) => ({ "--tile-hue": a, "--tile-hue-2": b }) as CSSProperties;

export default async function DiscoverPage() {
  // Genre shortcuts are a convenience: if the source is down the section
  // simply isn't drawn (the Genres tile above still leads to the full list).
  const genres = await getGenres()
    .then((result) => result.data.slice(0, 12))
    .catch(() => []);

  const [hero, ...rest] = FEATURED;

  return (
    <>
      <PageHeader title="Discover" />

      <Container className="pb-4">
        <section aria-labelledby="discover-start">
          <h2 id="discover-start" className="sr-only">
            Start here
          </h2>
          {/* Phones: the hero tile spans the row, then a 2×2 block. Desktop:
              the hero holds a 2×2 corner and the rest stack beside it. */}
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:grid-rows-2 lg:gap-4">
            <li className="col-span-2 lg:row-span-2">
              <Link
                href={hero.href}
                className="hue-tile press group relative flex h-48 flex-col justify-end overflow-hidden rounded-3xl border border-line p-5 sm:h-56 lg:h-full lg:min-h-[22rem] lg:p-7"
                style={tileStyle(hero.hue)}
              >
                <TileSheen />
                <span className="absolute left-5 top-5 grid h-14 w-14 place-items-center rounded-2xl bg-white/15 text-white shadow-[inset_0_1px_0_#ffffff40] lg:left-7 lg:top-7 lg:h-16 lg:w-16">
                  {hero.icon}
                </span>
                <ArrowUpRight
                  size={18}
                  aria-hidden
                  className="absolute right-5 top-5 text-white/60 transition-transform duration-500 fine:group-hover:-translate-y-0.5 fine:group-hover:translate-x-0.5 lg:right-7 lg:top-7"
                />
                <span className="relative font-display text-[26px] font-bold leading-tight tracking-[-0.02em] lg:text-[34px]">
                  {hero.title}
                </span>
                <span className="relative mt-1.5 max-w-md text-[15px] leading-snug text-white/80 lg:text-[17px]">
                  {hero.body}
                </span>
              </Link>
            </li>
            {rest.map((tile) => (
              <li key={tile.href}>
                <Link
                  href={tile.href}
                  className="hue-tile press group relative flex h-36 flex-col justify-end overflow-hidden rounded-2xl border border-line p-4 sm:h-40 lg:h-full lg:min-h-[10.5rem] lg:p-5"
                  style={tileStyle(tile.hue)}
                >
                  <TileSheen />
                  <span className="absolute left-4 top-4 text-white/90 lg:left-5 lg:top-5">{tile.icon}</span>
                  <span className="relative font-display text-[17px] font-bold leading-tight lg:text-xl">{tile.title}</span>
                  <span className="relative mt-0.5 text-[13px] leading-snug text-white/75">{tile.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="discover-collections" className="pt-10 sm:pt-12 lg:pt-16">
          <h2
            id="discover-collections"
            className="text-[22px] font-bold leading-tight tracking-[-0.02em] sm:text-[28px]"
          >
            Explore by
          </h2>
          {/* A grouped list on phones and tablets (one thumb-sized row each,
              like iOS Settings); a row of six tiles on desktop. */}
          <ul className="mt-5 overflow-hidden rounded-2xl bg-panel sm:mt-6 lg:grid lg:grid-cols-6 lg:gap-4 lg:overflow-visible lg:rounded-none lg:bg-transparent">
            {COLLECTIONS.map((tile) => (
              <li key={tile.href} className="border-b border-line last:border-b-0 lg:border-b-0">
                <Link
                  href={tile.href}
                  className={cn(
                    "press group flex min-h-[60px] items-center gap-3.5 px-4 py-2.5 transition-colors active:bg-fg/[0.06]",
                    "lg:h-full lg:flex-col lg:items-start lg:gap-6 lg:rounded-2xl lg:border lg:border-line lg:bg-panel lg:p-5 lg:fine:hover:border-line-strong",
                  )}
                >
                  <span
                    className="hue-tile grid h-9 w-9 shrink-0 place-items-center rounded-[10px] lg:h-11 lg:w-11 lg:rounded-xl"
                    style={tileStyle(tile.hue)}
                  >
                    {tile.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-semibold leading-tight">{tile.title}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-muted lg:whitespace-normal">{tile.body}</span>
                  </span>
                  <ChevronRight size={18} aria-hidden className="shrink-0 text-faint lg:hidden" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {genres.length > 0 && (
          <section aria-labelledby="discover-genres" className="pt-10 sm:pt-12 lg:pt-16">
            <SectionHeading
              title={<span id="discover-genres">Popular genres</span>}
              href="/genres"
              linkLabel="All genres"
            />
            <ul className="mt-5 grid grid-cols-2 gap-3 sm:mt-6 sm:grid-cols-3 lg:grid-cols-6 lg:gap-4">
              {genres.map((genre) => {
                const hue = hueFromString(genre.slug);
                return (
                  <li key={genre.id}>
                    <Link
                      href={`/browse?genres=${genre.slug}`}
                      className="hue-tile press relative flex h-20 items-end overflow-hidden rounded-2xl border border-line px-3.5 py-3 lg:h-24"
                      style={tileStyle([hue, (hue + 50) % 360])}
                    >
                      <span className="relative font-display text-[15px] font-bold leading-tight lg:text-[17px]">
                        {genre.name}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </Container>

      <Suspense fallback={<GamePassFallback />}>
        <GamePassShelf />
      </Suspense>

      <Suspense fallback={<GamePassFallback />}>
        <GeForceNowShelf />
      </Suspense>
    </>
  );
}

/** The soft top-left light every hue tile carries, as on Apple Music's category tiles. */
function TileSheen() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_15%_0%,#ffffff2e,transparent_65%)]"
    />
  );
}

function GamePassFallback() {
  return (
    <div className="py-9 sm:py-12 lg:py-14" aria-hidden>
      <Container>
        <div className="skeleton-glass h-7 w-48 rounded-lg" />
      </Container>
      <div className="mt-6 sm:mt-7">
        <GameRailSkeleton />
      </div>
    </div>
  );
}
