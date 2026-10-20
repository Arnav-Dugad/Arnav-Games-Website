import type { Metadata } from "next";
import Link from "next/link";
import { BrowseControls, UPCOMING_SORTS } from "@/components/game/BrowseControls";
import type { ReleaseSignals } from "./_lib/calendar";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { DataSourceNotice, SourceAttribution } from "@/components/ui/DataSourceNotice";
import { getGenres, getPlatforms, getUpcoming, isDegraded } from "@/lib/games/source";
import type { GameSummary } from "@/lib/games/types";
import { releaseState } from "@/lib/games/release-state";
import { getDelayCounts } from "@/lib/games/release-history";
import { hypeIndexFor } from "@/lib/games/providers/igdb-extras";
import { ReleaseCalendar } from "./_components/ReleaseCalendar";

/**
 * Delay counts (our own history) and hype index per row, fetched together.
 * Both are decoration: any failure yields no badges rather than a broken page,
 * and hype only exists for IGDB ids.
 */
async function releaseSignals(games: GameSummary[], igdb: boolean): Promise<ReleaseSignals> {
  if (games.length === 0) return {};
  const ids = [...new Set(games.map((game) => game.id))];
  const [delays, hype] = await Promise.all([
    getDelayCounts(ids).catch(() => new Map<number, number>()),
    igdb ? hypeIndexFor(ids).catch(() => new Map()) : Promise.resolve(new Map()),
  ]);
  const signals: ReleaseSignals = {};
  for (const id of ids) {
    const delayCount = delays.get(id);
    const hypeScore = hype.get(id)?.score;
    if (delayCount || typeof hypeScore === "number") {
      signals[id] = {
        ...(delayCount ? { delays: delayCount } : {}),
        ...(typeof hypeScore === "number" ? { hype: hypeScore } : {}),
      };
    }
  }
  return signals;
}

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Upcoming game releases",
  description:
    "A release calendar of upcoming video games — every day's launches with covers, hype and delay history, plus release windows and undated announcements.",
};

/**
 * One month per render, fetched for exactly its own date range, so a quiet
 * Tuesday really is quiet — never an artefact of pagination. 300 covers the
 * busiest months of the notable calendar; beyond it the page says so.
 */
const MONTH_LIMIT = 300;
/** The undated tray is a taste; `?window=tba` opens it fully. */
const TBA_TRAY = 18;
const TBA_FULL = 60;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The calendar is always a calendar. Links from before it was (`?view=week`,
 * `?week=…`, `?window=…`, `?ordering=…`) still land somewhere sensible: a
 * requested week opens its month with that week's Monday selected, and the
 * old horizons simply open the current month.
 */
export default async function UpcomingPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const genres = first(sp.genres);
  const platforms = first(sp.platforms);
  // Notable-only is the default. Opting *out* is the explicit choice, because
  // the unfiltered calendar is two thirds shovelware and reads as broken.
  const showAll = first(sp.all) === "1";
  const tbaOpen = first(sp.window) === "tba";

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const requestedDay = first(sp.day) ?? first(sp.week);
  const day = requestedDay && ISO_DAY.test(requestedDay) && requestedDay > today ? requestedDay : null;
  const requestedMonth = first(sp.month);
  // Clamped to now: the calendar never pages into the past.
  const month =
    day?.slice(0, 7) ??
    (requestedMonth && ISO_MONTH.test(requestedMonth) && requestedMonth > thisMonth ? requestedMonth : thisMonth);
  const monthEnd = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  // `?week=` named a Monday that may sit in the previous month; select within this one.
  const selectedDay = day && day.slice(0, 7) === month ? day : null;

  const filters = { genres, platforms, notableOnly: !showAll };
  const [{ data, source }, tba, genreList, platformList] = await Promise.all([
    getUpcoming(MONTH_LIMIT, 1, { ...filters, dates: `${month}-01,${monthEnd}`, ordering: "released", releaseTiming: "dated" }),
    getUpcoming(tbaOpen ? TBA_FULL : TBA_TRAY, 1, { ...filters, ordering: "-hypes", releaseTiming: "tba" }).catch(() => null),
    getGenres(),
    getPlatforms(),
  ]);

  // Final render-boundary guard. Provider output is normalized first, then
  // classified; no stale index row can leak a past title into this page.
  const games = data.results.filter((game) => releaseState(game) === "upcoming" && !game.tba);
  const undated = (tba?.data.results ?? []).filter((game) => releaseState(game) === "upcoming" && game.tba && !game.released);
  const signals = await releaseSignals([...games, ...undated], source === "igdb");

  // Filters carried by every calendar link, so they survive month changes.
  const carried = new URLSearchParams();
  if (genres) carried.set("genres", genres);
  if (platforms) carried.set("platforms", platforms);
  if (showAll) carried.set("all", "1");
  const toggleAll = new URLSearchParams(carried);
  if (showAll) toggleAll.delete("all");
  else toggleAll.set("all", "1");
  if (month !== thisMonth) toggleAll.set("month", month);

  return (
    <>
      <PageHeader title="Release calendar" />

      <Container>
        {source === "unavailable" && (
          <div className="mb-7">
            <DataSourceNotice source={source} degraded={isDegraded(source)} />
          </div>
        )}

        <BrowseControls
          genres={genreList.data}
          platforms={platformList.data}
          // The grid shows exactly what was fetched for the month.
          totalCount={games.length}
          sorts={UPCOMING_SORTS}
          defaultSort="released"
          noun="release"
          showDatePresets={false}
          showScore={false}
          showSort={false}
        />

        {/*
          The honest escape hatch: the default hides roughly two thirds of the
          calendar, so it says so in plain words and offers the way back.
        */}
        <p className="mt-3 text-[13px] text-faint">
          {showAll ? "Every announced game. " : "Games people follow. "}
          <Link
            href={`/upcoming${toggleAll.size ? `?${toggleAll}` : ""}`}
            scroll={false}
            className="font-medium text-brand-soft underline-offset-2 fine:hover:underline"
          >
            {showAll ? "Only followed games" : "Show every game"}
          </Link>
        </p>
      </Container>

      <div className="mt-6 sm:mt-8">
        <ReleaseCalendar
          games={games}
          undated={undated}
          signals={signals}
          month={month}
          thisMonth={thisMonth}
          serverToday={today}
          initialDay={selectedDay}
          query={carried.toString()}
          truncated={data.hasNext && data.count > data.results.length ? data.count : null}
          undatedOpen={tbaOpen}
          filtered={Boolean(genres || platforms)}
        />
      </div>

      <Container className="pb-8 lg:pb-12">
        <div className="mt-12">
          <SourceAttribution source={source} />
        </div>
      </Container>
    </>
  );
}
