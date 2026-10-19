/**
 * Steam concurrent-player history: the 10-minute cron samples tracked games
 * into `playerHistory/{appid}` (one document per app, one field per hour —
 * see `stats-docs.ts`), and the game page reads that document straight from
 * Firestore in the browser.
 *
 * Steam publishes only the *current* count (the same call the live panel
 * uses); the history is entirely our own sampling, which is why it starts
 * the day a game was first tracked and says so (`since`).
 */

import { commitWrites, fieldPath, type Budget, type Write } from "@/lib/firebase/server";
import { choosePlayerSamples } from "./market-rules";
import { expiredHours, STATS_COLLECTIONS, TRACKED_DOC } from "./stats-docs";
import type { TrackedIndex } from "./tracked";

const HOUR = 3600;
/** Samples older than this are pruned; the chart never shows more. */
export const PLAYER_RETENTION_DAYS = 120;
const CONCURRENCY = 8;
/** Matches the every-10-minutes players schedule in worker.mjs. */
export const PLAYER_RUNS_PER_HOUR = 6;
const WEEK = 7 * 24 * HOUR;

/**
 * The apps this run should sample (see `choosePlayerSamples` for the rules),
 * from the tracked index the cron already read: "due" apps reported players
 * within the last week and haven't been sampled this hour; "quiet" ones
 * haven't reported lately and share a rotating slice of each run.
 */
export function playerSampleQueue(index: TrackedIndex, limit: number, reserve = 8): number[] {
  const now = Math.floor(Date.now() / 1000);
  const hour = now - (now % HOUR);
  const run = Math.floor((now % HOUR) / (HOUR / PLAYER_RUNS_PER_HOUR));

  // Most recently seen first; an app shared by several keys takes its best rank.
  const apps: number[] = [];
  const seenApp = new Set<number>();
  for (const game of index.games) {
    if (game.steamApp && !seenApp.has(game.steamApp)) {
      seenApp.add(game.steamApp);
      apps.push(game.steamApp);
    }
  }
  const due: number[] = [];
  const quiet: number[] = [];
  for (const app of apps) {
    const last = index.playerSampledAt.get(app);
    if (last !== undefined && last >= hour - WEEK) {
      if (last !== hour) due.push(app);
    } else {
      quiet.push(app);
    }
  }
  return choosePlayerSamples({
    due: due.slice(0, limit),
    quiet: quiet.slice(0, limit * PLAYER_RUNS_PER_HOUR),
    run,
    runsPerHour: PLAYER_RUNS_PER_HOUR,
    limit,
    reserve,
  });
}

/**
 * Current players, fresh (no data cache — a cached sample would be a lie
 * about the hour it is filed under). Null on failure or for an app Steam
 * doesn't report (unreleased games answer `result: 42`).
 */
async function currentPlayers(appid: number): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
      { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(3500) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { response?: { player_count?: number; result?: number } };
    const count = json.response?.result === 1 ? json.response.player_count : undefined;
    return typeof count === "number" && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

/**
 * Samples each app once (one request each, charged to `budget`), at most 8
 * in flight, and files the counts under the current hour — one field write
 * per app plus one index write marking them sampled, all in a single commit
 * (one more request). Re-running within the hour overwrites, never
 * duplicates; each write also deletes the hours that just aged out.
 */
export async function samplePlayers(
  appids: number[],
  budget: Budget,
  extra: Write[] = [],
): Promise<{ sampled: number; stored: number }> {
  const apps = [...new Set(appids.filter((id) => Number.isInteger(id) && id > 0))];
  const hour = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
  const counts: Array<[number, number]> = [];
  let cursor = 0;
  let sampled = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, apps.length) }, async () => {
      while (cursor < apps.length) {
        const appid = apps[cursor++];
        if (!budget.take()) return;
        sampled++;
        const players = await currentPlayers(appid);
        if (players !== null) counts.push([appid, players]);
      }
    }),
  );

  const expired = expiredHours(hour, PLAYER_RETENTION_DAYS);
  const writes: Write[] = counts.map(([appid, players]) => ({
    type: "update",
    path: `${STATS_COLLECTIONS.players}/${appid}`,
    data: { appId: appid, updatedAt: hour, s: { [hour]: players } },
    mask: ["appId", "updatedAt", fieldPath("s", hour), ...expired.map((h) => fieldPath("s", h))],
  }));
  if (counts.length > 0) {
    writes.push({
      type: "update",
      path: TRACKED_DOC,
      data: {},
      mask: [],
      transforms: counts.map(([appid]) => ({ field: fieldPath("plAt", appid), op: "maximum" as const, value: hour })),
    });
  }
  writes.push(...extra);
  // Charge the commit before making it; the sampling loop left room for it.
  const stored = writes.length > 0 && budget.take() ? await commitWrites(writes) : 0;
  return { sampled, stored: stored > 0 ? counts.length : 0 };
}
