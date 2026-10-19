/**
 * "This week": the next seven days of notable releases as day columns, like
 * a week view in Calendar.
 *
 * Only exact, day-level dates appear — a "Q4 2026" window can't honestly be
 * pinned to a Tuesday. Each day shows its biggest release as a poster and
 * the rest as compact rows; a quiet day says so rather than disappearing,
 * so the week keeps its shape. Phones scroll the days sideways.
 *
 * Dates are UTC throughout, matching how release dates are stored and how
 * every other date on the site is formatted.
 */

import Link from "next/link";
import { GameCover } from "@/components/game/GameCover";
import { cn } from "@/lib/utils/cn";
import type { GameSummary } from "@/lib/games/types";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const LONG_DAY = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const MAX_ROWS = 3;

export interface WeekDay {
  iso: string;
  date: Date;
  games: GameSummary[];
}

/** Groups `games` into the seven days starting today (UTC). */
export function buildWeek(games: GameSummary[], now = new Date()): WeekDay[] {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start + i * 86_400_000);
    return { iso: date.toISOString().slice(0, 10), date, games: [] };
  });
  const byIso = new Map(days.map((day) => [day.iso, day]));
  for (const game of games) {
    if (game.released) byIso.get(game.released.slice(0, 10))?.games.push(game);
  }
  // Within a day, lead with what people are paying attention to.
  for (const day of days) day.games.sort((a, b) => (b.popScore ?? 0) - (a.popScore ?? 0));
  return days;
}

export function ThisWeek({ days }: { days: WeekDay[] }) {
  return (
    <ol
      aria-label="Releases over the next seven days"
      className={cn(
        "no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-4 scroll-px-4 pb-1",
        "md:mx-0 md:grid md:grid-cols-7 md:gap-3 md:overflow-visible md:px-0 lg:gap-4",
      )}
    >
      {days.map((day, i) => (
        <DayColumn key={day.iso} day={day} index={i} />
      ))}
    </ol>
  );
}

function DayColumn({ day, index }: { day: WeekDay; index: number }) {
  const [lead, ...rest] = day.games;
  const shown = rest.slice(0, MAX_ROWS - 1);
  const more = rest.length - shown.length;
  const label = index === 0 ? "Today" : index === 1 ? "Tomorrow" : WEEKDAY.format(day.date);
  const today = index === 0;

  return (
    <li
      data-day={day.iso}
      aria-label={`${LONG_DAY.format(day.date)}: ${day.games.length === 0 ? "no notable releases" : `${day.games.length} ${day.games.length === 1 ? "release" : "releases"}`}`}
      className={cn(
        "w-[40vw] max-w-[190px] shrink-0 snap-start md:w-auto md:max-w-none",
        // Phones scroll the week sideways; an empty day there is just a
        // swipe that shows nothing, so only the 7-column grid keeps them.
        day.games.length === 0 && "max-md:hidden",
      )}
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-line pb-2.5">
        <span className={cn("text-[13px] font-semibold", today ? "text-brand-soft" : "text-text")}>{label}</span>
        <span
          className={cn(
            "grid h-7 min-w-7 place-items-center rounded-full px-1.5 font-display text-[15px] font-semibold tabular-nums",
            today ? "bg-brand text-white" : "text-muted",
          )}
        >
          {day.date.getUTCDate()}
        </span>
      </div>

      {lead ? (
        <div className="mt-3">
          <Link href={`/game/${lead.slug}`} className="group block">
            <span className="relative block aspect-[3/4] overflow-hidden rounded-xl border border-fg/[0.08] bg-panel shadow-[0_12px_28px_-18px_#000] light:shadow-[0_10px_24px_-18px_#00000066]">
              <GameCover
                name={lead.name}
                slug={lead.slug}
                image={lead.image}
                imageFallback={lead.imageFallback}
                width={320}
                sizes="(max-width: 768px) 40vw, 14vw"
                className="transition-transform duration-700 ease-[var(--ease-out-expo)] fine:group-hover:scale-[1.05]"
              />
            </span>
            <span className="mt-2 line-clamp-2 text-[13px] font-semibold leading-snug transition-colors fine:group-hover:text-brand-soft">
              {lead.name}
            </span>
          </Link>

          {shown.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {shown.map((game) => (
                <li key={game.id}>
                  <Link
                    href={`/game/${game.slug}`}
                    className="group -mx-1.5 flex min-h-11 items-center gap-2.5 rounded-lg px-1.5 py-1 transition-colors fine:hover:bg-fg/[0.05]"
                  >
                    <span className="relative h-10 w-[30px] shrink-0 overflow-hidden rounded-md border border-fg/[0.08] bg-panel">
                      <GameCover
                        name={game.name}
                        slug={game.slug}
                        image={game.image}
                        imageFallback={game.imageFallback}
                        width={96}
                        sizes="30px"
                      />
                    </span>
                    <span className="line-clamp-2 min-w-0 text-[12px] font-medium leading-snug text-muted transition-colors fine:group-hover:text-text">
                      {game.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {more > 0 && (
            <Link
              href="/upcoming"
              className="mt-1 inline-flex min-h-9 items-center text-[12px] font-semibold text-brand-soft coarse:min-h-11"
            >
              +{more} more
            </Link>
          )}
        </div>
      ) : (
        <p className="mt-3 grid aspect-[3/4] place-items-center rounded-xl border border-dashed border-line px-3 text-center text-[12px] leading-snug text-faint">
          No notable releases
        </p>
      )}
    </li>
  );
}
