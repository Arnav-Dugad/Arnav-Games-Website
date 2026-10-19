import type { Metadata } from "next";
import { SearchX } from "lucide-react";
import { BrowseControls } from "@/components/game/BrowseControls";
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
    "Filter the full game database by genre, platform and score, sorted however you like.",
};

const PAGE_SIZE = 24;

/** Next 15+ delivers search params asynchronously. */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const search = first(sp.search);
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

  return (
    <>
      <PageHeader
        eyebrow={search ? "Browse" : undefined}
        title={search ? `Results for “${search}”` : "Browse"}
        description={search ? undefined : "Every game in the database. Filter by genre, platform, score or era, and sort it your way."}
      />

      <Container className="py-8 lg:py-12">
        {source === "unavailable" && (
          <div className="mb-7">
            <DataSourceNotice source={source} degraded={isDegraded(source)} />
          </div>
        )}

        <BrowseControls
          genres={genreList.data}
          platforms={platformList.data}
          totalCount={data.count}
        />

        <div className="mt-8">
          {data.results.length === 0 ? (
            <EmptyResults search={search} />
          ) : (
            <>
              <GameGrid games={data.results} priorityCount={5} />
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
      </Container>
    </>
  );
}

function EmptyResults({ search }: { search?: string }) {
  return (
    <EmptyState
      icon={<SearchX size={24} />}
      title={search ? `Nothing found for “${search}”` : "No games match those filters"}
      body={
        search
          ? "Try a shorter term, or a differently spelled title — search also matches alternative names like “GTA V”."
          : "Try removing a filter or two, or search for a title directly."
      }
      action={{ href: "/browse", label: "Reset filters" }}
      secondaryAction={{ href: "/upcoming", label: "See what's coming" }}
    />
  );
}
