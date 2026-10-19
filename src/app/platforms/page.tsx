import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { PLATFORM_GROUPS } from "@/components/filters/platform-systems";
import { byId, platformIds, taxonomyShowcase } from "@/app/genres/_lib/showcase";
import { TaxonomyTile } from "@/app/genres/_components/TaxonomyTile";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Game platforms",
  description: "Browse games by platform — PlayStation, Xbox, Nintendo, PC and mobile.",
};

/**
 * Systems grouped by family. A family heading opens the whole family in
 * /browse; each tile opens one system. IGDB's platform list is ~200 entries
 * of arcade boards and 1980s home computers, so this is a curated set of
 * the systems people actually shop for — and each tile's count is the
 * count its browse link returns.
 */
export default async function PlatformsPage() {
  const slugs = PLATFORM_GROUPS.flatMap((group) => group.systems.map((system) => system.slug));
  const ids = await platformIds(slugs);
  const showcase = await taxonomyShowcase(byId("platforms", ids));

  return (
    <>
      <PageHeader title="Platforms" />

      <Container className="space-y-10 pb-12 sm:space-y-12 lg:pb-16">
        {PLATFORM_GROUPS.map((group) => (
          <section key={group.family} aria-labelledby={`family-${group.family}`}>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2
                id={`family-${group.family}`}
                className="flex items-center gap-2.5 text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]"
              >
                <PlatformIcons platforms={[{ slug: group.family }]} size={20} className="[&_li]:text-text" />
                {group.name}
              </h2>
              <Link
                href={`/browse?platforms=${group.family}`}
                className="press relative inline-flex shrink-0 items-center gap-0.5 text-[15px] font-medium text-brand-soft after:absolute after:-inset-3 after:content-['']"
              >
                See all
                <ChevronRight size={16} aria-hidden />
                <span className="sr-only"> {group.name} games</span>
              </Link>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
              {group.systems.map((system, i) => (
                <li key={system.slug}>
                  <TaxonomyTile
                    href={`/browse?platforms=${system.slug}`}
                    name={system.name}
                    // A slight drift per system so a family reads as one colour without identical tiles.
                    hue={(group.hue + i * 8) % 360}
                    showcase={showcase.get(system.slug)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Container>
    </>
  );
}
