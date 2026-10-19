import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CSSProperties } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { DataSourceNotice } from "@/components/ui/DataSourceNotice";
import { Stagger, StaggerItem } from "@/components/motion/Reveal";
import { getGenres, isDegraded } from "@/lib/games/source";
import { hueFromString } from "@/lib/utils/format";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Game genres",
  description: "Browse every game genre — action, RPG, strategy, indie and more.",
};

export default async function GenresPage() {
  const { data: genres, source } = await getGenres();

  return (
    <>
      <PageHeader
        eyebrow="Categories"
        title="Every genre"
        description="Pick a lane and see what's out, what's coming and what scored highest."
      />

      <Container className="py-10 lg:py-14">
        {source === "unavailable" && (
          <div className="mb-8">
            <DataSourceNotice source={source} degraded={isDegraded(source)} />
          </div>
        )}

        <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
          {genres.map((genre) => {
            const hue = hueFromString(genre.slug);
            return (
              <StaggerItem key={genre.id}>
                <Link
                  href={`/browse?genres=${genre.slug}`}
                  className="hue-tile group relative flex h-32 flex-col justify-end overflow-hidden rounded-2xl border border-line p-4 transition-all duration-500 fine:hover:border-line-strong fine:hover:shadow-[0_20px_50px_-24px_rgba(124,92,255,0.6)] lg:h-40"
                  style={{ "--tile-hue": hue, "--tile-hue-2": (hue + 50) % 360 } as CSSProperties}
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 opacity-0 transition-opacity duration-500 fine:group-hover:opacity-100"
                    style={{
                      background: `radial-gradient(85% 65% at 25% 0%, hsl(${hue} 88% 62% / 0.42), transparent 66%)`,
                    }}
                  />
                  <span
                    aria-hidden
                    className="absolute inset-0 opacity-[0.1]"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(118deg, rgba(255,255,255,0.85) 0 1px, transparent 1px 15px)",
                    }}
                  />
                  <ArrowUpRight
                    size={16}
                    className="absolute right-4 top-4 text-white/55 transition-all duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-white/80"
                  />
                  <span className="relative font-display text-lg font-bold leading-tight lg:text-xl">
                    {genre.name}
                  </span>
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      </Container>
    </>
  );
}
