import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron-auth";
import { FetchBudget } from "@/lib/games/fetch-budget";
import { recordCriticScores } from "@/lib/games/scores";
import { readTrackedIndex } from "@/lib/games/tracked";

/**
 * Daily critic-score observations (05:00 UTC slot of the 10-minute cron in
 * worker.mjs).
 *
 * The tracked-index read (1), one batched IGDB query per 500 tracked games
 * (+ the token) and one Firestore commit per 500 scores — 6 outbound
 * requests at the 1,000-game cap, under a hard budget of 45.
 *
 *   curl -X POST http://localhost:4000/api/cron/scores           (next dev)
 */

const FETCH_BUDGET = 45;

export async function POST(request: Request) {
  if (!(await isAuthorizedCron(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const budget = new FetchBudget(FETCH_BUDGET);
  const index = await readTrackedIndex(["seen"], budget);
  if (!index) {
    return NextResponse.json(
      { job: "scores", error: "tracked index unavailable", fetches: budget.used, ms: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await recordCriticScores(index, budget);
  return NextResponse.json(
    { job: "scores", ...result, fetches: budget.used, ms: Date.now() - started },
    { status: result.failed ? 502 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
