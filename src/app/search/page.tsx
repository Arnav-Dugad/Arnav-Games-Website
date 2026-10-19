import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Search, SearchX } from "lucide-react";
import { SegmentedControl, type Segment } from "@/components/filters";
import { GameGrid } from "@/components/game/GameGrid";
import { SearchGameResults } from "@/components/search/SearchGameResults";
import { EntityTile, RecentSearchChips, RememberSearch, TopHitCard } from "@/components/search/SearchPageParts";
import { buildSections, pickTopHit, SEARCH_PROMPTS, type SectionId } from "@/components/search/model";
import { Container } from "@/components/ui/SectionHeading";
import { igdbConfigured, igdbSearchAll, listGamesByIds } from "@/lib/games/providers/igdb";
import { searchGames } from "@/lib/games/source";
import { applySearchAlias } from "@/lib/search/aliases";
import type { SearchHit } from "@/lib/games/search";
import { SOURCE_LABELS, type DataSource, type GameSummary } from "@/lib/games/types";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Search",
  description: "Search games, franchises, studios, characters, genres and platforms in one place.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const FULL_LIMITS = {
  games: 120,
  series: 10,
  franchises: 10,
  companies: 12,
  characters: 12,
  genres: 10,
  platforms: 10,
};

type View = "all" | Exclude<SectionId, "top">;
const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "All" },
  { value: "game", label: "Games" },
  { value: "franchise", label: "Franchises" },
  { value: "company", label: "Studios" },
  { value: "character", label: "Characters" },
  { value: "taxonomy", label: "Genres & platforms" },
];

const BROWSE_LINKS = [
  { label: "Upcoming releases", detail: "The full calendar", href: "/upcoming" },
  { label: "Top rated", detail: "Highest critic scores", href: "/browse?ordering=-metacritic" },
  { label: "Genres", detail: "Every kind of game", href: "/genres" },
  { label: "Platforms", detail: "Consoles, PC and handhelds", href: "/platforms" },
  { label: "Studios", detail: "Developers and publishers", href: "/studios" },
  { label: "Franchises", detail: "Connected universes", href: "/franchises" },
];

/** Every hit of a view's kind, in server (relevance) order. */
function hitsFor(view: Exclude<View, "all">, hits: SearchHit[]): SearchHit[] {
  return hits.filter((hit) =>
    view === "taxonomy" ? hit.kind === "genre" || hit.kind === "platform" : hit.kind === view,
  );
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = (first(params.q) ?? "").trim().slice(0, 80);
  const requested = first(params.type) as View | undefined;
  let hits: SearchHit[] = [];
  let games: GameSummary[] = [];
  // Typed rather than inferred: a bare string literal widens to `string`, which
  // then can't index the shared label map.
  let source: DataSource = "unavailable";

  if (query.length >= 2 && igdbConfigured()) {
    hits = await igdbSearchAll(query, FULL_LIMITS);
    if (hits.length > 0) source = "igdb";
  }

  if (query.length >= 2 && hits.length === 0) {
    const fallback = await searchGames(query, FULL_LIMITS.games);
    source = fallback.source;
    games = fallback.data.results;
    hits = games.map((game) => ({
      kind: "game" as const,
      id: game.id,
      name: game.name,
      slug: game.slug,
      subtitle: game.genres.slice(0, 2).map((genre) => genre.name).join(" · ") || "Game",
      image: game.image,
      released: game.released,
      releaseWindow: game.releaseWindow,
      tba: game.tba,
    }));
  }

  // Owner-approved aliases ("botw" → Breath of the Wild) lead the results,
  // exactly as they do in the overlay via /api/search.
  let aliased = false;
  if (query.length >= 2) {
    const before = hits[0];
    hits = await applySearchAlias(query, hits);
    aliased = hits[0] !== before && hits[0]?.kind === "game";
  }

  if (source === "igdb" || (aliased && igdbConfigured())) {
    // Search hits carry identity only; the grid, filters and top-hit card
    // need full summaries. One batched, cached lookup, then back into the
    // server's relevance order (Steam fallback results already are summaries).
    const ids = hits.filter((hit) => hit.kind === "game").map((hit) => hit.id);
    const known = new Map(games.map((game) => [game.id, game]));
    const missing = ids.filter((id) => !known.has(id));
    const summaries = missing.length ? await listGamesByIds(missing).catch(() => [] as GameSummary[]) : [];
    for (const game of summaries) known.set(game.id, game);
    games = ids.map((id) => known.get(id)).filter((game): game is GameSummary => Boolean(game));
  }

  const counts: Record<Exclude<View, "all">, number> = {
    game: hitsFor("game", hits).length,
    franchise: hitsFor("franchise", hits).length,
    company: hitsFor("company", hits).length,
    character: hitsFor("character", hits).length,
    taxonomy: hitsFor("taxonomy", hits).length,
  };
  const view: View = requested && requested !== "all" && counts[requested] > 0 ? requested : "all";
  const hrefFor = (next: View) =>
    `/search?q=${encodeURIComponent(query)}${next === "all" ? "" : `&type=${next}`}`;
  const segments: Segment<View>[] = VIEWS.filter((entry) => entry.value === "all" || counts[entry.value] > 0).map(
    (entry) => ({
      value: entry.value,
      label: entry.label,
      shortLabel: entry.value === "taxonomy" ? "Genres" : undefined,
      count: entry.value === "all" ? undefined : counts[entry.value],
      href: hrefFor(entry.value),
    }),
  );

  return (
    <>
      <header className="relative isolate pt-24 lg:pt-32" data-track-src="search:page">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(60%_80%_at_20%_0%,color-mix(in_oklab,var(--color-brand)_16%,transparent),transparent_70%)]"
        />
        <Container>
          <h1 className="font-display text-[34px] font-bold tracking-[-0.03em] sm:text-5xl">Search</h1>

          <form action="/search" role="search" className="mt-5 max-w-3xl">
            <label htmlFor="discovery-search" className="sr-only">Search the complete database</label>
            <div className="flex items-center gap-3 rounded-2xl bg-fg/[0.08] px-4 shadow-[inset_0_0_0_1px_var(--color-line)] transition-shadow focus-within:shadow-[inset_0_0_0_2px_var(--color-brand-soft)] sm:rounded-full sm:px-5">
              <Search size={19} aria-hidden className="shrink-0 text-muted" />
              <input
                id="discovery-search"
                name="q"
                type="search"
                defaultValue={query}
                placeholder="Games, franchises, studios, characters…"
                autoComplete="off"
                enterKeyHint="search"
                className="h-12 min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-faint sm:h-14 sm:text-[19px]"
              />
              <button
                type="submit"
                className="press -mr-2 hidden min-h-10 items-center gap-1.5 rounded-full bg-fg px-4 text-[14px] font-semibold text-bg sm:inline-flex"
              >
                Search
              </button>
            </div>
          </form>

          {query.length >= 2 && hits.length > 0 && (
            <>
              <p className="mt-4 text-[15px] text-muted">
                <span className="font-semibold tabular-nums text-text">{hits.length}</span>{" "}
                {hits.length === 1 ? "result" : "results"} for “<span className="break-words [overflow-wrap:anywhere]">{query}</span>”
                <span className="text-faint"> · {SOURCE_LABELS[source]}</span>
              </p>
              {segments.length > 2 && (
                <SegmentedControl label="Result type" segments={segments} value={view} fill={false} className="mt-5 w-fit max-w-full" />
              )}
            </>
          )}
        </Container>
      </header>

      <Container className="pb-16 pt-8 lg:pb-24 lg:pt-10">
        {query.length < 2 ? (
          <Discovery />
        ) : hits.length === 0 ? (
          <NoResults query={query} unavailable={source === "unavailable"} />
        ) : view === "all" ? (
          <AllResults hits={hits} games={games} query={query} hrefFor={hrefFor} aliased={aliased} />
        ) : view === "game" ? (
          games.length > 0 ? (
            <div data-track-src="search:game">
              <SearchGameResults key={query} games={games} query={query} />
            </div>
          ) : (
            // Summaries unavailable: still list the matches, just unfiltered.
            <EntityGrid hits={hitsFor("game", hits)} />
          )
        ) : (
          <div data-track-src={`search:${view}`}>
            <EntityGrid hits={hitsFor(view, hits)} />
          </div>
        )}
        {query.length >= 2 && hits.length > 0 && <RememberSearch term={query} />}
      </Container>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function AllResults({
  hits,
  games,
  query,
  hrefFor,
  aliased,
}: {
  hits: SearchHit[];
  games: GameSummary[];
  query: string;
  hrefFor: (view: View) => string;
  /** An approved alias put its game first: that is the top hit, full stop. */
  aliased: boolean;
}) {
  const top = aliased ? hits[0] : preferKnown(pickTopHit(hits, query), hits, games);
  const topGame = top?.kind === "game" ? (games.find((game) => game.id === top.id) ?? null) : null;
  const sections = buildSections(hits, query, { franchise: 6, company: 6, character: 6, taxonomy: 6 }).filter(
    (section) => section.id !== "top",
  );
  // 12 fills whole rows of the 2/3/4/6-column grid.
  const gameGrid = games.filter((game) => game.id !== top?.id).slice(0, 12);

  return (
    <div className="space-y-12 lg:space-y-16">
      {top && (
        <div data-track-src="search:top-hit">
          <TopHitCard hit={top} game={topGame} />
        </div>
      )}

      {sections.map((section) => {
        if (section.id === "top") return null;
        const total = section.total;
        return (
          <section key={section.id} aria-labelledby={`results-${section.id}`} data-track-src={`search:${section.id}`}>
            <div className="flex items-end justify-between gap-4">
              <h2 id={`results-${section.id}`} className="text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">
                {section.label}
                <span className="ml-2 text-[15px] font-medium tabular-nums text-faint sm:text-[17px]">{total}</span>
              </h2>
              {(section.id === "game" ? total > gameGrid.length + (topGame ? 1 : 0) : section.more > 0) && (
                <Link
                  href={hrefFor(section.id)}
                  className="press group relative inline-flex shrink-0 items-center gap-1 text-[15px] font-medium text-brand-soft after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
                >
                  See all <ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              )}
            </div>
            <div className="mt-5 sm:mt-6">
              {section.id === "game" && gameGrid.length > 0 ? (
                <GameGrid games={gameGrid} priorityCount={0} />
              ) : (
                <EntityGrid hits={section.hits} />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Relevance, with a guard for name collisions. The server's ranking puts an
 * exact title match first, which is usually right — but "Cyberpunk" is also
 * the exact name of an obscure 2019 release nobody means. When the exact
 * match has almost no audience and a game a few places down has a large one
 * (by IGDB rating counts, which only the full summaries carry), the known
 * game leads instead. Non-game top hits are left alone.
 */
function preferKnown(top: SearchHit | null, hits: SearchHit[], games: GameSummary[]): SearchHit | null {
  if (!top || top.kind !== "game") return top;
  const byId = new Map(games.map((game) => [game.id, game]));
  const current = byId.get(top.id);
  if (!current || current.ratingsCount >= 25) return top;
  const contender = hits
    .filter((hit) => hit.kind === "game")
    .slice(0, 6)
    .map((hit) => ({ hit, game: byId.get(hit.id) }))
    .filter((entry) => (entry.game?.ratingsCount ?? 0) >= 200)
    .sort((a, b) => (b.game?.ratingsCount ?? 0) - (a.game?.ratingsCount ?? 0))[0];
  return contender?.hit ?? top;
}

function EntityGrid({ hits }: { hits: SearchHit[] }) {
  return (
    <ul className="-mx-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {hits.map((hit) => (
        <li key={`${hit.kind}-${hit.id}`} className="min-w-0">
          <EntityTile hit={hit} />
        </li>
      ))}
    </ul>
  );
}

function NoResults({ query, unavailable }: { query: string; unavailable: boolean }) {
  return (
    <div className="mx-auto max-w-2xl py-6 text-center sm:py-10">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-fg/[0.06] text-faint">
        <SearchX size={24} aria-hidden />
      </span>
      <h2 className="mt-5 break-words text-[22px] font-bold tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-[28px]">
        {unavailable ? "Search is unavailable right now" : `No results for “${query}”`}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted sm:text-[17px]">
        {unavailable
          ? "The game database didn’t answer. Try again in a moment."
          : "Check the spelling, try fewer or different words, or search game titles only."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        <Link
          href={`/browse?search=${encodeURIComponent(query)}`}
          className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-fg px-5 text-[15px] font-semibold text-bg"
        >
          Search game titles <ArrowRight size={15} aria-hidden />
        </Link>
        <Link href="/browse" className="press inline-flex min-h-11 items-center rounded-full bg-fg/[0.08] px-5 text-[15px] font-semibold">
          Browse everything
        </Link>
      </div>
      <p className="mt-10 text-[13px] font-semibold text-muted">Or try</p>
      <PromptChips className="mt-3 justify-center" />
    </div>
  );
}

function PromptChips({ className }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-2 ${className ?? ""}`}>
      {SEARCH_PROMPTS.map((prompt) => (
        <li key={prompt}>
          <Link
            href={`/search?q=${encodeURIComponent(prompt)}`}
            className="press inline-flex min-h-10 items-center rounded-full bg-fg/[0.07] px-4 text-[14px] transition-colors fine:hover:bg-fg/[0.11] coarse:min-h-11"
          >
            {prompt}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Discovery() {
  return (
    <div className="max-w-5xl">
      <RecentSearchChips />
      <section aria-labelledby="search-try">
        <h2 id="search-try" className="text-[13px] font-semibold text-muted">Try searching for</h2>
        <PromptChips className="mt-3" />
      </section>
      <section aria-labelledby="search-browse" className="mt-12">
        <h2 id="search-browse" className="text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">Browse instead</h2>
        <ul className="-mx-3 mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {BROWSE_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="group flex min-h-[72px] items-center gap-3 rounded-2xl px-3 transition-colors fine:hover:bg-fg/[0.05]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold tracking-[-0.01em]">{link.label}</span>
                  <span className="block text-[13px] text-muted">{link.detail}</span>
                </span>
                <ArrowUpRight size={16} aria-hidden className="shrink-0 text-faint transition-transform fine:group-hover:-translate-y-0.5 fine:group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
