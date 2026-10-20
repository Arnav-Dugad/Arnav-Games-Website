/**
 * Score spread: how far critics and players disagree about a game. Pure, so
 * the game page can draw it from figures it already has and the rules can be
 * pinned down in `scripts/check-providers.ts`.
 *
 * What we can honestly compare:
 *
 *  - Critics: IGDB's aggregate of published reviews (0–100) and how many.
 *    Individual critic scores aren't available to us, so there is no spread
 *    *among* critics — only where their average sits.
 *  - IGDB members: the average of members' ratings (0–100 there; the page
 *    shows it out of 5).
 *  - Steam: the share of buyers who recommend it, all-time and over the last
 *    30 days. A share is not an average score — 80% positive is not "80/100"
 *    — so a Steam gap is judged with wider margins, and the UI says so.
 *
 * Small samples are dropped rather than drawn: a score from three ratings is
 * an anecdote.
 */

export type SpreadKey = "critics" | "members" | "steam" | "recent";

export interface SpreadMark {
  key: SpreadKey;
  label: string;
  /** 0–100. */
  value: number;
  /** "26 reviews", "989K reviews" — the caller formats; this is the raw count. */
  count: number;
}

export interface ScoreSpread {
  marks: SpreadMark[];
  /** Critics against the players' figure the gap was judged on; null without both. */
  gap: {
    players: SpreadKey;
    /** Players minus critics, in points. */
    points: number;
    tone: "agree" | "mild" | "split";
    headline: string;
  } | null;
  /** Recent Steam reviews against all-time, when they differ enough to mention. */
  trend: { points: number; text: string } | null;
}

export interface ScoreSpreadInput {
  critic: { score: number; count: number | null } | null;
  /** IGDB members' average, 0–100. */
  members: { score: number; count: number } | null;
  steam: { percent: number; total: number } | null;
  recent: { percent: number; total: number } | null;
}

/** Below these sample sizes a figure isn't drawn. */
export const SPREAD_MIN = { critics: 3, members: 10, steam: 50, recent: 20 } as const;
/** Steam's histogram needs this many reviews in 30 days to report "recent". */
export const RECENT_MIN_REVIEWS = SPREAD_MIN.recent;
/** Recent vs all-time Steam, in points, before it's worth a sentence. */
const TREND_POINTS = 8;

/** Gap bands: averages compare tightly; a recommend-share against an average loosely. */
const BANDS = {
  members: { agree: 5, mild: 12 },
  steam: { agree: 7, mild: 15 },
} as const;

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function scoreSpread(input: ScoreSpreadInput): ScoreSpread | null {
  const marks: SpreadMark[] = [];
  const critic = input.critic && (input.critic.count === null || input.critic.count >= SPREAD_MIN.critics) ? input.critic : null;
  if (critic) marks.push({ key: "critics", label: "Critics", value: clamp(critic.score), count: critic.count ?? 0 });
  const members = input.members && input.members.count >= SPREAD_MIN.members ? input.members : null;
  if (members) marks.push({ key: "members", label: "IGDB members", value: clamp(members.score), count: members.count });
  const steam = input.steam && input.steam.total >= SPREAD_MIN.steam ? input.steam : null;
  if (steam) marks.push({ key: "steam", label: "Steam, all time", value: clamp(steam.percent), count: steam.total });
  const recent = steam && input.recent && input.recent.total >= SPREAD_MIN.recent ? input.recent : null;
  if (recent) marks.push({ key: "recent", label: "Steam, last 30 days", value: clamp(recent.percent), count: recent.total });
  if (marks.length < 2) return null;

  let gap: ScoreSpread["gap"] = null;
  // Steam's crowd is usually far larger, so it speaks for players when it can.
  const players = steam ? marks.find((mark) => mark.key === "steam")! : members ? marks.find((mark) => mark.key === "members")! : null;
  const criticMark = marks.find((mark) => mark.key === "critics");
  if (criticMark && players) {
    const points = players.value - criticMark.value;
    const band = players.key === "steam" ? BANDS.steam : BANDS.members;
    const size = Math.abs(points);
    const tone = size <= band.agree ? "agree" : size <= band.mild ? "mild" : "split";
    const headline =
      tone === "agree"
        ? "Critics and players broadly agree"
        : tone === "mild"
          ? points > 0
            ? "Players like it a little more than critics"
            : "Critics like it a little more than players"
          : points > 0
            ? "Players like it far more than critics"
            : "Critics like it far more than players";
    gap = { players: players.key, points, tone, headline };
  }

  let trend: ScoreSpread["trend"] = null;
  if (steam && recent) {
    const points = clamp(recent.percent) - clamp(steam.percent);
    if (Math.abs(points) >= TREND_POINTS) {
      trend = {
        points,
        text:
          points > 0
            ? `Recent Steam reviews are warmer: ${clamp(recent.percent)}% positive in the last 30 days, against ${clamp(steam.percent)}% all-time.`
            : `Recent Steam reviews are cooler: ${clamp(recent.percent)}% positive in the last 30 days, against ${clamp(steam.percent)}% all-time.`,
      };
    }
  }

  return { marks, gap, trend };
}

/**
 * Steam's review histogram (`appreviewhistogram/{appid}` → `results.recent`,
 * one row per day for the last 30) → the 30-day totals, or null when there
 * are too few reviews to mean anything.
 */
export function recentFromHistogram(
  rows: Array<{ recommendations_up?: unknown; recommendations_down?: unknown }> | null | undefined,
): { positive: number; negative: number; total: number; percent: number } | null {
  if (!Array.isArray(rows)) return null;
  let positive = 0;
  let negative = 0;
  for (const row of rows.slice(0, 31)) {
    const up = Number(row?.recommendations_up);
    const down = Number(row?.recommendations_down);
    if (Number.isFinite(up) && up > 0) positive += up;
    if (Number.isFinite(down) && down > 0) negative += down;
  }
  const total = positive + negative;
  if (total < RECENT_MIN_REVIEWS) return null;
  return { positive, negative, total, percent: Math.round((positive / total) * 100) };
}
