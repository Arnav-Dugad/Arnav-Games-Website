import type { Metadata } from "next";
import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import { BrowseControls, UPCOMING_SORTS } from "@/components/game/BrowseControls";
import { SegmentedControl } from "@/components/filters";
import { ReleaseTimeline } from "@/components/game/ReleaseTimeline";
import { addDays, rangeLabel, weekStartOf, type ReleaseSignals } from "./_lib/calendar";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { Pagination } from "@/components/ui/Pagination";
import { DataSourceNotice, SourceAttribution } from "@/components/ui/DataSourceNotice";
import { EmptyState } from "@/components/ui/EmptyState";
import { getGenres, getPlatforms, getUpcoming, isDegraded } from "@/lib/games/source";
import type { GameSummary, SortKey } from "@/lib/games/types";
import { releaseState } from "@/lib/games/release-state";
import { getDelayCounts } from "@/lib/games/release-history";
import { hypeIndexFor } from "@/lib/games/providers/igdb-extras";
import { MonthView, WeekView } from "./_components/CalendarViews";
import { ThisWeek } from "./_components/ThisWeek";

/**
 * Delay counts (our own D1 history) and hype index per row, fetched together.
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
    "A filterable release calendar of upcoming video games — list, week and month views, with countdowns, hype and delay history.",
};

/**
 * 120 keeps the list useful across long release windows without pushing a
 * single page past a couple of hundred rows. The Week and Month grids fetch
 * their own date range in one go instead, so a day is never "quiet" merely
 * because it fell onto page two.
 */
const PAGE_SIZE = 120;
const WEEK_LIMIT = 200;
const MONTH_LIMIT = 300;
const WINDOWS = [
  { value: "30", label: "30 days", detail: "Launching within the next month" },
  { value: "90", label: "90 days", detail: "The next three months of launches" },
  { value: "365", label: "12 months", detail: "The long-range calendar for the year ahead" },
  { value: "all", label: "All dated", detail: "Every future release with a date or window" },
  { value: "tba", label: "Date TBA", detail: "Announced, but no date given yet" },
] as const;

type View = "list" | "week" | "month";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

interface Query {
  genres?: string;
  platforms?: string;
  ordering?: SortKey;
  timeframe?: string;
  showAll?: boolean;
  view?: View;
  week?: string;
  month?: string;
}

/** Every link on this page goes through here, so filters always survive a view change. */
function upcomingHref({ genres, platforms, ordering, timeframe = "90", showAll, view = "list", week, month }: Query) {
  const params = new URLSearchParams();
  if (view !== "list") params.set("view", view);
  if (genres) params.set("genres", genres);
  if (platforms) params.set("platforms", platforms);
  if (view === "list") {
    const defaultOrdering = timeframe === "tba" ? "-hypes" : "released";
    if (ordering && ordering !== defaultOrdering) params.set("ordering", ordering);
    if (timeframe !== "90") params.set("window", timeframe);
  }
  if (view === "week" && week) params.set("week", week);
  if (view === "month" && month) params.set("month", month);
  if (showAll) params.set("all", "1");
  const query = params.toString();
  return query ? `/upcoming?${query}` : "/upcoming";
}

export default async function UpcomingPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const genres = first(sp.genres);
  const platforms = first(sp.platforms);
  const page = Math.max(1, Number(first(sp.page) ?? 1) || 1);
  const rawView = first(sp.view);
  const view: View = rawView === "week" || rawView === "month" ? rawView : "list";
  const requestedWindow = first(sp.window);
  const timeframe = WINDOWS.some((item) => item.value === requestedWindow) ? requestedWindow! : "90";
  const defaultOrdering: SortKey = timeframe === "tba" ? "-hypes" : "released";
  const ordering = (first(sp.ordering) as SortKey | undefined) ?? defaultOrdering;
  // Notable-only is the default. Opting *out* is the explicit choice, because
  // the unfiltered calendar is two thirds shovelware and reads as broken.
  const showAll = first(sp.all) === "1";
  const filtered = Boolean(genres || platforms);
  const base = { genres, platforms, showAll };

  const today = new Date().toISOString().slice(0, 10);
  const thisWeek = weekStartOf(today);
  const thisMonth = today.slice(0, 7);

  // Week and month are clamped to now: the calendar never pages into the past.
  const requestedWeek = first(sp.week);
  const weekStart = requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) && weekStartOf(requestedWeek) > thisWeek
    ? weekStartOf(requestedWeek)
    : thisWeek;
  const requestedMonth = first(sp.month);
  const month = requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) && requestedMonth > thisMonth
    ? requestedMonth
    : thisMonth;
  const monthEnd = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;

  const rangeDays = timeframe === "all" || timeframe === "tba" ? null : Number(timeframe);
  const listDates = rangeDays ? `${today},${addDays(today, rangeDays)}` : undefined;
  const dates = view === "week" ? `${weekStart},${addDays(weekStart, 6)}` : view === "month" ? `${month}-01,${monthEnd}` : listDates;
  // The spotlight: page one of the list only, and never on the TBA shelf.
  const withSpotlight = view === "list" && page === 1 && timeframe !== "tba";

  const [{ data, source }, genreList, platformList, spotlight] = await Promise.all([
    getUpcoming(view === "list" ? PAGE_SIZE : view === "week" ? WEEK_LIMIT : MONTH_LIMIT, view === "list" ? page : 1, {
      genres,
      platforms,
      dates,
      ordering: view === "list" ? ordering : "released",
      notableOnly: !showAll,
      releaseTiming: view === "list" && timeframe === "tba" ? "tba" : "dated",
    }),
    getGenres(),
    getPlatforms(),
    withSpotlight
      ? getUpcoming(10, 1, {
          genres,
          platforms,
          dates: `${today},${addDays(today, 7)}`,
          ordering: "-hypes",
          notableOnly: true,
          releaseTiming: "dated",
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const totalPages = data.count > 0 ? Math.ceil(data.count / PAGE_SIZE) : 1;
  // Final render-boundary guard. Provider output is normalized first, then
  // classified; no stale index row can leak a past title into this page.
  const games = data.results.filter((game) =>
    releaseState(game) === "upcoming" && (view === "list" && timeframe === "tba" ? game.tba : !game.tba),
  );
  const weekGames = (spotlight?.data.results ?? []).filter((game) => releaseState(game) === "upcoming" && game.released);
  const signals = await releaseSignals([...games, ...weekGames], source === "igdb");

  const exact = games.filter((game) => game.released).length;
  const windowed = games.filter((game) => game.releaseWindow).length;
  const activeWindow = WINDOWS.find((item) => item.value === timeframe) ?? WINDOWS[1];

  return (
    <>
      <PageHeader
        eyebrow="Upcoming"
        title="Release calendar"
        description="Every game with a future date: exact days, honest release windows, and nothing that is already out."
      />

      {withSpotlight && weekGames.length > 0 && (
        <ThisWeek
          games={weekGames}
          signals={signals}
          title="This week"
          rangeLabel={rangeLabel(addDays(today, 1), addDays(today, 7))}
          weekHref={upcomingHref({ ...base, view: "week" })}
        />
      )}

      <Container className="pb-8 pt-6 lg:pb-12 lg:pt-8">
        {source === "unavailable" && (
          <div className="mb-7">
            <DataSourceNotice source={source} degraded={isDegraded(source)} />
          </div>
        )}

        {/*
          Two page-level choices, both in the URL so they're shareable: how to
          look at the calendar, and (for the list) how far ahead. They are
          links drawn as segmented controls because that's what they are.
        */}
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SegmentedControl
            label="Calendar view"
            value={view}
            fill={false}
            className="w-fit max-w-full"
            segments={[
              { value: "list", label: "List", href: upcomingHref({ ...base, view: "list" }) },
              { value: "week", label: "Week", href: upcomingHref({ ...base, view: "week" }) },
              { value: "month", label: "Month", href: upcomingHref({ ...base, view: "month" }) },
            ]}
          />
          {view === "list" && (
            <div className="min-w-0 lg:w-[34rem]">
              <SegmentedControl
                label="Release horizon"
                value={timeframe}
                segments={WINDOWS.map((item) => ({
                  value: item.value,
                  label: item.label,
                  title: item.detail,
                  href: upcomingHref({ ...base, timeframe: item.value }),
                }))}
              />
            </div>
          )}
        </div>

        <BrowseControls
          genres={genreList.data}
          platforms={platformList.data}
          // The grids show exactly what was fetched; the list pages through IGDB's total.
          totalCount={view === "list" ? data.count : games.length}
          sorts={UPCOMING_SORTS}
          defaultSort={defaultOrdering}
          noun="release"
          showDatePresets={false}
          showScore={false}
          showSort={view === "list"}
        />

        {/*
          The honest escape hatch: the default hides roughly two thirds of the
          calendar, so it says so in plain words and offers the way back.
        */}
        <p className="mt-3 text-[13px] leading-relaxed text-faint">
          {view === "list" && (
            <>
              {activeWindow.detail}
              {timeframe !== "tba" && games.length > 0 && <> · {exact} exact {exact === 1 ? "day" : "days"}{windowed > 0 && `, ${windowed} ${windowed === 1 ? "window" : "windows"}`}</>}
              {" · "}
            </>
          )}
          {showAll ? "Showing every announced game. " : "Showing games people are following. "}
          <Link
            href={upcomingHref({ ...base, ordering, timeframe, view, week: weekStart, month, showAll: !showAll })}
            scroll={false}
            className="font-medium text-brand-soft underline-offset-2 fine:hover:underline"
          >
            {showAll ? "Only followed games" : "Include every announced game"}
          </Link>
        </p>

        <div className="mt-8 sm:mt-10">
          {view === "week" ? (
            <WeekView
              games={games}
              signals={signals}
              weekStart={weekStart}
              prevHref={weekStart > thisWeek ? upcomingHref({ ...base, view: "week", week: addDays(weekStart, -7) }) : null}
              nextHref={upcomingHref({ ...base, view: "week", week: addDays(weekStart, 7) })}
            />
          ) : view === "month" ? (
            <MonthView
              games={games}
              signals={signals}
              month={month}
              truncated={data.count > data.results.length && data.hasNext ? data.count : null}
              prevHref={month > thisMonth ? upcomingHref({ ...base, view: "month", month: shiftMonth(month, -1) }) : null}
              nextHref={upcomingHref({ ...base, view: "month", month: shiftMonth(month, 1) })}
            />
          ) : games.length === 0 ? (
            <EmptyCalendar filtered={filtered} showAll={showAll} tba={timeframe === "tba"} />
          ) : (
            <>
              <ReleaseTimeline games={games} signals={signals} />
              <Pagination
                page={page}
                hasNext={data.hasNext}
                totalPages={totalPages}
                basePath="/upcoming"
                params={{
                  genres,
                  platforms,
                  ordering: ordering === defaultOrdering ? undefined : ordering,
                  all: showAll ? "1" : undefined,
                  window: timeframe === "90" ? undefined : timeframe,
                }}
              />
            </>
          )}
        </div>

        <div className="mt-12">
          <SourceAttribution source={source} />
        </div>
      </Container>
    </>
  );
}

function shiftMonth(month: string, delta: number): string {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function EmptyCalendar({ filtered, showAll, tba }: { filtered: boolean; showAll: boolean; tba: boolean }) {
  if (filtered) {
    return (
      <EmptyState
        icon={<CalendarX2 size={24} />}
        title="Nothing upcoming matches those filters"
        body="Try widening the genre or platform selection."
        action={{ href: "/upcoming", label: "Clear filters" }}
      />
    );
  }

  return (
    <EmptyState
      icon={<CalendarX2 size={24} />}
      title={tba ? "No undated announcements" : "Nothing scheduled in this window"}
      body={
        tba
          ? "Try including every announced game, or go back to the dated calendar."
          : showAll
            ? "The calendar fills in as studios announce dates. Try a longer horizon."
            : "Nothing people are following is dated in this window yet. The full calendar includes every announced game."
      }
      action={showAll ? { href: "/upcoming?window=365", label: "Look 12 months ahead" } : { href: tba ? "/upcoming?window=tba&all=1" : "/upcoming?all=1", label: "Include every game" }}
      secondaryAction={{ href: "/browse", label: "Browse released games" }}
    />
  );
}
