/**
 * Which games the market crons look after (`tracked_games`).
 *
 * A game joins when someone opens its page (`trackGameView`, called from
 * `getGame` after the response) and, while the table is small, from the
 * trending / top-rated / Steam-chart / upcoming shelves (`seedTrackedGames`).
 * `last_seen` orders the crons' work, so what people actually look at is
 * sampled first.
 *
 * Keys: IGDB games use their IGDB id. Steam-only titles (served by the Steam
 * provider, whose ids are appids) use the *negated* appid, because the two id
 * spaces overlap and a Steam appid must never be mistaken for an IGDB record.
 *
 * Like the delay tracker, everything is a quiet no-op without D1.
 */

import { getDb } from "@/lib/cloudflare/db";
import { externalIdsFor } from "./providers/igdb-extras";
import type { GameSummary } from "./types";

export interface TrackedGame {
  gameId: number;
  slug: string;
  steamApp: number | null;
  microsoft: string | null;
}

const BIG_ID = /^[0-9A-Z]{12}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,159}$/;
/** One write per game per isolate per hour is plenty for an hourly cron. */
const VIEW_THROTTLE_MS = 60 * 60 * 1000;
const lastWrite = new Map<number, number>();

const UPSERT =
  "INSERT INTO tracked_games (game_id, slug, steam_app, microsoft, last_seen) VALUES (?, ?, ?, ?, ?) " +
  "ON CONFLICT(game_id) DO UPDATE SET slug = excluded.slug, " +
  "steam_app = COALESCE(excluded.steam_app, tracked_games.steam_app), " +
  "microsoft = COALESCE(excluded.microsoft, tracked_games.microsoft), " +
  "last_seen = MAX(excluded.last_seen, tracked_games.last_seen)";

function clean(game: TrackedGame): TrackedGame | null {
  if (!Number.isInteger(game.gameId) || game.gameId === 0 || !SLUG.test(game.slug)) return null;
  const steamApp = game.steamApp && Number.isInteger(game.steamApp) && game.steamApp > 0 ? game.steamApp : null;
  const microsoft = game.microsoft && BIG_ID.test(game.microsoft.toUpperCase()) ? game.microsoft.toUpperCase() : null;
  return { gameId: game.gameId, slug: game.slug, steamApp, microsoft };
}

/** Marks a game as just viewed. Throttled per isolate; never throws. */
export async function trackGameView(game: TrackedGame): Promise<void> {
  const row = clean(game);
  if (!row) return;
  const now = Date.now();
  if (now - (lastWrite.get(row.gameId) ?? 0) < VIEW_THROTTLE_MS) return;
  lastWrite.set(row.gameId, now);

  const db = await getDb();
  if (!db) return;
  try {
    await db
      .prepare(UPSERT)
      .bind(row.gameId, row.slug, row.steamApp, row.microsoft, Math.floor(now / 1000))
      .run();
  } catch (err) {
    lastWrite.delete(row.gameId);
    console.warn("[tracked] view upsert failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Adds shelf games (IGDB ids) that aren't tracked yet. Existing rows keep
 * their `last_seen`, so a seed never outranks a real visit. Returns how many
 * candidate rows were written.
 */
export async function seedTrackedGames(games: GameSummary[]): Promise<number> {
  const unique = [...new Map(games.filter((g) => g.id > 0).map((g) => [g.id, g])).values()];
  if (unique.length === 0) return 0;
  const db = await getDb();
  if (!db) return 0;

  const ids = await externalIdsFor(unique.map((game) => game.id));
  // Seeds sit just behind anything viewed in the same second.
  const seenAt = Math.floor(Date.now() / 1000) - 1;
  const statement = db.prepare(
    "INSERT INTO tracked_games (game_id, slug, steam_app, microsoft, last_seen) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(game_id) DO UPDATE SET " +
      "steam_app = COALESCE(tracked_games.steam_app, excluded.steam_app), " +
      "microsoft = COALESCE(tracked_games.microsoft, excluded.microsoft)",
  );
  const rows = unique
    .map((game) =>
      clean({
        gameId: game.id,
        slug: game.slug,
        steamApp: ids.get(game.id)?.steam ?? null,
        microsoft: ids.get(game.id)?.microsoft ?? null,
      }),
    )
    .filter((row): row is TrackedGame => row !== null);
  try {
    for (let i = 0; i < rows.length; i += 50) {
      await db.batch(
        rows.slice(i, i + 50).map((row) => statement.bind(row.gameId, row.slug, row.steamApp, row.microsoft, seenAt)),
      );
    }
    return rows.length;
  } catch (err) {
    console.warn("[tracked] seed failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

export async function trackedCount(): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return (await db.prepare("SELECT COUNT(*) AS n FROM tracked_games").first<{ n: number }>())?.n ?? 0;
  } catch {
    return null;
  }
}

/** The most recently seen tracked games that have a store id, newest first. */
export async function trackedGames(limit: number, need: "steam" | "any"): Promise<TrackedGame[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const where = need === "steam" ? "steam_app IS NOT NULL" : "(steam_app IS NOT NULL OR microsoft IS NOT NULL)";
    const result = await db
      .prepare(`SELECT game_id, slug, steam_app, microsoft FROM tracked_games WHERE ${where} ORDER BY last_seen DESC LIMIT ?`)
      .bind(Math.max(1, Math.min(1000, Math.floor(limit))))
      .all<{ game_id: number; slug: string; steam_app: number | null; microsoft: string | null }>();
    return (result.results ?? []).map((row) => ({
      gameId: row.game_id,
      slug: row.slug,
      steamApp: row.steam_app,
      microsoft: row.microsoft,
    }));
  } catch (err) {
    console.warn("[tracked] read failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
