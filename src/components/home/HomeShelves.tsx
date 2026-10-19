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
import { getGamePassLeavingSoon, getGamePassRecentlyAdded, getMostAnticipated } from "@/lib/games/source";
import type { GameSummary } from "@/lib/games/types";
import { Container } from "@/components/ui/SectionHeading";
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
      description: "What players worldwide are playing right now, from IGDB’s live signal.",
      href: "/browse?ordering=-added",
      rows: trending.map((game) => ({ game })),
    },
    {
      id: "anticipated",
      label: "Most anticipated",
      description: "Upcoming games ranked by follows, want-to-play lists and attention on IGDB.",
      href: "/upcoming?ordering=-hypes",
      rows: anticipated.data.map(({ game, hype }) => ({ game, hype })),
    },
    {
      id: "top",
      label: "Top rated",
      description: "The highest critic scores in the database.",
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
