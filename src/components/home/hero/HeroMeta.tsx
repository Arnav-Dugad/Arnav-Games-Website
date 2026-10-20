import { PlatformIcons } from "@/components/game/PlatformIcons";
import { releaseState } from "@/lib/games/release-state";
import { daysUntil, formatDate, releaseLabel, scoreTier } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { GameSummary } from "@/lib/games/types";

/** How long after launch a game still reads as "Out now" rather than by its year. */
const OUT_NOW_DAYS = 45;

/**
 * The release, phrased the way a front door should phrase it.
 *
 * Imminent games count down, new ones are "Out now", and anything older is
 * just its year — "Released 19.1 years ago" is trivia, not a reason to look.
 * Imprecise windows stay verbatim ("Q4 2026"): a hero is the last place to
 * imply a precision the data doesn't have.
 */
export function heroRelease(game: GameSummary, now = new Date()): { label: string; emphasis: boolean } {
  const state = releaseState(game, now);
  if (state === "upcoming") {
    const days = game.released ? daysUntil(game.released, now) : null;
    if (days !== null && days <= 0) return { label: "Out now", emphasis: true };
    if (days === 1) return { label: "Out tomorrow", emphasis: true };
    if (days !== null && days <= 60) return { label: `Out in ${days} days`, emphasis: true };
    return { label: `Coming ${releaseLabel(game, "soon")}`, emphasis: true };
  }
  if (state === "released" && game.released) {
    const days = daysUntil(game.released, now);
    if (days !== null && days > -OUT_NOW_DAYS) return { label: "Out now", emphasis: true };
    return { label: game.released.slice(0, 4), emphasis: false };
  }
  if (game.releaseWindow) return { label: game.releaseWindow, emphasis: false };
  return { label: game.tba ? "Date TBA" : formatDate(game.released), emphasis: false };
}

const DOT = <span aria-hidden className="h-[3px] w-[3px] shrink-0 rounded-full bg-white/45" />;

/**
 * Apple TV's metadata line: one quiet row of facts, separated by dots, with
 * the critic score set apart as a small chip rather than a coloured number.
 */
export function HeroMeta({
  game,
  className,
  showRelease = true,
}: {
  game: GameSummary;
  className?: string;
  /** Off when something else on the slide already says when (release-day badge). */
  showRelease?: boolean;
}) {
  const release = heroRelease(game);
  const genres = game.genres.slice(0, 2).map((genre) => genre.name);
  const tier = scoreTier(game.metacritic);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] font-medium text-white/75 sm:text-[15px]",
        className,
      )}
    >
      {showRelease && (
        <span className={cn(release.emphasis && "font-semibold text-white")}>{release.label}</span>
      )}
      {genres.length > 0 && (
        <>
          {showRelease && DOT}
          {/* One genre on phones: two pushed the line into an awkward wrap. */}
          <span className="min-w-0 truncate">
            {genres[0]}
            {genres[1] && <span className="max-sm:hidden"> · {genres[1]}</span>}
          </span>
        </>
      )}
      {game.parentPlatforms.length > 0 && (
        <>
          {/* No separator dot here: the glyphs read as their own group, and
              when they wrap on a narrow phone a dot was left dangling at the
              end of the line above.
              `--color-faint` is re-pointed to white/55 inside the hero, so
              the untinted glyphs sit at the same weight as the text. */}
          <PlatformIcons platforms={game.parentPlatforms} size={14} max={5} className="ml-1 gap-2" />
        </>
      )}
      {game.metacritic !== null && (
        <>
          {/* No dot either: the chip is its own group, and a dot before it
              was left starting a line whenever the row wrapped. */}
          <span
            className="inline-flex items-center gap-1.5 rounded-[6px] border border-white/30 px-1.5 py-px text-[12px] font-semibold tabular-nums text-white"
            title="Critic score"
          >
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                tier === "high" ? "bg-[#30d158]" : tier === "mid" ? "bg-[#ffd60a]" : "bg-[#ff375f]",
              )}
            />
            {game.metacritic}
            <span className="sr-only"> critic score</span>
          </span>
        </>
      )}
    </div>
  );
}
