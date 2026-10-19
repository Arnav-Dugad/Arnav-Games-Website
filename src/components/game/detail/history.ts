"use client";

/**
 * Our own sampled histories for the game page, read straight from Firestore
 * in the browser (no Worker request) and shaped by the same pure rules the
 * server routes used to apply (`market-rules.ts`, `history-rules.ts`).
 *
 * A missing document is an honest "nothing recorded yet" (an empty series),
 * exactly as the old routes answered; only a failed read is an error.
 */

import { readStatsDoc } from "@/lib/firebase/stats";
import { downsampleTwitch, reviewVelocity, scoreTimeline } from "@/lib/games/history-rules";
import { downsamplePlayers } from "@/lib/games/market-rules";
import { playerRows, reviewRows, scoreRows, STATS_COLLECTIONS, twitchRows } from "@/lib/games/stats-docs";
import type { PlayerHistory, ReviewVelocity, ScoreTimeline, TwitchHistory } from "@/lib/games/types";
import { useResource, type EndpointState } from "./endpoint";

const DAY = 86_400;
/** The cron prunes beyond these; readers trim too, in case a stray old sample survived. */
const PLAYER_DAYS = 120;
const TWITCH_DAYS = 120;

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function usePlayerHistory(appid: number | null | undefined): EndpointState<PlayerHistory> & { retry: () => void } {
  return useResource<PlayerHistory>(appid ? `fs:${STATS_COLLECTIONS.players}/${appid}` : null, async () => {
    const data = await readStatsDoc(STATS_COLLECTIONS.players, String(appid));
    const now = nowSeconds();
    const rows = playerRows(data).filter((row) => row.hour >= now - PLAYER_DAYS * DAY);
    return { appId: appid!, ...downsamplePlayers(rows, now) };
  });
}

export function useTwitchHistory(twitchId: string | null | undefined): EndpointState<TwitchHistory> & { retry: () => void } {
  const valid = twitchId && /^\d{1,12}$/.test(twitchId) ? twitchId : null;
  return useResource<TwitchHistory>(valid ? `fs:${STATS_COLLECTIONS.twitch}/${valid}` : null, async () => {
    const data = await readStatsDoc(STATS_COLLECTIONS.twitch, valid!);
    const now = nowSeconds();
    const rows = twitchRows(data).filter((row) => row.hour >= now - TWITCH_DAYS * DAY);
    return { twitchId: valid!, ...downsampleTwitch(rows, now) };
  });
}

/**
 * `launch` is the page's release day (ISO); the 72-hour figure is measured
 * from its UTC midnight, the same origin the card's "day N" labels use.
 */
export function useReviewVelocity(
  appid: number | null | undefined,
  launch: string | null,
): EndpointState<ReviewVelocity> & { retry: () => void } {
  return useResource<ReviewVelocity>(appid ? `fs:${STATS_COLLECTIONS.reviews}/${appid}@${launch ?? ""}` : null, async () => {
    const data = await readStatsDoc(STATS_COLLECTIONS.reviews, String(appid));
    const at = launch ? Date.parse(`${launch}T00:00:00Z`) : NaN;
    return reviewVelocity(appid!, reviewRows(data), Number.isFinite(at) ? at / 1000 : null, nowSeconds());
  });
}

export function useScoreTimeline(gameId: number | null | undefined): EndpointState<ScoreTimeline> & { retry: () => void } {
  const valid = gameId && Number.isInteger(gameId) && gameId > 0 ? gameId : null;
  return useResource<ScoreTimeline>(valid ? `fs:${STATS_COLLECTIONS.scores}/${valid}` : null, async () =>
    scoreTimeline(scoreRows(await readStatsDoc(STATS_COLLECTIONS.scores, String(valid)))),
  );
}
