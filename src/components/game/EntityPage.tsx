import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck2, ChevronLeft, History } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { EntityGameExplorer } from "@/components/game/EntityGameExplorer";
import { CareerStats } from "@/components/charts/CareerStats";
import { ReleaseTimeline } from "@/components/charts/ReleaseTimeline";
import { Container, SectionHeading } from "@/components/ui/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import { ExpandableText } from "@/components/ui/ExpandableText";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils/cn";
import { isIgdbImage } from "@/lib/games/image";
import { summarizeCareer, toTimelineGames } from "@/lib/games/timeline";
import type { IgdbEntity } from "@/lib/games/providers/igdb";
import { studioReliability } from "@/lib/games/reliability";
import type { GameSummary, StudioReliability } from "@/lib/games/types";

type EntityKind = "company" | "character" | "franchise";

/** Fewer than this many dated games is a list, not a timeline. */
const MIN_TIMELINE_GAMES = 3;

const COPY: Record<
  EntityKind,
  { directory: [href: string, label: string]; glance: string; timeline: string; games: [eyebrow: string, title: string] }
> = {
  company: {
    directory: ["/studios", "All studios"],
    glance: "Career",
    timeline: "A career in releases",
    games: ["Studio catalogue", "Games"],
  },
  franchise: {
    directory: ["/franchises", "All franchises"],
    glance: "Series",
    timeline: "The series over time",
    games: ["Complete collection", "Every game"],
  },
  character: {
    directory: ["/browse", "Browse games"],
    glance: "Appearances",
    timeline: "Appearances over time",
    games: ["Gameography", "Appears in"],
  },
};

export async function EntityPage({
  entity,
  kind,
  eyebrow,
}: {
  entity: IgdbEntity | null;
  kind: EntityKind;
  eyebrow: string;
}) {
  if (!entity) notFound();

  const copy = COPY[kind];
  const collectionPage = kind === "franchise";
  const hasMark = Boolean(entity.image) && !collectionPage;

  // Server clock; the chart re-judges exact dates against the viewer's own.
  const now = new Date();
  const summary = summarizeCareer(entity.games, now);
  const timeline = toTimelineGames(entity.games, now);
  const firstYear = summary.firstRelease?.released?.slice(0, 4) ?? null;
  const latestYear = summary.latestRelease?.released?.slice(0, 4) ?? null;
  const backdrop = backdropFor(entity, kind);
  // Studios only: our own delay history for their games. Enrichment — an
  // unavailable D1 resolves to an empty record, never a failed page.
  const reliability = kind === "company"
    ? await studioReliability(entity.games.map((game) => game.id)).catch(() => null)
    : null;

  return (
    <>
      <header className="noise relative isolate overflow-hidden border-b border-line">
        {/*
          Key art from the entity's best-known game, heavily blurred — the hero
          takes on the colour of the work without competing with the title.
          Studios and characters previously sat on a flat gradient.
        */}
        {backdrop && (
          <div aria-hidden className="absolute inset-0 -z-20">
            <Image
              src={backdrop}
              alt=""
              fill
              priority
              sizes="100vw"
              unoptimized={isIgdbImage(backdrop)}
              className="scale-110 object-cover opacity-40 blur-[6px] saturate-[1.15]"
            />
          </div>
        )}
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_80%_at_75%_20%,rgba(138,114,255,0.22),transparent_65%)]" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-bg via-bg/85 to-bg/45" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-bg/90 via-bg/60 to-transparent" />

        <Container className="pb-9 pt-20 sm:pt-24 lg:pb-14 lg:pt-32">
          <Reveal>
            <Link
              href={copy.directory[0]}
              className="material-thin press mb-7 inline-flex h-9 items-center gap-1 rounded-full pl-2.5 pr-3.5 text-[13px] font-medium text-text/90 transition-colors fine:hover:text-text sm:mb-9"
            >
              <ChevronLeft size={16} className="text-brand-soft" />
              {copy.directory[1]}
            </Link>
          </Reveal>

          <div className={cn("grid items-end gap-8", collectionPage && "lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14")}>
            <div className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
              {hasMark && (
                <Reveal
                  direction="right"
                  className={cn(
                    "relative shrink-0 overflow-hidden rounded-[1.75rem] shadow-[0_35px_90px_-34px_rgba(0,0,0,0.95)] light:shadow-[0_28px_60px_-30px_rgba(0,0,0,0.4)] ring-1 ring-fg/15",
                    kind === "company"
                      ? // Logos are drawn for light paper; a near-white plate keeps dark marks legible.
                        "grid h-28 w-28 place-items-center bg-white/[0.96] p-4 sm:h-40 sm:w-40"
                      : "aspect-[3/4] w-28 sm:w-44",
                  )}
                >
                  {/*
                    `fill` for both kinds. A company logo previously rendered at
                    its intrinsic 180px inside a 128/160px `overflow-hidden` box,
                    so every studio mark was cropped; `fill` + `object-contain`
                    scales it to the box instead.
                  */}
                  <Image
                    src={entity.image!}
                    alt={entity.name}
                    fill
                    sizes="176px"
                    unoptimized={isIgdbImage(entity.image)}
                    className={kind === "company" ? "object-contain p-3 sm:p-4" : "object-cover"}
                  />
                </Reveal>
              )}

              <div className="min-w-0 flex-1">
                <Reveal>
                  <p className="mb-2.5 text-[13px] font-semibold text-brand-soft sm:text-sm">{eyebrow}</p>
                  <h1 className="max-w-4xl break-words font-display text-[clamp(2.25rem,8vw,5.25rem)] font-black leading-[0.98] tracking-[-0.045em] text-text">
                    {entity.name}
                  </h1>
                </Reveal>

                <Reveal delay={0.1} className="mt-5 flex flex-wrap items-center gap-2">
                  {entity.detail && <Badge tone="neutral">{entity.detail}</Badge>}
                  <Badge tone="brand">
                    {entity.games.length} {entity.games.length === 1 ? "game" : "games"}
                  </Badge>
                  {firstYear && latestYear && (
                    <Badge>{firstYear === latestYear ? firstYear : `${firstYear}–${latestYear}`}</Badge>
                  )}
                  {summary.upcomingCount > 0 && (
                    <Badge tone="neon">{summary.upcomingCount} upcoming</Badge>
                  )}
                </Reveal>
              </div>
            </div>

            {collectionPage && <FranchisePosterStack games={entity.games} />}
          </div>

          {entity.description && (
            <Reveal delay={0.14} className="mt-7 max-w-3xl">
              <ExpandableText
                text={entity.description}
                paragraphClassName="text-[15px] leading-[1.75] text-muted"
              />
            </Reveal>
          )}
        </Container>
      </header>

      <Container className="space-y-14 py-10 sm:space-y-16 lg:space-y-20 lg:py-16">
        {entity.games.length > 0 && (
          <section aria-label={`${copy.glance} at a glance`}>
            <SectionHeading eyebrow={copy.glance} title="At a glance" className="mb-5 sm:mb-7" />
            <CareerStats summary={summary} kind={kind} />
          </section>
        )}

        {reliability && entity.games.length > 0 && (
          <section aria-label="Shipping reliability">
            <SectionHeading eyebrow="Release dates" title="Shipping reliability" className="mb-5 sm:mb-7" />
            <ReliabilityCard data={reliability} studio={entity.name} now={now} />
          </section>
        )}

        {timeline.length >= MIN_TIMELINE_GAMES && (
          <section aria-label="Release timeline">
            <SectionHeading
              eyebrow="Timeline"
              title={copy.timeline}
              description="Every dated game by release and critic score. Hover or tap a dot for details."
              className="mb-5 sm:mb-7"
            />
            <Reveal blur={false}>
              <ReleaseTimeline games={timeline} subject={entity.name} undatedCount={entity.games.length - timeline.length} />
            </Reveal>
          </section>
        )}

        <section aria-label={copy.games[1]}>
          <SectionHeading
            eyebrow={copy.games[0]}
            title={collectionPage ? `Explore ${entity.name}` : copy.games[1]}
            description="Search the collection or sort it to find exactly what you want."
            className="mb-5 sm:mb-7"
          />

          {entity.games.length > 0 ? (
            <EntityGameExplorer games={entity.games} kind={kind} />
          ) : (
            <p className="rounded-3xl border border-dashed border-line py-16 text-center text-sm text-muted">
              IGDB has no games linked to this entry yet.
            </p>
          )}
        </section>
      </Container>
    </>
  );
}

/**
 * Hero backdrop. A franchise already resolves to its lead cover; studios and
 * characters borrow a screenshot from their most-engaged game, which is the
 * art a visitor is most likely to recognise.
 */
function backdropFor(entity: IgdbEntity, kind: EntityKind): string | null {
  if (kind === "franchise" && entity.image) return entity.image;
  const lead = [...entity.games]
    .filter((game) => game.screenshots.length > 0 || game.image)
    .sort((a, b) => b.added - a.added)[0];
  return lead?.screenshots[0] ?? lead?.image ?? null;
}

function FranchisePosterStack({ games }: { games: GameSummary[] }) {
  const posters = games.filter((game) => game.image).slice(0, 3);
  if (posters.length === 0) return null;

  return (
    <Reveal direction="left" delay={0.08} className="relative hidden h-72 lg:block">
      {posters.map((game, index) => (
        <div
          key={game.id}
          className="absolute bottom-0 aspect-[3/4] w-40"
          style={{
            left: `${index * 92}px`,
            zIndex: index + 1,
            transform: `rotate(${(index - 1) * 4}deg) translateY(${Math.abs(index - 1) * 12}px)`,
          }}
        >
          <Link
            href={`/game/${game.slug}`}
            aria-label={game.name}
            className="relative block h-full w-full overflow-hidden rounded-2xl border border-fg/20 bg-panel shadow-[0_35px_70px_-25px_rgba(0,0,0,0.95)] light:shadow-[0_28px_56px_-28px_rgba(0,0,0,0.42)] transition-transform duration-500 ease-[var(--ease-apple)] hover:-translate-y-2 hover:scale-[1.02]"
          >
            <GameCover
              name={game.name}
              slug={game.slug}
              image={game.image}
              imageFallback={game.imageFallback}
              width={420}
              sizes="160px"
            />
            <span className="absolute inset-0 ring-1 ring-inset ring-fg/10" />
          </Link>
        </div>
      ))}
    </Reveal>
  );
}

const TRACKING_SINCE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Below this many watched games, or this many days of watching, a percentage
 * would be noise dressed as a fact: a date can only slip while we're looking.
 */
const MIN_TRACKED_FOR_RATE = 3;
const MIN_DAYS_FOR_RATE = 30;

/**
 * How often this studio's announced dates have held, from Arnav Games' own
 * delay tracker. Only what we have observed counts, so the card always says
 * how many games and since when — and while that history is young it says
 * so instead of printing a confident-looking 100%.
 */
function ReliabilityCard({ data, studio, now }: { data: StudioReliability; studio: string; now: Date }) {
  const since = data.since ? TRACKING_SINCE.format(new Date(`${data.since}T00:00:00Z`)) : null;
  const watchedDays = data.since ? (now.getTime() - Date.parse(`${data.since}T00:00:00Z`)) / 86_400_000 : 0;

  if (data.tracked < MIN_TRACKED_FOR_RATE || watchedDays < MIN_DAYS_FOR_RATE) {
    return (
      <div className="flex flex-col gap-4 rounded-3xl border border-dashed border-line px-5 py-6 sm:flex-row sm:items-center sm:px-7">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-fg/[0.05] text-faint">
          <History size={22} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[17px] font-semibold">Too early to call</p>
          <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-muted">
            {data.tracked === 0
              ? `We haven't watched any ${studio} release dates long enough to judge yet. Every date we show is recorded, so this fills in as their games appear on the calendar.`
              : `We've watched ${data.tracked} ${data.tracked === 1 ? "game" : "games"} from ${studio}${since ? ` since ${since}` : ""} — not long enough for a fair rate yet. ${data.delayed ? `${data.delayed} ${data.delayed === 1 ? "has" : "have"} already moved later.` : "None has moved later so far."} A reliability score appears after a month of history.`}
          </p>
        </div>
      </div>
    );
  }

  const onTime = Math.round(((data.tracked - data.delayed) / data.tracked) * 100);
  const tone = onTime >= 85 ? "text-mint" : onTime >= 60 ? "text-gold" : "text-flare";
  return (
    <div className="glass overflow-hidden rounded-3xl p-5 sm:p-7">
      <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-10">
        <div>
          <p className="flex items-baseline gap-1">
            <span className={cn("font-display text-[64px] font-bold leading-none tracking-[-0.04em] tabular-nums", tone)}>{onTime}</span>
            <span className={cn("font-display text-[28px] font-bold", tone)}>%</span>
          </p>
          <p className="mt-2 text-[15px] text-muted">kept their announced date</p>
        </div>
        <dl className="grid grid-cols-3 gap-2">
          <ReliabilityTile icon={<CalendarCheck2 size={14} />} label="Watched" value={String(data.tracked)} note={data.tracked === 1 ? "game" : "games"} />
          <ReliabilityTile icon={<History size={14} />} label="Delayed" value={String(data.delayed)} note={data.delayed === 1 ? "game slipped" : "games slipped"} />
          <ReliabilityTile
            label="Avg. slip"
            value={data.avgDaysLate === null ? "—" : String(data.avgDaysLate)}
            note={data.avgDaysLate === null ? (data.delayed ? "not measurable" : "no delays") : data.avgDaysLate === 1 ? "day late" : "days late"}
          />
        </dl>
      </div>
      <p className="mt-5 border-t border-line pt-4 text-[13px] leading-relaxed text-faint">
        From Arnav Games&apos; own release-date history{since ? `, tracking since ${since}` : ""}. A game counts as delayed when its date or window moved later while we were watching; games we&apos;ve only seen once can&apos;t have slipped yet, so young histories read kinder than they may be.
      </p>
    </div>
  );
}

function ReliabilityTile({ icon, label, value, note }: { icon?: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-fg/[0.045] p-3">
      <dt className="flex items-center gap-1 truncate text-[12px] font-medium text-muted">
        {icon && <span aria-hidden className="text-faint">{icon}</span>}
        {label}
      </dt>
      <dd className="mt-1">
        <span className="font-display text-[24px] font-bold leading-none tabular-nums">{value}</span>
        <span className="mt-0.5 block truncate text-[11px] text-faint">{note}</span>
      </dd>
    </div>
  );
}
