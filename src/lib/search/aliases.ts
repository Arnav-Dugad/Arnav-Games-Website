/**
 * Approved search aliases ("botw" → The Legend of Zelda: Breath of the Wild).
 *
 * The owner approves them on /admin from searches that found nothing; this
 * module puts the mapped game first whenever someone searches that exact
 * (normalised) query again. Read path only — the admin API writes the table.
 *
 * Aliases are cached per isolate for five minutes: the search route runs on
 * every keystroke and must not add a D1 round-trip each time. An approval
 * therefore goes live within ~5 minutes (plus the route's own 5-minute edge
 * cache for a query someone already searched).
 */

import { getDb } from "@/lib/cloudflare/db";
import { normaliseQuery } from "@/lib/analytics/server";
import type { SearchHit } from "@/lib/games/search";

const TTL_MS = 5 * 60_000;

let cache: { at: number; aliases: Map<string, SearchHit> } | null = null;
let inflight: Promise<Map<string, SearchHit>> | null = null;

async function loadAliases(): Promise<Map<string, SearchHit>> {
  const aliases = new Map<string, SearchHit>();
  const db = await getDb();
  if (!db) return aliases;
  const { results } = await db
    .prepare(
      "SELECT alias, game_id, slug, name, image FROM search_aliases WHERE status = 'approved' AND game_id IS NOT NULL AND slug IS NOT NULL",
    )
    .all<{ alias: string; game_id: number; slug: string; name: string | null; image: string | null }>();
  for (const row of results) {
    aliases.set(row.alias, {
      kind: "game",
      id: row.game_id,
      name: row.name ?? row.slug,
      slug: row.slug,
      subtitle: "Game",
      image: row.image,
    });
  }
  return aliases;
}

async function approvedAliases(): Promise<Map<string, SearchHit>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.aliases;
  // One load per isolate at a time, however many keystrokes arrive together.
  inflight ??= loadAliases()
    .then((aliases) => {
      cache = { at: Date.now(), aliases };
      return aliases;
    })
    .catch((err: unknown) => {
      console.warn("[search-aliases] load failed", err);
      // Back off for a minute rather than retrying on every request.
      cache = { at: Date.now() - TTL_MS + 60_000, aliases: cache?.aliases ?? new Map() };
      return cache.aliases;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Drops the cache so this isolate sees an admin change immediately. */
export function invalidateAliasCache(): void {
  cache = null;
}

/** The approved game for this query, or null. Never throws. */
export async function aliasHitFor(query: string): Promise<SearchHit | null> {
  try {
    const aliases = await approvedAliases();
    if (aliases.size === 0) return null;
    return aliases.get(normaliseQuery(query)) ?? null;
  } catch {
    return null;
  }
}

/** `hits` with the alias game first (and not repeated further down). */
export function withAlias(alias: SearchHit | null, hits: SearchHit[]): SearchHit[] {
  if (!alias) return hits;
  return [alias, ...hits.filter((hit) => !(hit.kind === "game" && hit.id === alias.id))];
}

/**
 * Convenience for server-rendered search (the /search page): the hits with
 * any approved alias applied.
 */
export async function applySearchAlias(query: string, hits: SearchHit[]): Promise<SearchHit[]> {
  return withAlias(await aliasHitFor(query), hits);
}
