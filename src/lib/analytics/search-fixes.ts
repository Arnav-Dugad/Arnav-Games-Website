/**
 * "Search fixes": zero-result searches turned into alias suggestions.
 *
 * `syncSuggestions` folds the last 90 days of zero-result searches into
 * `search_aliases` (one row per normalised query, `hits` = how often it found
 * nothing). Approved and dismissed rows keep their status — and approved ones
 * their historic hit count — so a decision is never undone by new traffic.
 */

import type { D1Database } from "@/lib/cloudflare/db";
import type { AliasCandidate, AliasStatus, SearchFix } from "./types";

const WINDOW_SECONDS = 90 * 86_400;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

interface AliasRow {
  alias: string;
  status: string;
  hits: number;
  game_id: number | null;
  slug: string | null;
  name: string | null;
  image: string | null;
  candidates: string | null;
  updated_at: number;
}

export async function syncSuggestions(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // `WHERE … GROUP BY` before ON CONFLICT: SQLite needs the SELECT's WHERE to
  // tell the upsert clause apart from a join constraint.
  await db
    .prepare(
      `INSERT INTO search_aliases (alias, status, hits, created_at, updated_at)
       SELECT query, 'suggested', COUNT(*), ?1, ?1 FROM analytics_events
       WHERE type = 'search' AND results = 0 AND query IS NOT NULL AND ts >= ?2
       GROUP BY query
       ON CONFLICT(alias) DO UPDATE SET
         hits = CASE WHEN search_aliases.status = 'suggested' THEN excluded.hits ELSE search_aliases.hits END,
         updated_at = CASE WHEN search_aliases.status = 'suggested' AND search_aliases.hits != excluded.hits
                           THEN excluded.updated_at ELSE search_aliases.updated_at END`,
    )
    .bind(now, now - WINDOW_SECONDS)
    .run();
}

function parseCandidates(raw: string | null): AliasCandidate[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AliasCandidate[]) : null;
  } catch {
    return null;
  }
}

function toFix(row: AliasRow): SearchFix {
  return {
    alias: row.alias,
    status: (row.status as AliasStatus) ?? "suggested",
    hits: row.hits,
    game:
      row.game_id != null && row.slug
        ? { id: row.game_id, slug: row.slug, name: row.name ?? row.slug, image: row.image, year: null }
        : null,
    candidates: parseCandidates(row.candidates),
    updatedAt: row.updated_at,
  };
}

const COLUMNS = "alias, status, hits, game_id, slug, name, image, candidates, updated_at";

/**
 * Open suggestions, most-missed first. The palette searches as you type, so
 * a typo'd title also leaves its own zero-result prefixes ("xenobl",
 * "xenobla", …); a suggestion that is a prefix of another is hidden, keeping
 * the fullest version of what was typed.
 */
export async function listFixes(db: D1Database): Promise<{ suggestions: SearchFix[]; approved: SearchFix[]; dismissed: number }> {
  const [suggested, approved, dismissed] = await db.batch([
    db.prepare(`SELECT ${COLUMNS} FROM search_aliases WHERE status = 'suggested' ORDER BY hits DESC, updated_at DESC LIMIT 80`),
    db.prepare(`SELECT ${COLUMNS} FROM search_aliases WHERE status = 'approved' ORDER BY updated_at DESC LIMIT 50`),
    db.prepare(`SELECT COUNT(*) AS c FROM search_aliases WHERE status = 'dismissed'`),
  ]);
  const open = (suggested.results as unknown as AliasRow[]).map(toFix);
  const suggestions = open
    .filter((fix) => !open.some((other) => other.alias !== fix.alias && other.alias.startsWith(fix.alias)))
    .slice(0, 25);
  return {
    suggestions,
    approved: (approved.results as unknown as AliasRow[]).map(toFix),
    dismissed: Number((dismissed.results[0] as { c?: number } | undefined)?.c ?? 0),
  };
}

export async function storeCandidates(db: D1Database, alias: string, candidates: AliasCandidate[]): Promise<void> {
  await db
    .prepare("UPDATE search_aliases SET candidates = ?2, candidates_at = ?3 WHERE alias = ?1")
    .bind(alias, JSON.stringify(candidates), Math.floor(Date.now() / 1000))
    .run();
}

export async function storedCandidates(db: D1Database, alias: string): Promise<{ candidates: AliasCandidate[] | null; at: number | null } | null> {
  const row = await db
    .prepare("SELECT candidates, candidates_at FROM search_aliases WHERE alias = ?1")
    .bind(alias)
    .first<{ candidates: string | null; candidates_at: number | null }>();
  if (!row) return null;
  return { candidates: parseCandidates(row.candidates), at: row.candidates_at };
}

/** Validates a game picked in the admin UI; null when malformed. */
export function cleanGame(input: unknown): AliasCandidate | null {
  if (typeof input !== "object" || input === null) return null;
  const game = input as Record<string, unknown>;
  const id = game.id;
  const slug = game.slug;
  const name = game.name;
  const image = game.image;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return null;
  if (typeof name !== "string" || !name.trim() || name.length > 200) return null;
  const safeImage = typeof image === "string" && /^https:\/\/[^\s"'<>]{1,500}$/.test(image) ? image : null;
  return { id, slug, name: name.trim(), image: safeImage, year: null };
}

export async function approveAlias(db: D1Database, alias: string, game: AliasCandidate): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // Upsert: "Search manually" may approve an alias that was never suggested.
  await db
    .prepare(
      `INSERT INTO search_aliases (alias, game_id, slug, name, image, status, hits, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'approved', 0, ?6, ?6)
       ON CONFLICT(alias) DO UPDATE SET game_id = ?2, slug = ?3, name = ?4, image = ?5, status = 'approved', updated_at = ?6`,
    )
    .bind(alias, game.id, game.slug, game.name, game.image, now)
    .run();
}

export async function setAliasStatus(db: D1Database, alias: string, status: "suggested" | "dismissed"): Promise<void> {
  // Back to "suggested" clears the mapping, so an un-approved alias stops
  // affecting search as soon as caches expire.
  await db
    .prepare(
      `UPDATE search_aliases SET status = ?2, updated_at = ?3,
         game_id = CASE WHEN ?2 = 'suggested' THEN NULL ELSE game_id END,
         slug = CASE WHEN ?2 = 'suggested' THEN NULL ELSE slug END,
         name = CASE WHEN ?2 = 'suggested' THEN NULL ELSE name END,
         image = CASE WHEN ?2 = 'suggested' THEN NULL ELSE image END
       WHERE alias = ?1`,
    )
    .bind(alias, status, Math.floor(Date.now() / 1000))
    .run();
}
