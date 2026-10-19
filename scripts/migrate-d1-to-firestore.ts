/**
 * One-off: copies the old Cloudflare D1 tables into the Firestore model in
 * `src/lib/games/stats-docs.ts`.
 *
 * 1. Export each table (read-only SELECTs) into one directory:
 *
 *      for t in release_observations tracked_games price_history player_history \
 *               review_history twitch_history score_history; do
 *        npx wrangler d1 execute arnav-games --remote --json \
 *          --command "SELECT * FROM $t" > <dir>/$t.json
 *      done
 *
 * 2. Import, with FIREBASE_SERVICE_ACCOUNT in the environment or .env.local:
 *
 *      npx tsx scripts/migrate-d1-to-firestore.ts <dir>          (dry run: counts only)
 *      npx tsx scripts/migrate-d1-to-firestore.ts <dir> --write
 *
 * Idempotent: every value is a field-level set of the same data, and
 * timestamps use `minimum` / `maximum` transforms, so re-running after more
 * D1 rows have accrued (e.g. right after deploying) only fills the gap.
 * `analytics_*` and `search_aliases` are obsolete and not migrated.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { commitWrites, type Write } from "../src/lib/firebase/server/firestore";
import { fieldPath } from "../src/lib/firebase/server/values";
import { priceDocPath, releaseShardPath, STATS_COLLECTIONS, TRACKED_DOC } from "../src/lib/games/stats-docs";

type Row = Record<string, string | number | null>;

function loadEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return;
  try {
    const text = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").replace(/^﻿/, "");
    const match = text.match(/^FIREBASE_SERVICE_ACCOUNT=(.*)$/m);
    if (match) process.env.FIREBASE_SERVICE_ACCOUNT = match[1].trim();
  } catch {
    /* fall through: commitWrites reports "not configured" as 0 writes */
  }
}

function table(dir: string, name: string): Row[] {
  try {
    const json = JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8")) as Array<{ results?: Row[] }>;
    return json[0]?.results ?? [];
  } catch {
    console.warn(`  (no ${name}.json — skipped)`);
    return [];
  }
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) out.set(key(row), [...(out.get(key(row)) ?? []), row]);
  return out;
}

/** One document per series: `s.<key>` set for every sample. */
function seriesWrites(
  collection: string,
  rows: Row[],
  idField: string,
  idName: string,
  sample: (row: Row) => [string, unknown] | null,
): Write[] {
  return [...groupBy(rows, (row) => String(row[idField]))].flatMap(([id, list]) => {
    const samples = list.map(sample).filter((entry): entry is [string, unknown] => entry !== null);
    if (samples.length === 0) return [];
    const latest = samples.map(([key]) => key).sort().at(-1)!;
    const idValue = /^\d+$/.test(id) && idName !== "twitchId" ? Number(id) : id;
    return [{
      type: "update" as const,
      path: `${collection}/${id}`,
      data: { [idName]: idValue, updatedAt: /^\d+$/.test(latest) ? Number(latest) : latest, s: Object.fromEntries(samples) },
      mask: [idName, "updatedAt", ...samples.map(([key]) => fieldPath("s", key))],
    }];
  });
}

async function main() {
  const dir = process.argv[2];
  const write = process.argv.includes("--write");
  if (!dir) throw new Error("usage: migrate-d1-to-firestore.ts <export dir> [--write]");
  loadEnv();

  const tracked = table(dir, "tracked_games");
  const players = table(dir, "player_history");
  const twitch = table(dir, "twitch_history");
  const reviews = table(dir, "review_history");
  const scores = table(dir, "score_history");
  const prices = table(dir, "price_history");
  const releases = table(dir, "release_observations");

  const writes: Write[] = [];

  // trackedGames/index — one document of maps (see tracked.ts).
  {
    const data: Record<string, Record<string, unknown>> = { slug: {}, steam: {}, ms: {}, twitch: {}, cc: {} };
    const mask: string[] = [];
    const transforms: NonNullable<Extract<Write, { type: "update" }>["transforms"]> = [];
    for (const row of tracked) {
      const key = String(row.game_id);
      if (!str(row.slug) || !Number.isInteger(Number(key)) || Number(key) === 0) continue;
      data.slug[key] = row.slug;
      mask.push(fieldPath("slug", key));
      if (num(row.steam_app)) {
        data.steam[key] = row.steam_app;
        mask.push(fieldPath("steam", key));
      }
      if (str(row.microsoft)) {
        data.ms[key] = row.microsoft;
        mask.push(fieldPath("ms", key));
      }
      if (typeof row.twitch === "string") {
        data.twitch[key] = row.twitch;
        mask.push(fieldPath("twitch", key));
      }
      if (num(row.last_seen)) transforms.push({ field: fieldPath("seen", key), op: "maximum", value: row.last_seen as number });
    }
    const lastHour = (rows: Row[], idField: string) =>
      [...groupBy(rows, (row) => String(row[idField]))].map(([id, list]) => [id, Math.max(...list.map((row) => Number(row.hour)))] as const);
    for (const [app, hour] of lastHour(players, "app_id")) transforms.push({ field: fieldPath("plAt", app), op: "maximum", value: hour });
    for (const [id, hour] of lastHour(twitch, "twitch_id")) transforms.push({ field: fieldPath("twAt", id), op: "maximum", value: hour });
    // Market countries seen so far, as a starting weight for the price cron.
    for (const [country, list] of groupBy(prices, (row) => String(row.country))) {
      if (!/^[A-Z]{2}$/.test(country)) continue;
      data.cc[country] = list.length;
      mask.push(fieldPath("cc", country));
    }
    if (mask.length > 0 || transforms.length > 0) writes.push({ type: "update", path: TRACKED_DOC, data, mask, transforms });
  }

  writes.push(
    ...seriesWrites(STATS_COLLECTIONS.players, players, "app_id", "appId", (row) =>
      num(row.hour) && num(row.players) !== null ? [String(row.hour), row.players] : null,
    ),
    ...seriesWrites(STATS_COLLECTIONS.twitch, twitch, "twitch_id", "twitchId", (row) =>
      num(row.hour) && num(row.viewers) !== null && num(row.streams) !== null ? [String(row.hour), [row.viewers, row.streams]] : null,
    ),
    ...seriesWrites(STATS_COLLECTIONS.reviews, reviews, "app_id", "appId", (row) =>
      num(row.hour) && num(row.total) !== null && num(row.positive) !== null ? [String(row.hour), [row.total, row.positive]] : null,
    ),
    ...seriesWrites(STATS_COLLECTIONS.scores, scores, "game_id", "gameId", (row) =>
      str(row.observed_on) && num(row.score) !== null && num(row.count) !== null ? [String(row.observed_on), [row.score, row.count]] : null,
    ),
  );

  // priceHistory/{key}: <CC>.<day>.<store> = [currency, price, initial, discount]
  for (const [key, list] of groupBy(prices, (row) => String(row.game_id))) {
    const data: Record<string, Record<string, Record<string, unknown>>> = {};
    const mask: string[] = [];
    for (const row of list) {
      const country = String(row.country);
      const day = String(row.observed_on);
      const store = String(row.store);
      if (!/^[A-Z]{2}$/.test(country) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || (store !== "steam" && store !== "microsoft")) continue;
      data[country] ??= {};
      data[country][day] ??= {};
      data[country][day][store] = [row.currency, row.price, row.initial, row.discount];
      mask.push(fieldPath(country, day, store));
    }
    if (mask.length > 0) writes.push({ type: "update", path: priceDocPath(Number(key)), data, mask });
  }

  // releaseHistory/s0…s3: "<id>"."<value>" = first seen (minimum keeps the earliest).
  for (const [shard, list] of groupBy(releases.filter((row) => Number(row.game_id) > 0), (row) => releaseShardPath(Number(row.game_id)))) {
    writes.push({
      type: "update",
      path: shard,
      data: {},
      mask: [],
      transforms: list
        .filter((row) => str(row.value) && num(row.observed_at))
        .map((row) => ({ field: fieldPath(String(row.game_id), String(row.value).slice(0, 60)), op: "minimum" as const, value: row.observed_at as number })),
    });
  }

  const counts = new Map<string, number>();
  for (const w of writes) counts.set(w.path.split("/")[0], (counts.get(w.path.split("/")[0]) ?? 0) + 1);
  console.log("D1 rows:", { tracked: tracked.length, players: players.length, twitch: twitch.length, reviews: reviews.length, scores: scores.length, prices: prices.length, releases: releases.length });
  console.log("Firestore document writes:", Object.fromEntries(counts), "total", writes.length);
  if (!write) {
    console.log("Dry run — pass --write to commit.");
    return;
  }
  const committed = await commitWrites(writes);
  console.log(`Committed ${committed}/${writes.length} writes.`);
  if (committed < writes.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
