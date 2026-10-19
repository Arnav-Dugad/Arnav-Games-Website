import type { Metadata } from "next";
import { SearchX } from "lucide-react";
import {
  BrowseControls,
  BrowsePendingProvider,
  BrowsePendingRegion,
} from "@/components/game/BrowseControls";
import { GameGrid } from "@/components/game/GameGrid";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { Pagination } from "@/components/ui/Pagination";
import { DataSourceNotice } from "@/components/ui/DataSourceNotice";
import { EmptyState } from "@/components/ui/EmptyState";
import { browseGames, getGenres, getPlatforms, isDegraded } from "@/lib/games/source";
import type { SortKey } from "@/lib/games/types";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Browse games",
  description:
    "Search and filter the full game database by genre, platform, score and era, sorted however you like.",
};

const PAGE_SIZE = 24;

/** Next 15+ delivers search params asynchronously. */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const search = first(sp.search)?.trim() || undefined;
  const genres = first(sp.genres);
  const platforms = first(sp.platforms);
  const dates = first(sp.dates);
  const metacritic = first(sp.metacritic);
  const ordering = first(sp.ordering) as SortKey | undefined;
  const page = Math.max(1, Number(first(sp.page) ?? 1) || 1);

  const [{ data, source }, genreList, platformList] = await Promise.all([
    browseGames({ search, genres, platforms, dates, metacritic, ordering, page, pageSize: PAGE_SIZE }),
    getGenres(),
    getPlatforms(),
  ]);

  const totalPages = data.count > 0 ? Math.ceil(data.count / PAGE_SIZE) : 1;
  const filtered = Boolean(genres || platforms || dates || metacritic);

  return (
    <BrowsePendingProvider>
      <PageHeader title="Browse" className="pb-4 sm:pb-6 lg:pb-8" />

      <Container className="pb-12 lg:pb-16">
        {source === "unavailable" && (
          <div className="mb-7">
            <DataSourceNotice source={source} degraded={isDegraded(source)} />
          </div>
        )}

        <BrowseControls
          genres={genreList.data}
          platforms={platformList.data}
          totalCount={data.count}
          searchable
          showQuickFilters
          // A search is ranked by how well titles match the words typed;
          // IGDB ignores any sort alongside it, so the menu would be a
          // control that does nothing.
          showSort={!search}
        />

        <BrowsePendingRegion>
          <div className="mt-6 sm:mt-8">
            {data.results.length === 0 ? (
              source === "unavailable" ? null : <EmptyResults search={search} filtered={filtered} />
            ) : (
              <>
                <GameGrid games={data.results} priorityCount={6} />
                <Pagination
                  page={page}
                  hasNext={data.hasNext}
                  totalPages={totalPages}
                  basePath="/browse"
                  params={{ search, genres, platforms, dates, metacritic, ordering }}
                />
              </>
            )}
          </div>
        </BrowsePendingRegion>
      </Container>
    </BrowsePendingProvider>
  );
}

function EmptyResults({ search, filtered }: { search?: string; filtered: boolean }) {
  const resetHref = search ? `/browse?search=${encodeURIComponent(search)}` : "/browse";
  return (
    <EmptyState
      icon={<SearchX size={24} />}
      title={search ? `No games found for “${search}”` : "No games match these filters"}
      body={
        search
          ? filtered
            ? "Try removing a filter, or check the spelling."
            : "Check the spelling, or try a shorter title. Nicknames like “GTA V” work too."
          : "Try removing a filter or two."
      }
      action={filtered ? { href: resetHref, label: "Clear filters" } : { href: "/browse", label: "Clear search" }}
    />
  );
}
