import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron-auth";
import { FetchBudget } from "@/lib/games/fetch-budget";
import { reviewSampleQueue, sampleReviews } from "@/lib/games/reviews";
import { readTrackedIndex } from "@/lib/games/tracked";

/**
 * Steam review totals around launch (slot 3 of the 10-minute cron in
 * worker.mjs, so once an hour).
 *
 * Samples tracked games released in the last 14 days or releasing in the
 * next 2, closest to launch first: the tracked-index read (1), one IGDB
 * calendar query (+ its token), one Steam request per game and one Firestore
 * commit — at most 40 samples and 44 outbound requests, under a hard budget
 * of 45 (Workers Free allows 50).
 *
 *   curl -X POST http://localhost:4000/api/cron/reviews          (next dev)
 */

const MAX_SAMPLES = 40;
const FETCH_BUDGET = 45;

export async function POST(request: Request) {
  if (!(await isAuthorizedCron(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const budget = new FetchBudget(FETCH_BUDGET);
  const index = await readTrackedIndex(["steam", "seen"], budget);
  if (!index) {
    return NextResponse.json(
      { job: "reviews", error: "tracked index unavailable", fetches: budget.used, ms: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const queue = await reviewSampleQueue(index, MAX_SAMPLES, budget);
  // Leave one request for the commit.
  const result = await sampleReviews(queue.apps.slice(0, Math.max(0, budget.remaining - 1)), budget);
  return NextResponse.json(
    { job: "reviews", inWindow: queue.inWindow, ...result, fetches: budget.used, ms: Date.now() - started },
    { headers: { "Cache-Control": "no-store" } },
  );
}
