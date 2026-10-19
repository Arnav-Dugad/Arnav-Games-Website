import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron-auth";
import { FetchBudget } from "@/lib/games/fetch-budget";
import { reviewSampleQueue, sampleReviews } from "@/lib/games/reviews";

/**
 * Steam review totals around launch (slot 3 of the 10-minute cron in
 * worker.mjs, so once an hour).
 *
 * Samples tracked games released in the last 14 days or releasing in the
 * next 2, closest to launch first, at most 40 per run: one IGDB calendar
 * query (+ its token) and one Steam request per game — 42 outbound requests
 * at most, under a hard budget of 45 (Workers Free allows 50).
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
  const queue = await reviewSampleQueue(MAX_SAMPLES, budget);
  const result = await sampleReviews(queue.apps, budget);
  return NextResponse.json(
    { job: "reviews", inWindow: queue.inWindow, ...result, fetches: budget.used, ms: Date.now() - started },
    { headers: { "Cache-Control": "no-store" } },
  );
}
