import { igdbCachedQuery, igdbConfigured, igdbImage, MAIN_GAMES } from "@/lib/games/providers/igdb";
import { TTL } from "@/lib/games/providers/types";

/**
 * Real counts and real cover art for the /genres and /platforms tiles.
 *
 * Each tile needs two facts: how many games the filter it links to returns,
 * and a few covers that genuinely belong to it. Asked one at a time that is
 * two IGDB requests per tile — ~50 for the genre page, which is the whole
 * Workers Free subrequest allowance for one render. IGDB's multiquery runs
 * ten of these per request instead, so a page costs five or six requests,
 * all cached for a day.
 *
 * The count clause is the same one `/browse` uses (`buildWhere` in igdb.ts),
 * so the number on a tile is the number you get after tapping it. Failure
 * returns an empty map: tiles then render without counts or art rather than
 * with invented ones.
 */

/** IGDB rejects multiqueries with more than ten sub-queries. */
const PER_REQUEST = 10;
const COVERS = 3;

export interface ShowcaseCover {
  id: number;
  name: string;
  slug: string;
  image: string;
}

export interface Showcase {
  count: number | null;
  covers: ShowcaseCover[];
}

interface MultiResult {
  name: string;
  count?: number;
  result?: { id: number; name: string; slug?: string; cover?: { image_id?: string } }[];
}

/**
 * @param filters Key → IGDB `where` clause selecting that tile's games. Keys
 *                are echoed back in the result map.
 * @param options `count: false` skips the count query (callers that already
 *                know it); `covers` is how many covers to fetch.
 */
export async function taxonomyShowcase(
  filters: Map<string, string>,
  { count = true, covers = COVERS }: { count?: boolean; covers?: number } = {},
): Promise<Map<string, Showcase>> {
  const out = new Map<string, Showcase>();
  if (!igdbConfigured() || filters.size === 0) return out;

  const blocks: string[] = [];
  for (const [key, clause] of filters) {
    const where = `${clause} & ${MAIN_GAMES}`;
    if (count) blocks.push(`query games/count "c:${key}" {
where ${where};
};`);
    blocks.push(
      `query games "g:${key}" {
fields name,slug,cover.image_id;
where ${where} & cover != null;
sort total_rating_count desc;
limit ${covers};
};`,
    );
  }

  const chunks: string[][] = [];
  for (let i = 0; i < blocks.length; i += PER_REQUEST) chunks.push(blocks.slice(i, i + PER_REQUEST));

  const settled = await Promise.allSettled(
    chunks.map((chunk) => igdbCachedQuery<MultiResult[]>("multiquery", chunk.join("\n"), TTL.list)),
  );

  for (const result of settled) {
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) continue;
    for (const entry of result.value) {
      const [kind, key] = [entry.name.slice(0, 1), entry.name.slice(2)];
      const current = out.get(key) ?? { count: null, covers: [] };
      if (kind === "c" && typeof entry.count === "number") current.count = entry.count;
      if (kind === "g" && Array.isArray(entry.result)) {
        current.covers = entry.result.flatMap((game) => {
          const image = igdbImage(game.cover?.image_id, "cover_big");
          return image ? [{ id: game.id, name: game.name, slug: game.slug ?? String(game.id), image }] : [];
        });
      }
      out.set(key, current);
    }
  }
  return out;
}

/** `where` clauses for tiles keyed by an id on one of the game's array fields. */
export function byId(field: "genres" | "platforms", ids: Map<string, number>): Map<string, string> {
  return new Map([...ids].map(([key, id]) => [key, `${field} = (${id})`]));
}

/** Slugs are quote-free in IGDB, but a hand-edited URL could carry anything. */
const safeSlug = (slug: string) => slug.replace(/[^a-z0-9-]/gi, "");

/**
 * Franchise art keyed by slug. Popular-franchise lists mix IGDB franchises
 * and collections, whose numeric ids overlap — matching on slug across both
 * relations is the only way to be sure the cover belongs to that series.
 */
export function bySeriesSlug(slugs: string[]): Map<string, string> {
  return new Map(
    slugs.map((slug) => [slug, `(franchises.slug = "${safeSlug(slug)}" | collections.slug = "${safeSlug(slug)}")`]),
  );
}

/** IGDB ids for platform slugs — one cached lookup. */
export async function platformIds(slugs: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!igdbConfigured() || slugs.length === 0) return out;
  try {
    const rows = await igdbCachedQuery<{ id: number; slug?: string }[]>(
      "platforms",
      `fields slug;\nwhere slug = (${slugs.map((slug) => `"${slug}"`).join(",")});\nlimit ${slugs.length};`,
      TTL.taxonomy,
    );
    for (const row of rows) if (row.slug) out.set(row.slug, row.id);
  } catch {
    /* tiles render without counts */
  }
  return out;
}
