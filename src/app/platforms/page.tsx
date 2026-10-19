import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CSSProperties } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { DataSourceNotice } from "@/components/ui/DataSourceNotice";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { Stagger, StaggerItem } from "@/components/motion/Reveal";
import { getPlatforms, isDegraded } from "@/lib/games/source";
import { hueFromString } from "@/lib/utils/format";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Game platforms",
  description: "Browse games by platform — PC, PlayStation, Xbox, Nintendo, mobile and more.",
};

export default async function PlatformsPage() {
  const { data: platforms, source } = await getPlatforms();

  return (
    <>
      <PageHeader
        eyebrow="Hardware"
        title="Every platform"
        description="See what's releasing on the systems you actually own."
      />

      <Container className="py-10 lg:py-14">
        {source === "unavailable" && (
          <div className="mb-8">
            <DataSourceNotice source={source} degraded={isDegraded(source)} />
          </div>
        )}

        <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
          {platforms.map((platform) => {
            const hue = hueFromString(platform.slug);
            return (
              <StaggerItem key={platform.id}>
                <Link
                  href={`/browse?platforms=${platform.slug}`}
                  className="hue-tile group relative flex h-32 flex-col justify-between overflow-hidden rounded-2xl border border-line p-4 transition-all duration-500 fine:hover:border-line-strong fine:hover:shadow-[0_20px_50px_-24px_rgba(34,211,238,0.5)] lg:h-36"
                  style={{ "--tile-hue": hue, "--tile-hue-2": (hue + 40) % 360 } as CSSProperties}
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 opacity-0 transition-opacity duration-500 fine:group-hover:opacity-100"
                    style={{
                      background: `radial-gradient(85% 65% at 25% 0%, hsl(${hue} 85% 60% / 0.38), transparent 66%)`,
                    }}
                  />
                  <div className="relative flex items-start justify-between">
                    <span className="text-white/80 [&_li]:text-white/80">
                      <PlatformIcons platforms={[platform]} size={20} max={1} />
                    </span>
                    <ArrowUpRight
                      size={16}
                      className="text-white/55 transition-all duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-white/80"
                    />
                  </div>
                  <span className="relative font-display text-lg font-bold leading-tight lg:text-xl">
                    {platform.name}
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
