"use client";

/**
 * The Today view: an iOS-widget-style glance at what's next.
 *
 * Built to be opened from the installed app's "Today" shortcut and read in
 * two seconds: one narrow column, no filters or explanations — just what is
 * out today (if anything) and the next three releases, each with its cover,
 * mark, platforms and a big day count.
 *
 * Whose releases: signed in with followed games that have a date, it is
 * yours; otherwise the three most anticipated games releasing soonest. The
 * label says which, so the list never pretends to be personal when it isn't.
 *
 * "Today" is the reader's own calendar day. The server can't know it, so the
 * first render uses the server's UTC date (matching the HTML) and the device
 * corrects it straight after hydration.
 */

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { CalendarClock, ChevronRight } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { useSharedCover, CoverTransition } from "@/components/interactions/CoverTransition";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { cn } from "@/lib/utils/cn";

export interface TodayGame {
  id: number;
  slug: string;
  name: string;
  /** Day-precise ISO date, or null. Only dated games can count down. */
  released: string | null;
  image: string | null;
  imageFallback: string | null;
  /** A wide screenshot, for the "Out today" card. */
  art: string | null;
  platforms: { slug: string }[];
}

const ROWS = 3;
const MAX_OUT_TODAY = 2;
const DAY_MS = 86_400_000;

const subscribeNothing = () => () => {};

function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole calendar days between two ISO dates (timezone-free: both are dates). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const LONG_DATE = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const formatDay = (iso: string, format: Intl.DateTimeFormat) => format.format(new Date(`${iso}T00:00:00Z`));

export function TodayView({
  pool,
  anticipatedIds,
  serverToday,
}: {
  pool: TodayGame[];
  anticipatedIds: number[];
  serverToday: string;
}) {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const today = hydrated ? localToday() : serverToday;
  const { user, loading: authLoading } = useAuth();
  const { entries, loading: listLoading } = useWatchlist();
  // Until we know whether there is a personal list, don't flash the generic one.
  const resolving = authLoading || Boolean(user && listLoading);

  const { outToday, next, personal } = useMemo(() => {
    const byId = new Map(pool.map((game) => [game.id, game]));

    // Followed games with a real date, enriched with the pool's art
    // when the game happens to be in it.
    const followed: TodayGame[] = user
      ? entries
          .filter((entry) => entry.following && entry.released && entry.released >= today)
          .sort((a, b) => (a.released ?? "").localeCompare(b.released ?? ""))
          .map((entry) => {
            const known = byId.get(entry.gameId);
            return {
              id: entry.gameId,
              slug: entry.slug,
              name: entry.name,
              released: entry.released,
              image: entry.image,
              imageFallback: entry.imageFallback,
              art: known?.art ?? null,
              // Where they'll play it, when they've said; else where it's out.
              platforms: entry.platform
                ? [{ slug: entry.platform }]
                : known?.platforms ?? entry.platformSlugs.map((slug) => ({ slug })),
            };
          })
      : [];

    const anticipated = anticipatedIds
      .map((id) => byId.get(id))
      .filter((game): game is TodayGame => Boolean(game?.released));

    // Out today: yours and the most anticipated first. Failing those, one
    // notable release from the calendar — enough to say "something's out"
    // without pushing the next three below the fold on a small phone.
    const isOut = (game: TodayGame) => game.released === today;
    const seen = new Set<number>();
    const unique = (game: TodayGame) => (seen.has(game.id) ? false : (seen.add(game.id), true));
    const featuredOut = [...followed.filter(isOut), ...anticipated.filter(isOut)].filter(unique);
    const outToday = (featuredOut.length > 0 ? featuredOut : pool.filter(isOut).slice(0, 1)).slice(0, MAX_OUT_TODAY);

    const personalNext = followed.filter((game) => (game.released ?? "") > today);
    const personal = personalNext.length > 0;
    const next = (
      personal
        ? personalNext
        : anticipated
            .filter((game) => (game.released ?? "") > today)
            .sort((a, b) => (a.released ?? "").localeCompare(b.released ?? ""))
    ).slice(0, ROWS);

    return { outToday, next, personal };
  }, [pool, anticipatedIds, entries, user, today]);

  return (
    <div className="mx-auto w-full max-w-[460px] px-4 pb-12 pt-[calc(var(--chrome-top)+1.25rem)] sm:pt-28" data-track-src="today:page">
      <header className="px-1">
        <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-brand-soft tabular-nums">
          {formatDay(today, LONG_DATE)}
        </p>
        <h1 className="mt-0.5 font-display text-[34px] font-bold tracking-[-0.03em]">Today</h1>
      </header>

      {outToday.length > 0 && (
        <section aria-label="Out today" className="mt-5 space-y-2.5">
          {outToday.map((game, i) => (
            <OutTodayCard key={game.id} game={game} priority={i === 0} />
          ))}
        </section>
      )}

      <section aria-labelledby="today-next" className="mt-7">
        <h2 id="today-next" className="px-1 text-[13px] font-semibold text-muted">
          {resolving ? "Up next" : personal ? "Following" : "Most anticipated"}
        </h2>
        <div className="mt-2 overflow-hidden rounded-[28px] border border-line bg-panel shadow-[0_18px_40px_-28px_#000] light:shadow-[0_14px_34px_-26px_#00000055]">
          {resolving ? (
            <RowsSkeleton />
          ) : next.length > 0 ? (
            <ol>
              {next.map((game, i) => (
                <li key={game.id}>
                  <NextRow game={game} today={today} first={i === 0} />
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex min-h-[132px] flex-col items-center justify-center gap-2 px-6 py-6 text-center">
              <CalendarClock size={22} aria-hidden className="text-faint" />
              <p className="text-[15px] text-muted">No dated releases yet.</p>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 px-1 text-[14px]">
          {!resolving && !user ? (
            <Link href="/login?next=%2Ftoday" className="press min-h-11 content-center font-medium text-brand-soft">
              Sign in to see yours
            </Link>
          ) : (
            <span />
          )}
          <Link href="/upcoming" className="press inline-flex min-h-11 items-center gap-0.5 font-medium text-muted fine:hover:text-text">
            Calendar <ChevronRight size={15} aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}

/**
 * A release out today, as a short art-backed card: it should announce itself
 * without pushing the next three releases (the reason for the page) below
 * the fold.
 */
function OutTodayCard({ game, priority }: { game: TodayGame; priority: boolean }) {
  const cover = useSharedCover(game.slug, game.image);
  return (
    <Link
      href={`/game/${game.slug}`}
      onClick={cover.claim}
      data-stage="dark"
      className="press group relative isolate flex h-[104px] items-center gap-3 overflow-hidden rounded-[24px] bg-[#111] pl-4 pr-3 text-white shadow-[0_18px_40px_-28px_#000]"
    >
      <span aria-hidden className="absolute inset-0 -z-10">
        <GameCover
          name={game.name}
          slug={game.slug}
          image={game.art ?? game.image}
          imageFallback={game.art ? game.image : game.imageFallback}
          width={640}
          sizes="(max-width: 480px) 92vw, 430px"
          priority={priority}
          rounded="rounded-none"
          className="transition-transform duration-700 ease-[var(--ease-apple)] fine:group-hover:scale-[1.04]"
        />
      </span>
      <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-black/85 via-black/60 to-black/15" />
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_#ffffff14]" />

      <span className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-black">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#30d158]" />
          Out today
        </span>
        <span className="mt-1.5 block truncate text-[17px] font-semibold tracking-[-0.01em]">{game.name}</span>
        <PlatformIcons platforms={game.platforms} size={12} max={5} className="mt-1 gap-1.5 [&_li]:text-white/70" />
      </span>
      <ChevronRight size={20} aria-hidden className="shrink-0 text-white/70 transition-transform fine:group-hover:translate-x-0.5" />
    </Link>
  );
}

function NextRow({ game, today, first }: { game: TodayGame; today: string; first: boolean }) {
  const cover = useSharedCover(game.slug, game.image);
  const days = game.released ? daysBetween(today, game.released) : null;
  return (
    <Link
      href={`/game/${game.slug}`}
      onClick={cover.claim}
      className="group flex items-center gap-3.5 pl-3.5 transition-colors fine:hover:bg-fg/[0.04] coarse:active:bg-fg/[0.06]"
    >
      <span className="relative my-3 block aspect-[3/4] w-[52px] shrink-0 overflow-hidden rounded-[10px] border border-fg/10 bg-panel-2">
        <CoverTransition slug={game.slug} active={cover.active}>
          <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={120} sizes="52px" />
        </CoverTransition>
      </span>
      {/* iOS inset separator: the hairline starts at the text, not the edge. */}
      <span className={cn("flex min-h-[94px] min-w-0 flex-1 items-center gap-3 self-stretch pr-4", !first && "border-t border-line")}>
        <span className="min-w-0 flex-1">
          {/* The name, not the logo: at widget size many marks are illegible. */}
          <span className="line-clamp-2 text-[16px] font-semibold leading-snug tracking-[-0.01em]">{game.name}</span>
          <span className="mt-1.5 flex min-w-0 items-center gap-2 text-[13px] text-muted">
            {game.released && <span className="shrink-0 tabular-nums">{formatDay(game.released, SHORT_DATE)}</span>}
            <PlatformIcons platforms={game.platforms} size={12} max={3} className="min-w-0 gap-1.5" />
          </span>
        </span>
        {days !== null && (
          <span className="shrink-0 text-right">
            <span className="sr-only">{days === 1 ? "Out tomorrow" : `Out in ${days} days`}</span>
            <span aria-hidden className="block font-display text-[30px] font-bold leading-none tracking-[-0.03em] tabular-nums">
              {days}
            </span>
            <span aria-hidden className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
              {days === 1 ? "day" : "days"}
            </span>
          </span>
        )}
      </span>
    </Link>
  );
}

function RowsSkeleton() {
  return (
    <div role="status" aria-label="Loading your releases">
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} className="flex items-center gap-3.5 pl-3.5">
          <div className="skeleton-glass my-3 aspect-[3/4] w-[52px] rounded-[10px]" />
          <div className={cn("flex min-h-[94px] flex-1 items-center gap-3 pr-4", i > 0 && "border-t border-line")}>
            <div className="flex-1">
              <div className="skeleton-glass h-4 w-2/3 rounded-full" />
              <div className="skeleton-glass mt-2.5 h-3 w-1/3 rounded-full" />
            </div>
            <div className="skeleton-glass h-8 w-9 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
