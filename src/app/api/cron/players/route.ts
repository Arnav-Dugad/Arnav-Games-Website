import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron-auth";
import { FetchBudget } from "@/lib/games/fetch-budget";
import { seedTrackedIfSmall } from "@/lib/games/tracked-seed";
import { evictionWrite, readTrackedIndex } from "@/lib/games/tracked";
import { playerSampleQueue, samplePlayers } from "@/lib/games/players";

/**
 * Steam player-count snapshot (cron "*\/10 * * * *" in worker.mjs).
 *
 * Workers Free allows 50 outbound requests per invocation, and Firestore is
 * now reached over HTTPS (D1 was a free binding), so the run is planned
 * against a hard budget of 45: one read of the tracked index, at most 40
 * Steam requests (one per app), and one commit carrying every sample, the
 * "sampled" marks and any eviction — 42 at most. Six runs an hour cover
 * ~240 games hourly; samples are filed per hour, so re-runs never duplicate.
 *
 * Firestore cost per run: 1 read, ≤ 41 writes (≈ 5.9k writes/day at the
 * cap, inside the Spark plan's 20k).
 *
 * A run that has to seed the tracked set from the shelves (IGDB requests)
 * does only that, keeping the run inside the same ceiling.
 *
 *   curl -X POST http://localhost:4000/api/cron/players          (next dev)
 *   POST https://internal/api/cron/players  x-cron-secret: …     (worker)
 */

const MAX_SAMPLES = 40;
const FETCH_BUDGET = 45;

export async function POST(request: Request) {
  if (!(await isAuthorizedCron(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const budget = new FetchBudget(FETCH_BUDGET);
  const index = await readTrackedIndex(["steam", "seen", "plAt"], budget);
  if (!index) {
    return NextResponse.json(
      { job: "players", error: "tracked index unavailable", fetches: budget.used, ms: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const seed = await seedTrackedIfSmall(index);
  if (seed.attempted) {
    return NextResponse.json(
      { job: "players", seeded: seed.offered, sampled: 0, stored: 0, ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  // Leave one request for the commit.
  const apps = playerSampleQueue(index, Math.min(MAX_SAMPLES, budget.remaining - 1));
  const eviction = evictionWrite(index);
  const result = await samplePlayers(apps, budget, eviction ? [eviction] : []);
  return NextResponse.json(
    { job: "players", seeded: 0, tracked: index.games.length, ...result, fetches: budget.used, ms: Date.now() - started },
    { headers: { "Cache-Control": "no-store" } },
  );
}
