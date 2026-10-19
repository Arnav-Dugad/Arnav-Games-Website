/**
 * Shared search presentation logic: how a flat list of hits becomes a "Top
 * hit" plus kind sections. Pure and server-safe (the /search page uses it
 * on the server); the recent-searches hook lives in `recent.ts`.
 *
 * Used by both the ⌘K overlay and the /search page so the two always agree
 * on what the top hit is and how results are grouped.
 */

import { normaliseSearch } from "@/lib/games/fuzzy-search";
import type { SearchHit, SearchKind } from "@/lib/games/search";

/* ------------------------------------------------------------------ Sections */

export type SectionId = "top" | "game" | "franchise" | "company" | "character" | "taxonomy";

export interface SearchSection {
  id: SectionId;
  label: string;
  hits: SearchHit[];
  /** How many hits of this kind exist in total (including a top hit of this kind). */
  total: number;
  /** How many of this kind were cut by the per-section cap. */
  more: number;
}

const SECTION_LABELS: Record<Exclude<SectionId, "top">, string> = {
  game: "Games",
  franchise: "Franchises",
  company: "Studios",
  character: "Characters",
  taxonomy: "Genres & platforms",
};

const sectionOf = (kind: SearchKind): Exclude<SectionId, "top"> =>
  kind === "genre" || kind === "platform" ? "taxonomy" : kind;

/**
 * The single best answer. The server already ranks games by relevance (typo
 * tolerant), so the first hit wins — unless the query *exactly* names a
 * studio, franchise, character, genre or platform and doesn't exactly name
 * that game: "Nintendo" should lead with the studio, "Zelda" with the game.
 */
export function pickTopHit(hits: SearchHit[], query: string): SearchHit | null {
  if (hits.length === 0) return null;
  const q = normaliseSearch(query);
  const first = hits[0];
  if (first.kind === "game" && normaliseSearch(first.name) === q) return first;
  const exactEntity = hits.find((hit) => hit.kind !== "game" && normaliseSearch(hit.name) === q);
  return exactEntity ?? first;
}

export function buildSections(
  hits: SearchHit[],
  query: string,
  limits: Partial<Record<Exclude<SectionId, "top">, number>> = {},
): SearchSection[] {
  const top = pickTopHit(hits, query);
  const sections: SearchSection[] = top ? [{ id: "top", label: "Top hit", hits: [top], total: 1, more: 0 }] : [];
  const order: Exclude<SectionId, "top">[] = ["game", "franchise", "company", "character", "taxonomy"];
  for (const id of order) {
    const all = hits.filter((hit) => sectionOf(hit.kind) === id);
    const rest = all.filter((hit) => hit !== top);
    if (rest.length === 0) continue;
    const limit = limits[id] ?? Infinity;
    const shown = rest.slice(0, limit);
    sections.push({ id, label: SECTION_LABELS[id], hits: shown, total: all.length, more: rest.length - shown.length });
  }
  return sections;
}

/** Example queries spanning every entity kind — a prompt, not a ranking. */
export const SEARCH_PROMPTS = ["Zelda", "FromSoftware", "Kratos", "Metroidvania", "Final Fantasy", "PlayStation 5"];
