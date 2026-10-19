import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron-auth";
import { FetchBudget } from "@/lib/games/fetch-budget";
import { readTrackedIndex } from "@/lib/games/tracked";
import { linkTwitchIds, sampleTwitch, twitchAuth, twitchSampleQueue } from "@/lib/games/twitch-history";

/**
 * Twitch viewers for tracked games (slots 1 and 4 of the 10-minute cron in
 * worker.mjs, so twice an hour).
 *
 * Per run, under a hard budget of 45 outbound requests (Workers Free allows
 * 50): the tracked-index read (1), the app token (1, normally cached), one
 * Helix `games?igdb_id=` lookup linking up to 100 tracked games to their
 * Twitch category, one Helix `streams?first=100` page per sampled category,
 * and one Firestore commit for everything — at most 40 samples, 44 requests.
 * Each sample is the top 100 streams' viewers (see `twitch-history.ts`).
 *
 *   curl -X POST http://localhost:4000/api/cron/twitch           (next dev)
 */

const MAX_SAMPLES = 40;
const FETCH_BUDGET = 45;

export async function POST(request: Request) {
  if (!(await isAuthorizedCron(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const budget = new FetchBudget(FETCH_BUDGET);
  const index = await readTrackedIndex(["seen", "twitch", "twAt"], budget);
  if (!index) {
    return NextResponse.json(
      { job: "twitch", error: "tracked index unavailable", fetches: budget.used, ms: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const auth = await twitchAuth(budget);
  if (!auth) {
    return NextResponse.json(
      { job: "twitch", error: "no twitch credentials", fetches: budget.used, ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const link = await linkTwitchIds(auth, index, budget);
  // Leave one request for the commit.
  const queue = twitchSampleQueue(index, Math.min(MAX_SAMPLES, budget.remaining - 1), link.found);
  const result = await sampleTwitch(queue, auth, budget, link.write ? [link.write] : []);
  return NextResponse.json(
    { job: "twitch", linked: link.linked, asked: link.asked, ...result, fetches: budget.used, ms: Date.now() - started },
    { headers: { "Cache-Control": "no-store" } },
  );
}
