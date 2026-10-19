/**
 * Key people behind games, from Wikidata — directors (P57), designers
 * (P287), composers (P86), producers (P162) and writers (P58) — joined to
 * IGDB through Wikidata's IGDB-slug property (P5794), the same free join the
 * reference links use (`wikidata.ts`).
 *
 *  - `peopleFor(slug)`: the credited people of one game (1 SPARQL request,
 *    cached a week).
 *  - `getPerson(qid)`: a person page — name, portrait, description, and
 *    every game of theirs that Wikidata links to IGDB, as `GameSummary`
 *    cards (1 SPARQL + 1 IGDB slug lookup + 2 for the cards; cached a week).
 *
 * Portraits are Wikimedia Commons thumbnails (`Special:FilePath?width=256`),
 * linked, not fetched.
 */

import { unstable_cache } from "next/cache";
import { politeJson } from "./polite";
import { igdbCachedQuery, igdbConfigured, listGamesByIds } from "./providers/igdb";
import { TTL } from "./providers/types";
import type { GamePerson, Person, PersonRole } from "./types";

const ENDPOINT = "https://query.wikidata.org/sparql";
const WEEK = 60 * 60 * 24 * 7;
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const QID = /^Q[1-9]\d{0,11}$/;

const ROLE_BY_PROP: Record<string, PersonRole> = {
  P57: "director",
  P287: "designer",
  P86: "composer",
  P162: "producer",
  P58: "writer",
};
const ROLE_ORDER: PersonRole[] = ["director", "designer", "writer", "composer", "producer"];
const PROPS = Object.keys(ROLE_BY_PROP).map((p) => `wdt:${p}`).join(" ");

interface Binding {
  [key: string]: { value: string } | undefined;
}

async function sparql(query: string): Promise<Binding[]> {
  const json = await politeJson<{ results?: { bindings?: Binding[] } }>(
    `${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`,
    6000,
  );
  return json.results?.bindings ?? [];
}

const qidOf = (uri: string | undefined) => {
  const id = uri?.split("/").pop() ?? "";
  return QID.test(id) ? id : null;
};
const roleOf = (uri: string | undefined) => ROLE_BY_PROP[uri?.split("/").pop() ?? ""] ?? null;

/** A Commons file URL → a ~256 px thumbnail on the same host. */
export function commonsThumb(fileUrl: string | undefined, width = 256): string | null {
  if (!fileUrl) return null;
  try {
    const url = new URL(fileUrl.replace(/^http:/, "https:"));
    if (url.hostname !== "commons.wikimedia.org" || !url.pathname.startsWith("/wiki/Special:FilePath/")) return null;
    url.search = `?width=${width}`;
    return url.toString();
  } catch {
    return null;
  }
}

const sortRoles = (roles: Iterable<PersonRole>) => [...new Set(roles)].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));

/* ---------------------------------------------------------------------------
 * A game's people
 * ------------------------------------------------------------------------ */

const cachedPeople = unstable_cache(
  async (slug: string): Promise<GamePerson[]> => {
    const rows = await sparql(`SELECT ?prop ?person ?personLabel ?image WHERE {
  ?game wdt:P5794 "${slug}" .
  VALUES ?prop { ${PROPS} }
  ?game ?prop ?person .
  OPTIONAL { ?person wdt:P18 ?image }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 80`);
    const byQid = new Map<string, GamePerson>();
    for (const row of rows) {
      const qid = qidOf(row.person?.value);
      const role = roleOf(row.prop?.value);
      const name = row.personLabel?.value;
      // An unlabelled item comes back as its own QID; that's not a name.
      if (!qid || !role || !name || QID.test(name)) continue;
      const entry = byQid.get(qid) ?? { qid, name, roles: [], image: commonsThumb(row.image?.value) };
      entry.roles = sortRoles([...entry.roles, role]);
      entry.image ??= commonsThumb(row.image?.value);
      byQid.set(qid, entry);
    }
    return [...byQid.values()]
      .sort((a, b) => ROLE_ORDER.indexOf(a.roles[0]) - ROLE_ORDER.indexOf(b.roles[0]) || a.name.localeCompare(b.name))
      .slice(0, 16);
  },
  ["wikidata-people-v1"],
  { revalidate: WEEK, tags: ["wikidata"] },
);

/** Directors, designers, writers, composers and producers; [] when Wikidata has none; undefined on failure. */
export async function peopleFor(igdbSlug: string | null): Promise<GamePerson[] | undefined> {
  if (!igdbSlug || !SAFE_SLUG.test(igdbSlug)) return [];
  try {
    return await cachedPeople(igdbSlug);
  } catch (err) {
    console.warn("[people] game lookup failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

/* ---------------------------------------------------------------------------
 * A person
 * ------------------------------------------------------------------------ */

const cachedPerson = unstable_cache(
  async (qid: string): Promise<Person | null> => {
    const rows = await sparql(`SELECT ?label ?desc ?image ?wp ?slug ?prop WHERE {
  BIND(wd:${qid} AS ?p)
  OPTIONAL { ?p rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL { ?p schema:description ?desc FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?p wdt:P18 ?image }
  OPTIONAL { ?wp schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> }
  OPTIONAL { VALUES ?prop { ${PROPS} } ?game ?prop ?p . ?game wdt:P5794 ?slug }
} LIMIT 400`);
    const name = rows.map((row) => row.label?.value).find(Boolean);
    if (!name) return null;

    const rolesBySlug = new Map<string, Set<PersonRole>>();
    for (const row of rows) {
      const slug = row.slug?.value;
      const role = roleOf(row.prop?.value);
      if (!slug || !role || !SAFE_SLUG.test(slug)) continue;
      rolesBySlug.set(slug, (rolesBySlug.get(slug) ?? new Set()).add(role));
    }
    // Credits on games IGDB doesn't have can't be shown as cards; the page is
    // still honest about who the person is.
    if (rolesBySlug.size === 0) return null;

    const slugs = [...rolesBySlug.keys()].sort().slice(0, 200);
    const idRows = await igdbCachedQuery<Array<{ id?: number; slug?: string }>>(
      "games",
      `fields slug;\nwhere slug = (${slugs.map((s) => `"${s}"`).join(",")});\nlimit 500;`,
      TTL.detail,
    );
    const slugById = new Map(idRows.filter((r) => typeof r.id === "number" && r.slug).map((r) => [r.id!, r.slug!]));
    const games = (await listGamesByIds([...slugById.keys()]))
      .map((game) => ({ game, roles: sortRoles(rolesBySlug.get(slugById.get(game.id) ?? game.slug) ?? []) }))
      .filter((entry) => entry.roles.length > 0);

    const counts = new Map<PersonRole, number>();
    for (const entry of games) for (const role of entry.roles) counts.set(role, (counts.get(role) ?? 0) + 1);
    const wikipedia = rows.map((row) => row.wp?.value).find((url) => url?.startsWith("https://en.wikipedia.org/")) ?? null;
    return {
      qid,
      name,
      description: rows.map((row) => row.desc?.value).find(Boolean) ?? null,
      image: commonsThumb(rows.map((row) => row.image?.value).find(Boolean), 400),
      wikipedia,
      roles: [...counts].sort((a, b) => b[1] - a[1] || ROLE_ORDER.indexOf(a[0]) - ROLE_ORDER.indexOf(b[0])).map(([role]) => role),
      games,
    };
  },
  ["wikidata-person-v1"],
  { revalidate: WEEK, tags: ["wikidata"] },
);

/**
 * A person page. Null when the QID isn't a person credited on any game IGDB
 * knows (render a 404), or when Wikidata/IGDB can't be reached — callers that
 * need to tell those apart can check `igdbConfigured()` and retry.
 */
export async function getPerson(qid: string): Promise<Person | null> {
  if (!QID.test(qid) || !igdbConfigured()) return null;
  try {
    return await cachedPerson(qid);
  } catch (err) {
    console.warn("[people] person lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
