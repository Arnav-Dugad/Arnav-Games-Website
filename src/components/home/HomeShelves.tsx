/**
 * Homepage shelves that wait on slower sources: the hype index (Today and
 * Top charts) and the Game Pass catalogue.
 *
 * Each is an async server component meant to sit behind its own <Suspense>,
 * so the hero and the shelves fed by the main query render first and these
 * stream in. The hype ranking is shared by two shelves, so it is fetched once
 * per request (`cache`).
 *
 * Every shelf renders nothing when its data is empty or unavailable: an
 * absent shelf is honest, a shelf of placeholders is not.
 */

import { cache } from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { GameRail } from "@/components/game/GameRail";
import { getGeForceNowHighlights } from "@/lib/games/cloud";
import { getEpicFreeGames } from "@/lib/games/epic";
import { getGamePassLeavingSoon, getGamePassRecentlyAdded, getMostAnticipated } from "@/lib/games/source";
import type { GameSummary } from "@/lib/games/types";
import { Container } from "@/components/ui/SectionHeading";
import { EpicFree } from "./EpicFree";
import { GamePassSwitcher } from "./GamePassSwitcher";
import { HomeSection } from "./HomeSection";
import { buildStories } from "./stories";
import { TodayStories } from "./TodayStories";
import { TopCharts, type Chart } from "./TopCharts";

const anticipatedOnce = cache(() => getMostAnticipated(12));

const TODAY = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

export async function TodayShelf({
  upcoming,
  trending,
  newReleases,
  topRated,
  exclude,
}: {
  upcoming: GameSummary[];
  trending: GameSummary[];
  newReleases: GameSummary[];
  topRated: GameSummary[];
  exclude: number[];
}) {
  const anticipated = await anticipatedOnce();
  const stories = buildStories({
    anticipated: anticipated.data,
    upcoming,
    trending,
    newReleases,
    topRated,
    exclude,
  });
  if (stories.length === 0) return null;

  return (
    <HomeSection id="today" eyebrow={TODAY.format(new Date())} title="Today">
      {/* The bento sits in the text column; the phone shelf bleeds out of it itself. */}
      <Container>
        <TodayStories stories={stories} />
      </Container>
    </HomeSection>
  );
}

export async function ChartsShelf({ trending, topRated }: { trending: GameSummary[]; topRated: GameSummary[] }) {
  const anticipated = await anticipatedOnce();
  const charts: Chart[] = [
    {
      id: "trending",
      label: "Trending",
      href: "/browse?ordering=-added",
      rows: trending.map((game) => ({ game })),
    },
    {
      id: "anticipated",
      label: "Most anticipated",
      href: "/upcoming",
      rows: anticipated.data.map(({ game, hype }) => ({ game, hype })),
    },
    {
      id: "top",
      label: "Top rated",
      href: "/browse?ordering=-metacritic",
      rows: topRated.map((game) => ({ game })),
    },
  ];
  return <TopCharts charts={charts} />;
}

export async function GamePassShelf() {
  const [added, leaving] = await Promise.all([getGamePassRecentlyAdded(), getGamePassLeavingSoon()]);
  if (added.data.length === 0 && leaving.data.length === 0) return null;
  return <GamePassSwitcher added={added.data} leaving={leaving.data} />;
}

/**
 * Popular games NVIDIA streams right now (most played first). GeForce NOW
 * plays games you own on a supported store, so the shelf says "ready", not
 * "free". Cached 12 h server-side; nothing on a warm render.
 */
export async function GeForceNowShelf() {
  const games = await getGeForceNowHighlights(18);
  // A handful of covers isn't a shelf; a failed list renders nothing.
  if (!games || games.length < 4) return null;
  return (
    <HomeSection
      id="geforce-now"
      title={
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
          Ready on GeForce NOW
          {/* NVIDIA green, decorative: the title already names the service. */}
          <span aria-hidden className="inline-flex translate-y-px items-center gap-1 rounded-[7px] bg-[#76b900] px-2 py-1 align-middle font-sans text-[11px] font-bold uppercase leading-none tracking-[0.06em] text-black shadow-[inset_0_1px_0_#ffffff40]">
            <BrandIcon name="nvidia" size={12} title={null} />
            Cloud
          </span>
        </span>
      }
      href="https://www.nvidia.com/en-us/geforce-now/games/"
      linkLabel="Full list"
    >
      <GameRail games={games} />
    </HomeSection>
  );
}

/**
 * Epic's free-to-keep games for the visitor's country: this week's, with
 * the time left, and next week's as a teaser. Epic's feed is cached 3 h per
 * country; "free now" is re-decided against the clock on each render.
 */
export async function EpicFreeShelf({ country }: { country: string }) {
  const free = await getEpicFreeGames(country);
  if (!free || (free.current.length === 0 && free.upcoming.length === 0)) return null;
  return (
    <HomeSection id="epic-free" title={free.current.length > 0 ? "Free this week on Epic" : "Free next on Epic"} href="https://store.epicgames.com/free-games" linkLabel="Epic Store">
      <EpicFree current={free.current} upcoming={free.upcoming} />
    </HomeSection>
  );
}
