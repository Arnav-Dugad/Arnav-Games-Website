import type { Metadata } from "next";
import { Layers } from "lucide-react";
import { EntityDirectory } from "@/components/game/EntityDirectory";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { letterQuery, parseDirectorySearchParams, type DirectorySearchParams } from "@/lib/games/directory";
import { igdbFranchiseDirectory, igdbTopFranchises } from "@/lib/games/providers/igdb";
import { hueFromString } from "@/lib/utils/format";
import { bySeriesSlug, taxonomyShowcase } from "@/app/genres/_lib/showcase";
import { TaxonomyTile } from "@/app/genres/_components/TaxonomyTile";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Game franchises",
  description: "Every game series — search them, or jump from A to Z.",
};

const PAGE_SIZE = 60;

export default async function FranchiseDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<DirectorySearchParams>;
}) {
  const filters = parseDirectorySearchParams(await searchParams);
  const popular = !filters.query && !filters.letter;

  const [top, directory] = await Promise.all([
    popular ? igdbTopFranchises(PAGE_SIZE) : null,
    popular
      ? null
      : igdbFranchiseDirectory({
          query: filters.query || letterQuery(filters.letter!),
          page: filters.page,
          order: filters.order,
          pageSize: PAGE_SIZE,
        }),
  ]);

  const items: { id: number; slug: string; name: string; gameCount: number | null }[] = popular
    ? // IGDB often has a franchise *and* a collection for one series ("Call of
      // Duty" twice, different slugs). Both resolve to the same page, so the
      // more popular one stands for the series.
      (top ?? [])
        .filter((entry, index, all) => all.findIndex((other) => other.name.toLowerCase() === entry.name.toLowerCase()) === index)
        .map((entry) => ({ ...entry, gameCount: null }))
    : (directory?.results ?? []);
  const unavailable = popular ? !top : !directory;

  // One cover per series — the most-rated game in it — so tiles carry real
  // art. Batched (ten per request) and cached; a miss leaves a colour tile.
  const art = await taxonomyShowcase(bySeriesSlug(items.map((item) => item.slug)), { count: false, covers: 1 });

  return (
    <>
      <PageHeader title="Franchises" className="pb-4 sm:pb-6 lg:pb-8" />
      <Container className="pb-12 lg:pb-16">
        <EntityDirectory
          kind="franchise"
          query={filters.query}
          letter={filters.letter}
          count={directory?.count ?? null}
          page={directory?.page ?? 1}
          totalPages={directory?.count != null ? Math.max(1, Math.ceil(directory.count / PAGE_SIZE)) : undefined}
          hasNext={directory?.hasNext ?? false}
        >
          {unavailable ? (
            <EmptyState
              tone="unavailable"
              icon={<Layers size={24} />}
              title="Franchises aren't loading"
              body="IGDB, where this list comes from, isn't answering. Try again in a minute."
              action={{ href: "/browse", label: "Browse games" }}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Layers size={24} />}
              title={filters.query ? `No franchises match “${filters.query}”` : "No franchises here"}
              body={filters.query ? "Check the spelling, or try part of the name." : undefined}
              action={{ href: "/franchises", label: "Show popular franchises" }}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5">
              {items.map((item) => (
                <li key={`${item.id}-${item.slug}`}>
                  <TaxonomyTile
                    href={`/franchise/${item.slug}`}
                    name={item.name}
                    hue={hueFromString(item.slug)}
                    showcase={{ count: item.gameCount, covers: art.get(item.slug)?.covers ?? [] }}
                  />
                </li>
              ))}
            </ul>
          )}
        </EntityDirectory>
      </Container>
    </>
  );
}
