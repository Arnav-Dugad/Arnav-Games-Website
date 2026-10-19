import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntityDirectory, StudioCard } from "@/components/game/EntityDirectory";
import { igdbStudiosDirectory, igdbTopStudios } from "@/lib/games/providers/igdb";
import { letterQuery, parseDirectorySearchParams, type DirectorySearchParams } from "@/lib/games/directory";

// The provider results are cached; the shell stays dynamic so a failed
// build-time request cannot publish an empty directory for a week.
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Game studios",
  description: "The developers and publishers behind the games — search them, or jump from A to Z.",
};

const PAGE_SIZE = 60;

export default async function StudiosPage({
  searchParams,
}: {
  searchParams: Promise<DirectorySearchParams>;
}) {
  const filters = parseDirectorySearchParams(await searchParams);
  const popular = !filters.query && !filters.letter;

  const [top, directory] = await Promise.all([
    popular ? igdbTopStudios(PAGE_SIZE) : null,
    popular
      ? null
      : igdbStudiosDirectory({
          query: filters.query || letterQuery(filters.letter!),
          page: filters.page,
          order: filters.order,
          pageSize: PAGE_SIZE,
        }),
  ]);

  const items = popular
    ? (top ?? []).map((studio) => ({ ...studio, gameCount: null }))
    : (directory?.results ?? []);
  const unavailable = popular ? !top : !directory;

  return (
    <>
      <PageHeader title="Studios" className="pb-4 sm:pb-6 lg:pb-8" />
      <Container className="pb-12 lg:pb-16">
        <EntityDirectory
          kind="studio"
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
              icon={<Building2 size={24} />}
              title="Studios aren't loading"
              body="IGDB, where this list comes from, isn't answering. Try again in a minute."
              action={{ href: "/browse", label: "Browse games" }}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Building2 size={24} />}
              title={filters.query ? `No studios match “${filters.query}”` : "No studios here"}
              body={filters.query ? "Check the spelling, or try part of the name." : undefined}
              action={{ href: "/studios", label: "Show popular studios" }}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {items.map((studio, index) => (
                <li key={studio.id}>
                  <StudioCard
                    slug={studio.slug}
                    name={studio.name}
                    logo={studio.logo}
                    gameCount={studio.gameCount}
                    priority={index < 6}
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
