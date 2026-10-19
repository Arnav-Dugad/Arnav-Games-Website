import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron-auth";
import { seedTrackedIfSmall } from "@/lib/games/tracked-seed";
import { playerSampleQueue, samplePlayers } from "@/lib/games/players";

/**
 * Steam player-count snapshot (cron "*\/10 * * * *" in worker.mjs).
 *
 * Workers Free allows 50 outbound requests per invocation, and each sample is
 * one request, so a run samples at most 40 apps: the ones not yet sampled
 * this hour, most recently viewed first, plus a rotating share of apps that
 * haven't reported lately (`playerSampleQueue`). Six runs an hour cover ~240
 * games hourly; samples are filed per hour, so re-runs never duplicate.
 *
 * A run that has to seed `tracked_games` from the shelves (IGDB requests)
 * does only that, keeping the run inside the same ceiling.
 *
 *   curl -X POST http://localhost:4000/api/cron/players          (next dev)
 *   POST https://internal/api/cron/players  x-cron-secret: …     (worker)
 */

const MAX_SAMPLES = 40;

export async function POST(request: Request) {
  if (!(await isAuthorizedCron(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const seed = await seedTrackedIfSmall();
  if (seed.attempted) {
    return NextResponse.json(
      { job: "players", seeded: seed.offered, sampled: 0, stored: 0, pruned: 0, ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const apps = await playerSampleQueue(MAX_SAMPLES);
  const result = await samplePlayers(apps);
  return NextResponse.json(
    { job: "players", seeded: 0, ...result, fetches: apps.length, ms: Date.now() - started },
    { headers: { "Cache-Control": "no-store" } },
  );
}
