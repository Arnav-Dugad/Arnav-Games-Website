"use client";

/**
 * "What players think": the verdicts (critics, Steam buyers, IGDB members),
 * how they've moved (critic score over time, review velocity), and what the
 * developers have changed since (latest updates).
 *
 * Every history block is our own recording, so each says since when, and
 * each hides entirely when there's nothing to draw — a chart of one day is a
 * dot, not a trend.
 */

import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Newspaper, Star, Wrench } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Skeleton } from "@/components/ui/Skeleton";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import { compactNumber, formatDate } from "@/lib/utils/format";
import type { PatchNote, UpdatePost } from "@/lib/games/types";
import type { GameIds } from "./endpoint";
import { useReviewVelocity, useScoreTimeline } from "./history";
import { InfoTip } from "./InfoTip";
import { useInsightPart, useLiveField } from "./live";
import { ScoreSpreadView } from "./ScoreSpread";
import { TimeChart } from "./TimeChart";

const full = new Intl.NumberFormat("en-US");
const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const AXIS_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const DAY_MS = 86_400_000;

const reviewColor = (percent: number) =>
  percent >= 70 ? "var(--color-mint)" : percent >= 40 ? "var(--color-gold)" : "var(--color-flare)";

/* ------------------------------------------------------------------------ */

export interface ScoresData {
  /** `count`: critic reviews in the aggregate (IGDB), null when unknown (Metacritic). */
  critic: { score: number | null; label: string; caption: string; count?: number | null };
  userRating: { rating: number; count: number } | null;
  hasSteam: boolean;
  links: { openCritic: string | null; metacritic: string | null };
}

/** The three verdicts side by side, each with what it means. */
export function ScoresSummary({ data }: { data: ScoresData }) {
  const reviews = useLiveField((live) => live.steamReviews);
  const { critic, userRating } = data;
  const steam = data.hasSteam && reviews.state !== "empty";
  if (critic.score === null && !userRating && !steam) return null;
  const outLinks = [
    data.links.openCritic ? { label: "OpenCritic", url: data.links.openCritic, icon: null } : null,
    data.links.metacritic ? { label: "Metacritic", url: data.links.metacritic, icon: "metacritic" } : null,
  ].filter((link): link is NonNullable<typeof link> => link !== null);

  return (
    <div className="glass rounded-3xl">
      <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3">
        {critic.score !== null && (
          <div className="flex items-center gap-4 p-5 sm:p-6">
            <ScoreRing score={critic.score} size={72} strokeWidth={6} label={critic.label} />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[15px] font-semibold text-text">
                Critics <InfoTip topic="critic" />
              </p>
              <p className="mt-0.5 text-[13px] text-muted">{critic.caption}</p>
            </div>
          </div>
        )}
        {steam && (
          <div className="min-w-0 p-5 sm:p-6">
            <p className="flex items-center gap-1.5 text-[15px] font-semibold text-text">
              <BrandIcon name="steam" size={14} title={null} /> Steam buyers <InfoTip topic="steamReviews" />
            </p>
            {reviews.state === "loading" ? (
              <div aria-hidden className="mt-2.5 space-y-2.5">
                <Skeleton className="h-6 w-36 rounded-full" />
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ) : (
              <>
                <p className="mt-1.5 text-[19px] font-bold leading-tight" style={{ color: reviewColor(reviews.value.percent) }}>
                  {reviews.value.description || `${reviews.value.percent}% positive`}
                </p>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-fg/10" aria-hidden>
                  <div className="h-full rounded-full" style={{ width: `${reviews.value.percent}%`, background: reviewColor(reviews.value.percent) }} />
                </div>
                <p className="mt-1.5 text-[13px] tabular-nums text-muted">
                  {reviews.value.percent}% of {compactNumber(reviews.value.total)} reviews recommend it
                </p>
                {reviews.value.recent && (
                  <p className="mt-1 text-[13px] tabular-nums text-muted">
                    Last 30 days:{" "}
                    <span className="font-semibold" style={{ color: reviewColor(reviews.value.recent.percent) }}>
                      {reviews.value.recent.percent}%
                    </span>{" "}
                    of {compactNumber(reviews.value.recent.total)}
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {userRating && (
          <div className="min-w-0 p-5 sm:p-6">
            <p className="flex items-center gap-1.5 text-[15px] font-semibold text-text">
              IGDB members <InfoTip topic="playerRating" />
            </p>
            <p className="mt-1.5 flex items-baseline gap-1.5">
              <Star size={16} aria-hidden className="shrink-0 translate-y-0.5 fill-gold text-gold" />
              <span className="font-display text-[26px] font-bold leading-none tabular-nums text-text">{userRating.rating.toFixed(1)}</span>
              <span className="text-[13px] font-semibold text-muted">/5</span>
            </p>
            {userRating.count > 0 && <p className="mt-1.5 text-[13px] text-muted">{compactNumber(userRating.count)} ratings</p>}
          </div>
        )}
      </div>
      {data.hasSteam && reviews.state === "loading" && critic.score !== null ? (
        // Holds the spread's place until Steam answers, so nothing below jumps.
        <div aria-hidden className="space-y-3 border-t border-line px-5 py-5 sm:px-6">
          <Skeleton className="h-4 w-52 rounded-full" />
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-10 w-3/4 rounded-xl" />
        </div>
      ) : (
        <ScoreSpreadView
          input={{
            critic: critic.score !== null ? { score: critic.score, count: critic.count ?? null } : null,
            members: userRating ? { score: userRating.rating * 20, count: userRating.count } : null,
            steam: reviews.state === "ready" ? { percent: reviews.value.percent, total: reviews.value.total } : null,
            recent: reviews.state === "ready" && reviews.value.recent ? { percent: reviews.value.recent.percent, total: reviews.value.recent.total } : null,
          }}
        />
      )}
      {outLinks.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-line px-5 py-3.5 sm:px-6">
          <li className="self-center text-[13px] text-muted">Read the reviews:</li>
          {outLinks.map((link) => (
            <li key={link.label}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="press inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-fg/[0.04] px-3.5 text-[13px] font-medium text-text transition-colors fine:hover:border-line-strong"
              >
                {link.icon && <BrandIcon name={link.icon} size={13} title={null} />}
                {link.label}
                <ArrowUpRight size={13} className="text-faint" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * Review velocity and the critic score's drift, as one "how opinion moved"
 * card. Either half shows only when it has two or more days to draw.
 */
export function OpinionTrends({ ids, igdbId, launch }: { ids: GameIds; igdbId: number | null; launch: string | null }) {
  // Both read straight from Firestore (no Worker request).
  const velocity = useReviewVelocity(ids.steam, launch);
  // Critic scores are keyed by IGDB id; a Steam-only title's id is an appid.
  const scores = useScoreTimeline(igdbId);
  const launchMs = launch ? Date.parse(`${launch}T00:00:00Z`) : null;

  const reviewPoints = useMemo(
    () => (velocity.status === "ready" ? velocity.data.points.map((point) => ({ t: point.t * 1000, v: point.total })) : []),
    [velocity],
  );
  const scorePoints = useMemo(
    () => (scores.status === "ready" ? scores.data.points.map((point) => ({ t: Date.parse(`${point.date}T00:00:00Z`), v: point.score })) : []),
    [scores],
  );

  const v = velocity.status === "ready" ? velocity.data : null;
  const hasVelocity = Boolean(v && (v.perDay !== null || v.first72h || reviewPoints.length >= 2));
  const hasScores = scorePoints.length >= 2;
  if (velocity.status === "loading" && scores.status === "loading") {
    return <Skeleton className="h-[220px] w-full rounded-3xl" />;
  }
  if (!hasVelocity && !hasScores) return null;

  const dayOf = (t: number) => (launchMs !== null ? Math.round((t - launchMs) / DAY_MS) : null);
  const sinceLaunch = (t: number) => {
    const day = dayOf(t);
    return day === null ? DAY_FMT.format(new Date(t)) : day <= 0 ? `Launch day · ${AXIS_DAY.format(new Date(t))}` : `Day ${day} · ${AXIS_DAY.format(new Date(t))}`;
  };

  return (
    <div className={cn("grid gap-4", hasVelocity && hasScores && "lg:grid-cols-2")}>
      {hasVelocity && v && (
        <div className="glass rounded-3xl p-5 sm:p-6">
          <h3 className="text-[17px] font-semibold text-text">How fast reviews arrive</h3>
          {v.since && <p className="mt-0.5 text-[13px] text-muted">Steam review totals, tracked since {DAY_FMT.format(new Date(`${v.since.slice(0, 10)}T00:00:00Z`))}</p>}
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
            {v.perDay !== null && (
              <div>
                <dt className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                  Reviews per day <InfoTip topic="reviewsPerDay" />
                </dt>
                <dd className="mt-1 font-display text-[28px] font-bold leading-none tabular-nums text-text">{full.format(Math.round(v.perDay))}</dd>
              </div>
            )}
            {v.first72h && (
              <div>
                <dt className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                  First 3 days <InfoTip topic="first72h" />
                </dt>
                <dd className="mt-1 flex items-baseline gap-2">
                  <span className="font-display text-[28px] font-bold leading-none tabular-nums text-text">{compactNumber(v.first72h.reviews)}</span>
                  <span className="text-[13px] font-semibold" style={{ color: reviewColor(v.first72h.positivePct) }}>
                    {Math.round(v.first72h.positivePct)}% positive
                  </span>
                </dd>
              </div>
            )}
          </dl>
          {reviewPoints.length >= 2 && (
            <TimeChart
              className="mt-5"
              points={reviewPoints}
              height={150}
              formatValue={(value) => `${full.format(Math.round(value))} reviews in total`}
              formatTick={(value) => compactNumber(Math.round(value))}
              formatTime={(t) => DAY_FMT.format(new Date(t))}
              formatAxisTime={(t) => AXIS_DAY.format(new Date(t))}
              label="Total Steam reviews over time"
              summary={`Steam reviews grew from ${full.format(reviewPoints[0].v)} to ${full.format(reviewPoints[reviewPoints.length - 1].v)} between ${DAY_FMT.format(new Date(reviewPoints[0].t))} and ${DAY_FMT.format(new Date(reviewPoints[reviewPoints.length - 1].t))}.`}
            />
          )}
        </div>
      )}
      {hasScores && (
        <div className="glass rounded-3xl p-5 sm:p-6">
          <h3 className="flex items-center gap-1.5 text-[17px] font-semibold text-text">
            Critic score over time <InfoTip topic="scoreTimeline" />
          </h3>
          <p className="mt-0.5 text-[13px] text-muted">
            {scorePoints[0].v === scorePoints[scorePoints.length - 1].v
              ? `Steady at ${scorePoints[0].v}`
              : `${scorePoints[0].v} → ${scorePoints[scorePoints.length - 1].v}`}
            {launchMs !== null && dayOf(scorePoints[scorePoints.length - 1].t) !== null && ` over ${Math.max(1, dayOf(scorePoints[scorePoints.length - 1].t)!)} days since launch`}
          </p>
          <TimeChart
            className="mt-5"
            points={scorePoints}
            step
            height={150}
            yMax={100}
            formatValue={(value) => `${Math.round(value)} / 100`}
            formatTick={(value) => String(Math.round(value))}
            formatTime={sinceLaunch}
            formatAxisTime={(t) => {
              const day = dayOf(t);
              return day === null ? AXIS_DAY.format(new Date(t)) : day <= 0 ? "Launch" : `Day ${day}`;
            }}
            label="Critic score over time"
            summary={`Critic score from ${scorePoints[0].v} to ${scorePoints[scorePoints.length - 1].v} across ${scorePoints.length} daily observations.`}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * "Updates": the developers' recent posts as a timeline — patches condensed
 * to what changed, everything else (events, roadmaps, news) as an excerpt —
 * with a filter for patch notes alone. One feed, so nothing appears twice.
 *
 * Answers cached before the timeline existed carry patches only; those (and
 * games whose feed failed) keep the older layout: patch cards, else Steam
 * news.
 */
export function LatestUpdates({ ids, expected }: { ids: GameIds; expected: boolean }) {
  const patches = useInsightPart(ids.steam ? ids : null, "patches") ?? ({ status: "missing" } as const);
  const updates = useInsightPart(ids.steam ? ids : null, "updates") ?? ({ status: "missing" } as const);
  const news = useLiveField((live) => live.news);
  const [showAll, setShowAll] = useState(false);
  const notes = patches.status === "ready" ? patches.data.filter((note) => note.highlights.length > 0 || note.totalItems > 0) : [];

  if (updates.status === "ready" && updates.data.length > 0) {
    return <UpdatesTimeline posts={updates.data} notes={patches.status === "ready" ? patches.data : []} />;
  }

  if (notes.length > 0) {
    return (
      <div>
        <h3 className="flex items-center gap-2 text-[17px] font-semibold text-text">
          <Wrench size={16} aria-hidden className="text-[var(--game-accent)]" /> Latest updates
        </h3>
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {notes.slice(0, showAll ? 4 : 2).map((note) => (
            <li key={note.url} className="min-w-0">
              <PatchCard note={note} />
            </li>
          ))}
        </ul>
        {notes.length > 2 && !showAll && (
          <button
            type="button"
            onClick={() => {
              haptic("selection");
              setShowAll(true);
            }}
            className="press mt-3 inline-flex min-h-11 items-center rounded-full bg-fg/[0.07] px-4 text-[13px] font-semibold text-text fine:hover:bg-fg/[0.12]"
          >
            Show {Math.min(4, notes.length) - 2} older {Math.min(4, notes.length) - 2 === 1 ? "update" : "updates"}
          </button>
        )}
      </div>
    );
  }
  // Waiting on patches, or none: news is the fallback (and its own skeleton).
  if (patches.status === "loading" && ids.steam) return <Skeleton className="h-[180px] w-full rounded-3xl" />;
  if (news.state === "empty" || (news.state === "loading" && !expected)) return null;
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[17px] font-semibold text-text">
        <Newspaper size={16} aria-hidden className="text-[var(--game-accent)]" /> Latest news
      </h3>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {news.state === "loading"
          ? Array.from({ length: 2 }, (_, index) => (
              <li key={index} aria-hidden className="glass rounded-3xl p-5">
                <Skeleton className="h-3 w-24 rounded-full" />
                <Skeleton className="mt-3 h-5 w-4/5 rounded-full" />
                <Skeleton className="mt-3 h-3 w-full rounded-full" />
              </li>
            ))
          : news.value.slice(0, 4).map((item) => (
              <li key={item.url}>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="glass group flex h-full flex-col rounded-3xl p-5 transition-transform duration-500 fine:hover:-translate-y-0.5"
                >
                  <p className="flex items-center gap-2 text-[12px] text-faint">
                    <time dateTime={item.date}>{formatDate(item.date.slice(0, 10))}</time>
                    {item.source && <span className="truncate">· {item.source}</span>}
                  </p>
                  <h4 className="mt-2 line-clamp-2 text-[15px] font-bold leading-snug text-text">{item.title}</h4>
                  {item.excerpt && <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-muted">{item.excerpt}</p>}
                  <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[13px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))]">
                    Read on Steam <ArrowUpRight size={13} />
                  </span>
                </a>
              </li>
            ))}
      </ul>
    </div>
  );
}

type UpdateFilter = "all" | "patch" | "news";
const TIMELINE_STEP = 4;
const NINETY_DAYS_MS = 90 * DAY_MS;

function ago(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.round(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

function UpdatesTimeline({ posts, notes }: { posts: UpdatePost[]; notes: PatchNote[] }) {
  const [filter, setFilter] = useState<UpdateFilter>("all");
  const [count, setCount] = useState(TIMELINE_STEP);
  // The data arrives client-side, so this clock never meets server HTML.
  const [now] = useState(() => Date.now());
  const byUrl = useMemo(() => new Map(notes.map((note) => [note.url, note])), [notes]);

  const patchCount = posts.filter((post) => post.patch).length;
  const mixed = patchCount > 0 && patchCount < posts.length;
  const visible = posts.filter((post) => filter === "all" || (filter === "patch") === post.patch);
  const shown = visible.slice(0, count);
  const lastPatch = posts.find((post) => post.patch);
  // A count "in the last 90 days" is only true if the feed reaches back that far.
  const reachesBack = posts.length < 12 || now - Date.parse(posts[posts.length - 1].date) > NINETY_DAYS_MS;
  const recentPatches = posts.filter((post) => post.patch && now - Date.parse(post.date) <= NINETY_DAYS_MS).length;

  const filters: Array<{ key: UpdateFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "patch", label: "Patch notes" },
    { key: "news", label: "News" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[17px] font-semibold text-text">
            <Wrench size={16} aria-hidden className="text-[var(--game-accent)]" /> Updates
          </h3>
          <p className="mt-0.5 text-[13px] text-muted">
            {lastPatch ? (
              <>
                Last patched {ago(lastPatch.date, now)}
                {reachesBack && recentPatches > 1 && ` · ${recentPatches} patches in the last 90 days`}
              </>
            ) : (
              "Developer posts on Steam"
            )}
          </p>
        </div>
        {mixed && (
          <div role="radiogroup" aria-label="Show" className="flex rounded-full border border-line bg-fg/[0.05] p-0.5">
            {filters.map((option) => (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={filter === option.key}
                onClick={() => {
                  haptic("selection");
                  setFilter(option.key);
                  setCount(TIMELINE_STEP);
                }}
                className={cn(
                  "press inline-flex min-h-9 items-center rounded-full px-3 text-[13px] font-medium transition-colors coarse:min-h-11",
                  filter === option.key ? "bg-panel text-text shadow-sm" : "text-muted fine:hover:text-text",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The rail: one line down the left, a dot per post — accent for patches. */}
      <ol className="relative mt-5 space-y-6 before:absolute before:bottom-3 before:left-[6px] before:top-3 before:w-px before:bg-line">
        {shown.map((post) => {
          const note = post.patch ? byUrl.get(post.url) : undefined;
          return (
            <li key={post.url} className="relative pl-7">
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 top-[5px] h-[13px] w-[13px] rounded-full ring-4 ring-[var(--color-bg)]",
                  post.patch ? "bg-[var(--game-accent,var(--color-brand))]" : "bg-fg/25",
                )}
              />
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
                <time dateTime={post.date}>{formatDate(post.date.slice(0, 10))}</time>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]",
                    post.patch
                      ? "bg-[color-mix(in_oklab,var(--game-accent,var(--color-brand))_16%,transparent)] text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))]"
                      : "bg-fg/[0.07] text-muted",
                  )}
                >
                  {post.patch ? "Patch notes" : "News"}
                </span>
              </p>
              <h4 className="mt-1.5 break-words text-[15px] font-bold leading-snug text-text">{post.title}</h4>
              {note && (note.highlights.length > 0 || note.totalItems > 0) ? (
                <PatchBody note={note} />
              ) : (
                <>
                  {post.excerpt && <p className="mt-1.5 line-clamp-3 break-words text-[13px] leading-relaxed text-muted">{post.excerpt}</p>}
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex min-h-10 items-center gap-1 text-[13px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))]"
                  >
                    Read on Steam <ArrowUpRight size={13} />
                  </a>
                </>
              )}
            </li>
          );
        })}
      </ol>

      {visible.length > count && (
        <button
          type="button"
          onClick={() => {
            haptic("selection");
            setCount((value) => value + TIMELINE_STEP);
          }}
          className="press mt-4 inline-flex min-h-11 items-center rounded-full bg-fg/[0.07] px-4 text-[13px] font-semibold text-text fine:hover:bg-fg/[0.12]"
        >
          Show {Math.min(TIMELINE_STEP, visible.length - count)} older
        </button>
      )}
    </div>
  );
}

function PatchCard({ note }: { note: PatchNote }) {
  return (
    <article className="glass flex h-full flex-col rounded-3xl p-5">
      <p className="text-[12px] text-faint">
        <time dateTime={note.date}>{formatDate(note.date.slice(0, 10))}</time>
      </p>
      <h4 className="mt-1.5 text-[15px] font-bold leading-snug text-text">{note.title}</h4>
      <PatchBody note={note} card />
    </article>
  );
}

/** A patch's headline bullets, the full grouped list a tap away, and the link out. */
function PatchBody({ note, card = false }: { note: PatchNote; card?: boolean }) {
  const [open, setOpen] = useState(false);
  // Three bullets read at a glance; the rest (and the grouped full list) are a tap away.
  const highlights = note.highlights.slice(0, 3);
  // Without grouped sections, "more" is simply the rest of the highlights.
  const grouped = note.sections.filter((section) => section.items.length > 0);
  const more = grouped.length > 0 ? Math.max(0, note.totalItems - highlights.length) : note.highlights.length - highlights.length;
  const expanded = grouped.length > 0 ? grouped : [{ heading: "", items: note.highlights }];
  const expandable = more > 0;
  return (
    <>
      {!open && highlights.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {highlights.map((item, index) => (
            <li key={index} className="flex gap-2 text-[13px] leading-snug text-muted">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--game-accent)]" />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="mt-3 space-y-3">
          {expanded.map((section, index) => (
            <div key={`${section.heading}-${index}`}>
              {section.heading && <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{section.heading}</p>}
              <ul className="mt-1.5 space-y-1.5">
                {section.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="flex gap-2 text-[13px] leading-snug text-muted">
                    <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-fg/30" />
                    <span className="min-w-0 break-words">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div className={cn("flex flex-wrap items-center gap-2", card ? "mt-auto pt-4" : "pt-2.5")}>
        {expandable && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              haptic("selection");
              setOpen((value) => !value);
            }}
            className="press inline-flex min-h-10 items-center gap-1 rounded-full bg-fg/[0.07] px-3.5 text-[13px] font-semibold text-text fine:hover:bg-fg/[0.12]"
          >
            {open ? "Show less" : `+${more} more`}
            <ChevronDown size={14} aria-hidden className={cn(open && "rotate-180")} />
          </button>
        )}
        <a
          href={note.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center gap-1 px-1 text-[13px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))]"
        >
          Full notes on Steam <ArrowUpRight size={13} />
        </a>
      </div>
    </>
  );
}
