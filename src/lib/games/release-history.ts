/**
 * The delay tracker: our own memory of every release date we have shown.
 *
 * IGDB only knows a game's *current* date. Whether it has slipped — and how
 * often — is something nobody publishes, so we record each distinct value as
 * we see it (`release_observations`, keyed on game + value) and derive the
 * history from that. Every function degrades to a no-op/empty result when D1
 * is unavailable (`next build`, tests, a missing binding): this is
 * enrichment, never a reason to fail a page.
 *
 * Only IGDB ids belong here. Steam-provider games use appids as their ids, and
 * the two id spaces overlap, so callers must not pass Steam-sourced games.
 *
 * Known limit of the schema: `(game_id, value)` is the primary key, so a date
 * that moves A → B → A records A only once, and the history reads A → B. Rare
 * in practice, and better than double-counting a flip-flop as two delays.
 */

import { getDb, type D1Database } from "@/lib/cloudflare/db";
import type { GameSummary, ReleaseChange } from "./types";
import { changesFromObservations, isDelay, releaseValue } from "./release-value";

/** D1 caps bound parameters per statement at 100. */
const MAX_PARAMS = 100;

/**
 * Values this isolate has already written. Pages re-render constantly and an
 * `INSERT OR IGNORE` of a known row is pure overhead, so repeats are skipped
 * before they reach the database.
 */
const recorded = new Set<string>();

export async function recordReleaseObservations(games: GameSummary[]): Promise<void> {
  const fresh = games
    .filter((game) => Number.isInteger(game.id) && game.id > 0 && game.slug)
    .map((game) => ({ game, value: releaseValue(game) }))
    .filter(({ game, value }) => !recorded.has(`${game.id}:${value}`));
  if (fresh.length === 0) return;

  const db = await getDb();
  if (!db) return;

  try {
    const now = Math.floor(Date.now() / 1000);
    const statement = db.prepare(
      "INSERT OR IGNORE INTO release_observations (game_id, slug, value, observed_at) VALUES (?, ?, ?, ?)",
    );
    await db.batch(fresh.map(({ game, value }) => statement.bind(game.id, game.slug, value, now)));
    for (const { game, value } of fresh) recorded.add(`${game.id}:${value}`);
  } catch (err) {
    console.warn("[release-history] record failed:", err instanceof Error ? err.message : err);
  }
}

interface ObservationRow {
  game_id: number;
  value: string;
  observed_at: number;
}

async function observationsFor(db: D1Database, ids: number[]): Promise<ObservationRow[]> {
  const rows: ObservationRow[] = [];
  for (let i = 0; i < ids.length; i += MAX_PARAMS) {
    const chunk = ids.slice(i, i + MAX_PARAMS);
    const result = await db
      .prepare(
        `SELECT game_id, value, observed_at FROM release_observations WHERE game_id IN (${chunk
          .map(() => "?")
          .join(",")}) ORDER BY game_id, observed_at`,
      )
      .bind(...chunk)
      .all<ObservationRow>();
    rows.push(...(result.results ?? []));
  }
  return rows;
}

/** Every observed change of one game's release value, oldest first. */
export async function getReleaseChanges(gameId: number): Promise<ReleaseChange[]> {
  if (!Number.isInteger(gameId) || gameId <= 0) return [];
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await observationsFor(db, [gameId]);
    return changesFromObservations(rows.map((row) => ({ value: row.value, observedAt: row.observed_at })));
  } catch (err) {
    console.warn("[release-history] read failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * How many times each game's date has moved *later*. Games with no recorded
 * delay are absent from the map (read as 0).
 */
export async function getDelayCounts(ids: number[]): Promise<Map<number, number>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const counts = new Map<number, number>();
  if (unique.length === 0) return counts;
  const db = await getDb();
  if (!db) return counts;
  try {
    const rows = await observationsFor(db, unique);
    const byGame = new Map<number, Array<{ value: string; observedAt: number }>>();
    for (const row of rows) {
      const list = byGame.get(row.game_id) ?? [];
      list.push({ value: row.value, observedAt: row.observed_at });
      byGame.set(row.game_id, list);
    }
    for (const [id, observations] of byGame) {
      const delays = changesFromObservations(observations).filter((change) => isDelay(change.from, change.to)).length;
      if (delays > 0) counts.set(id, delays);
    }
  } catch (err) {
    console.warn("[release-history] delay counts failed:", err instanceof Error ? err.message : err);
  }
  return counts;
}
