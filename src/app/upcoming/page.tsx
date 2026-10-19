import type { Metadata } from "next";
import { CalendarClock, CalendarX2, ShieldCheck } from "lucide-react";
import { BrowseControls, UPCOMING_SORTS } from "@/components/game/BrowseControls";
import { LinkSwitch, SegmentedControl } from "@/components/filters";
import { ReleaseTimeline } from "@/components/game/ReleaseTimeline";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { Pagination } from "@/components/ui/Pagination";
import { DataSourceNotice, SourceAttribution } from "@/components/ui/DataSourceNotice";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getGenres, getPlatforms, getUpcoming, isDegraded } from "@/lib/games/source";
import type { GameSummary, SortKey } from "@/lib/games/types";
import { releaseState } from "@/lib/games/release-state";
import { getDelayCounts } from "@/lib/games/release-history";
import { hypeIndexFor } from "@/lib/games/providers/igdb-extras";
import type { ReleaseSignals } from "@/components/game/ReleaseTimeline";

/**
 * Delay counts (our own D1 history) and hype index per row, fetched together.
 * Both are decoration: any failure yields no badges rather than a broken page,
 * and hype only exists for IGDB ids.
 */
async function releaseSignals(games: GameSummary[], igdb: boolean): Promise<ReleaseSignals> {
  if (games.length === 0) return {};
  const ids = games.map((game) => game.id);
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
    "A filterable, month-by-month calendar of upcoming video game releases with countdowns, platforms and critic scores.",
};

/**
 * 120 keeps the timeline useful across long release windows without
 * pushing a single page past a couple of hundred DOM-heavy rows.
 */
const PAGE_SIZE = 120;
const WINDOWS = [
  { value: "30", label: "30 days", detail: "Launching within the next month" },
  { value: "90", label: "90 days", detail: "The next three months of launches" },
  { value: "365", label: "12 months", detail: "The long-range calendar for the year ahead" },
  { value: "all", label: "All dated", detail: "Every future release with a date or window" },
  { value: "tba", label: "Date TBA", detail: "Announced, but no date given yet" },
] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function UpcomingPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const genres = first(sp.genres);
  const platforms = first(sp.platforms);
  const page = Math.max(1, Number(first(sp.page) ?? 1) || 1);
  const requestedWindow = first(sp.window);
  const timeframe = WINDOWS.some((item) => item.value === requestedWindow) ? requestedWindow! : "90";
  const defaultOrdering: SortKey = timeframe === "tba" ? "-hypes" : "released";
  const ordering = (first(sp.ordering) as SortKey | undefined) ?? defaultOrdering;
  // Notable-only is the default. Opting *out* is the explicit choice, because
  // the unfiltered calendar is two thirds shovelware and reads as broken.
  const showAll = first(sp.all) === "1";
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const rangeDays = timeframe === "all" || timeframe === "tba" ? null : Number(timeframe);
  const to = rangeDays
    ? new Date(today.getTime() + rangeDays * 86_400_000).toISOString().slice(0, 10)
    : null;
  const dates = to ? `${from},${to}` : undefined;

  const [{ data, source }, genreList, platformList] = await Promise.all([
    getUpcoming(PAGE_SIZE, page, {
      genres,
      platforms,
      dates,
      ordering,
      notableOnly: !showAll,
      releaseTiming: timeframe === "tba" ? "tba" : "dated",
    }),
    getGenres(),
    getPlatforms(),
  ]);

  const totalPages = data.count > 0 ? Math.ceil(data.count / PAGE_SIZE) : 1;
  // Final render-boundary guard. Provider output is normalized first, then
  // classified; no stale index row can leak a past title into this page.
  const games = data.results.filter((game) =>
    releaseState(game) === "upcoming" && (timeframe === "tba" ? game.tba : !game.tba),
  );
  const signals = await releaseSignals(games, source === "igdb");
  const exact = games.filter((game) => game.released).length;
  const windowed = games.filter((game) => game.releaseWindow).length;
  const tba = games.filter((game) => game.tba).length;
  const filtered = Boolean(genres || platforms);
  const activeWindow = WINDOWS.find((item) => item.value === timeframe) ?? WINDOWS[1];

  return (
    <>
      <PageHeader
        eyebrow="Release calendar"
        title="Only what is actually ahead."
        description="A verified future-only calendar built from IGDB precision data. Exact dates, honest release windows, and TBA announcements never masquerade as one another."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand" icon={<CalendarClock size={12} />}>
            {data.count.toLocaleString("en-US")} {filtered ? "matching records" : timeframe === "tba" ? "TBA records" : "scheduled records"}
          </Badge>
          <Badge tone="neon" icon={<ShieldCheck size={12} />}>Past releases blocked</Badge>
        </div>
      </PageHeader>

      <Container className="py-8 lg:py-12">
        {source === "unavailable" && (
          <div className="mb-7">
            <DataSourceNotice source={source} degraded={isDegraded(source)} />
          </div>
        )}

        {/*
          Page-level controls: which slice of the calendar, and whether to
          include the long tail. Both live in the URL, so they are links —
          drawn as a segmented control and a switch because that's what they
          are to the reader.
        */}
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 lg:w-[34rem]">
            <SegmentedControl
              label="Release horizon"
              value={timeframe}
              segments={WINDOWS.map((item) => ({
                value: item.value,
                label: item.label,
                title: item.detail,
                href: upcomingHref({ genres, platforms, timeframe: item.value, showAll }),
              }))}
            />
            <p className="mt-2 px-1 text-[12px] text-faint">{activeWindow.detail}</p>
          </div>
          {/*
            An honest escape hatch rather than a hidden filter. The default
            hides roughly two thirds of the calendar, so it has to say so and
            offer the way back.
          */}
          <LinkSwitch
            href={upcomingHref({ genres, platforms, ordering, timeframe, showAll: !showAll })}
            checked={showAll}
            label="Every announced game"
            description={showAll ? "Showing the full, unfiltered calendar" : "Hiding titles nobody is tracking yet"}
            className="self-start lg:self-auto"
          />
        </div>

        <div className="mb-6 grid grid-cols-3 gap-2.5">
          <AccuracyMetric label="Exact dates" value={exact} />
          <AccuracyMetric label="Release windows" value={windowed} />
          <AccuracyMetric label="Date TBA" value={tba} />
        </div>

        <BrowseControls
          genres={genreList.data}
          platforms={platformList.data}
          totalCount={data.count}
          sorts={UPCOMING_SORTS}
          defaultSort={defaultOrdering}
          noun="release"
          showDatePresets={false}
          showScore={false}
        />

        <div className="mt-9">
          {games.length === 0 ? (
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

        <div className="mt-10">
          <SourceAttribution source={source} />
        </div>
      </Container>
    </>
  );
}

function upcomingHref({
  genres,
  platforms,
  ordering,
  timeframe,
  showAll,
}: {
  genres?: string;
  platforms?: string;
  ordering?: SortKey;
  timeframe: string;
  showAll: boolean;
}) {
  const params = new URLSearchParams();
  if (genres) params.set("genres", genres);
  if (platforms) params.set("platforms", platforms);
  const defaultOrdering = timeframe === "tba" ? "-hypes" : "released";
  if (ordering && ordering !== defaultOrdering) params.set("ordering", ordering);
  if (timeframe !== "90") params.set("window", timeframe);
  if (showAll) params.set("all", "1");
  const query = params.toString();
  return query ? `/upcoming?${query}` : "/upcoming";
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
      title={tba ? "No TBA announcements found" : "Nothing scheduled right now"}
      body={
        tba
          ? "Try including every announced game, or return to the dated calendar."
          : showAll
          ? "The calendar will fill in as studios announce dates."
          : "Nothing with a following is dated yet. The full calendar includes every announced game, most of which nobody is tracking."
      }
      action={showAll ? undefined : { href: tba ? "/upcoming?window=tba&all=1" : "/upcoming?all=1", label: "Include every game" }}
      secondaryAction={{ href: "/browse", label: "Browse released games" }}
    />
  );
}

function AccuracyMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-fg/[0.025] p-3 sm:p-4">
      <p className="font-display text-xl font-black tabular-nums sm:text-2xl">{value}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase leading-tight tracking-[0.05em] text-faint sm:truncate sm:tracking-[0.06em]">{label}</p>
    </div>
  );
}
