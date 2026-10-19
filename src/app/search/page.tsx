import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Command,
  Search,
  SearchX,
  Sparkles,
} from "lucide-react";
import { SearchHitVisual, SearchKindIcon } from "@/components/search/SearchHitVisual";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { Aurora, GridLines } from "@/components/motion/Aurora";
import { Container } from "@/components/ui/SectionHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import { igdbConfigured, igdbSearchAll } from "@/lib/games/providers/igdb";
import { searchGames } from "@/lib/games/source";
import {
  SEARCH_KIND_LABELS,
  SEARCH_KIND_ORDER,
  groupSearchHits,
  hrefForSearchHit,
  type SearchHit,
  type SearchKind,
} from "@/lib/games/search";
import { SOURCE_LABELS, type DataSource } from "@/lib/games/types";
import { cn } from "@/lib/utils/cn";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Search the game universe",
  description: "Search games, franchises, studios, characters, genres and platforms in one place.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

const FULL_LIMITS = {
  games: 120,
  series: 10,
  franchises: 10,
  companies: 12,
  characters: 12,
  genres: 10,
  platforms: 10,
};

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const query = (first((await searchParams).q) ?? "").trim().slice(0, 80);
  let hits: SearchHit[] = [];
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
    hits = fallback.data.results.map((game) => ({
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

  const groups = groupSearchHits(hits);
  const populatedKinds = SEARCH_KIND_ORDER.filter((kind) => (groups.get(kind)?.length ?? 0) > 0);

  return (
    <>
      <header className="noise relative isolate overflow-hidden border-b border-line pb-10 pt-24 lg:pb-14 lg:pt-36">
        <Aurora intensity="subtle" className="-z-10" />
        <GridLines className="-z-10 opacity-50" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-bg to-transparent" />
        <Container>
          <Reveal>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-brand-soft"><Sparkles size={14} /> Universal discovery</p>
            <h1 className="mt-4 max-w-4xl font-display text-[clamp(2.5rem,7vw,5.6rem)] font-black leading-[0.95] tracking-[-0.055em]">
              Find anything in the <span className="text-gradient">game universe.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-base">Games, studios, franchises, characters, genres and platforms—correctly separated and instantly connected.</p>
          </Reveal>

          <Reveal delay={0.12} className="mt-8">
            <form action="/search" className="group flex max-w-4xl items-center gap-3 rounded-2xl border border-line-strong bg-bg/75 p-2 shadow-[0_28px_90px_-45px_rgba(124,92,255,0.8)] backdrop-blur-xl light:bg-panel/90 light:shadow-[0_24px_70px_-40px_rgba(106,77,255,0.55)] transition-colors focus-within:border-brand/60 sm:rounded-3xl sm:p-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/12 text-brand-soft sm:h-12 sm:w-12 sm:rounded-2xl"><Search size={19} /></span>
              <label htmlFor="discovery-search" className="sr-only">Search the complete database</label>
              <input id="discovery-search" name="q" type="search" defaultValue={query} placeholder="Try Cyberpunk, Nintendo, Kratos…" autoComplete="off" className="min-w-0 flex-1 bg-transparent py-3 text-base font-medium outline-none placeholder:text-faint sm:text-lg" />
              <button type="submit" className="hidden min-h-12 items-center gap-2 rounded-2xl bg-text px-5 text-sm font-bold text-bg transition-transform hover:-translate-y-0.5 sm:inline-flex">Search <ArrowRight size={15} /></button>
            </form>
          </Reveal>

          {query.length >= 2 && (
            <Reveal delay={0.18} className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="rounded-full border border-line bg-fg/[0.035] px-3 py-1.5"><strong className="text-text tabular-nums">{hits.length}</strong> direct matches</span>
              <span className="rounded-full border border-line bg-fg/[0.035] px-3 py-1.5"><strong className="text-text tabular-nums">{populatedKinds.length}</strong> entity types</span>
              {/* `SOURCE_LABELS` is the shared human wording. Interpolating the
                  raw union leaked internal values like "unavailable" to readers. */}
              <span className="rounded-full border border-line bg-fg/[0.035] px-3 py-1.5">Source: {SOURCE_LABELS[source]}</span>
            </Reveal>
          )}
        </Container>
      </header>

      <Container className="py-10 lg:py-16">
        {query.length < 2 ? (
          <DiscoveryEmpty />
        ) : hits.length === 0 ? (
          <EmptyState
            icon={<SearchX size={24} />}
            title={`No matches for “${query}”`}
            body="Try a shorter name, an alternative spelling, or open the complete game catalogue."
            action={{ href: `/browse?search=${encodeURIComponent(query)}`, label: "Search game titles" }}
            secondaryAction={{ href: "/browse", label: "Browse everything" }}
          />
        ) : (
          <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
            <aside className="hidden lg:block">
              <div className="sticky top-28 rounded-3xl border border-line bg-panel/35 p-3">
                <p className="px-3 pb-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-faint">Result map</p>
                {populatedKinds.map((kind) => (
                  <a key={kind} href={`#${kind}`} className="group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:bg-fg/[0.05] hover:text-text">
                    <span className="flex items-center gap-2.5"><SearchKindIcon kind={kind} size={14} /> {SEARCH_KIND_LABELS[kind]}</span>
                    <span className="text-xs tabular-nums text-faint">{groups.get(kind)?.length}</span>
                  </a>
                ))}
                <Link href={`/browse?search=${encodeURIComponent(query)}`} className="mt-3 flex items-center justify-between rounded-2xl border border-brand/25 bg-brand/10 p-3 text-xs font-semibold text-brand-soft transition-colors hover:bg-brand/15">Search games only <ArrowRight size={14} /></Link>
              </div>
            </aside>

            <div className="min-w-0 space-y-14">
              {populatedKinds.map((kind) => <ResultSection key={kind} kind={kind} hits={groups.get(kind) ?? []} />)}
            </div>
          </div>
        )}
      </Container>
    </>
  );
}

function ResultSection({ kind, hits }: { kind: SearchKind; hits: SearchHit[] }) {
  return (
    <section id={kind} className="scroll-mt-28">
      <Reveal className="mb-5 flex items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-brand-soft"><SearchKindIcon kind={kind} size={14} /> Entity type</p>
          <h2 className="mt-1.5 font-display text-2xl font-black sm:text-3xl">{SEARCH_KIND_LABELS[kind]}</h2>
        </div>
        <span className="rounded-full border border-line bg-fg/[0.03] px-3 py-1.5 text-xs text-faint">{hits.length} {hits.length === 1 ? "match" : "matches"}</span>
      </Reveal>

      <Stagger className={cn("grid gap-3", kind === "game" ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-3")} gap={0.035} onMount>
        {hits.map((hit) => (
          <StaggerItem key={`${hit.kind}-${hit.id}`}>
            <Link href={hrefForSearchHit(hit)} className="group flex h-full min-h-32 min-w-0 items-center gap-4 overflow-hidden rounded-3xl border border-line bg-panel/30 p-4 transition-[transform,border-color,background-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-brand/35 hover:bg-panel/55 hover:shadow-[0_24px_60px_-38px_rgba(124,92,255,0.65)]">
              <SearchHitVisual hit={hit} size="card" />
              <span className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.07em] text-faint"><SearchKindIcon kind={hit.kind} size={11} /> {SEARCH_KIND_LABELS[hit.kind]}</span>
                <span className="mt-1.5 line-clamp-2 max-w-full break-words font-display text-base font-bold leading-snug transition-colors [overflow-wrap:anywhere] group-hover:text-brand-soft">{hit.name}</span>
                {hit.subtitle && <span className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{hit.subtitle}</span>}
              </span>
              <ArrowRight size={15} className="shrink-0 text-faint transition-transform group-hover:translate-x-1 group-hover:text-brand-soft" />
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

function DiscoveryEmpty() {
  const prompts = ["Cyberpunk", "Final Fantasy", "Nintendo", "Kratos", "Role-playing", "PlayStation 5"];
  return (
    <div className="mx-auto max-w-5xl">
      <Reveal className="rounded-[2rem] border border-line bg-[radial-gradient(circle_at_20%_0%,rgba(124,92,255,0.15),transparent_45%),color-mix(in_oklab,var(--color-fg)_2%,transparent)] p-6 sm:p-9">
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-brand/20 bg-brand/10 text-brand-soft"><Command size={21} /></span>
        <h2 className="mt-5 font-display text-2xl font-black sm:text-3xl">One query. The whole universe.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">Search a title, a fictional universe, the people who made it, a character you remember, or the hardware you play on.</p>
        <div className="mt-7 flex flex-wrap gap-2">
          {prompts.map((prompt) => <Link key={prompt} href={`/search?q=${encodeURIComponent(prompt)}`} className="rounded-full border border-line bg-fg/[0.035] px-4 py-2 text-sm text-muted transition-colors hover:border-brand/35 hover:text-text">{prompt}</Link>)}
        </div>
      </Reveal>
    </div>
  );
}
