import type { Metadata } from "next";
import { Activity, Flame, Heart, ShoppingCart, Sparkles } from "lucide-react";
import { GameRail } from "@/components/game/GameRail";
import { GameCard } from "@/components/game/GameCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container, Section, SectionHeading } from "@/components/ui/SectionHeading";
import { DataSourceNotice } from "@/components/ui/DataSourceNotice";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { Spotlight } from "@/components/motion/effects";
import { getSteamCharts } from "@/lib/games/source";
import { cn } from "@/lib/utils/cn";

/**
 * Steam's own charts, refreshed daily by IGDB's popularity feed.
 *
 * Deliberately hourly rather than daily: the underlying data moves once a day,
 * but on an unpredictable schedule, and a stale "most played right now" is the
 * one thing this page cannot afford.
 */
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Steam charts",
  description:
    "What Steam is actually playing, buying and wishlisting right now — peak concurrent players, global top sellers and the most-wishlisted upcoming games.",
};

const CHART_ICONS: Record<string, typeof Activity> = {
  peak: Activity,
  sellers: ShoppingCart,
  wishlisted: Heart,
};

export default async function SteamPage() {
  const { data: charts, source } = await getSteamCharts(18);

  const peak = charts.find((chart) => chart.key === "peak");
  const rest = charts.filter((chart) => chart.key !== "peak");

  return (
    <>
      <PageHeader
        eyebrow="Platform stats"
        title="Steam charts"
        description="What the world's largest PC storefront is actually playing, buying and waiting for — ranked, and refreshed every day."
      />

      <Container className="py-8 lg:py-12">
        {source === "unavailable" ? (
          <DataSourceNotice source={source} />
        ) : (
          <>
            {/* The headline chart gets a podium: rank is the whole point of
                this page, and a rail buries the top three among equals. */}
            {peak && peak.games.length > 0 && (
              <section className="mb-14">
                <SectionHeading
                  eyebrow="Live activity"
                  title={peak.title}
                  description={peak.description}
                />
                <Stagger className="mt-7 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3" gap={0.05} onMount>
                  {peak.games.slice(0, 6).map((game, i) => (
                    <StaggerItem key={game.id}>
                      <Spotlight className="glass h-full rounded-2xl p-3">
                        <div className="flex items-center gap-3.5">
                          <span
                            className={cn(
                              "grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-lg font-black tabular-nums",
                              i === 0 && "bg-gold/20 text-gold",
                              i === 1 && "bg-fg/12 text-text",
                              i === 2 && "bg-flare/15 text-flare",
                              i > 2 && "bg-fg/[0.06] text-muted",
                            )}
                          >
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <GameCard game={game} shape="wide" showOwnership={false} />
                          </div>
                        </div>
                      </Spotlight>
                    </StaggerItem>
                  ))}
                </Stagger>

                {peak.games.length > 6 && (
                  <div className="mt-7">
                    <GameRail games={peak.games.slice(6)} />
                  </div>
                )}
              </section>
            )}

            {rest.map((chart) => {
              const Icon = CHART_ICONS[chart.key] ?? Flame;
              return (
                <Section key={chart.key} className="py-8">
                  <div className="mb-1 flex items-center gap-2 text-brand-soft">
                    <Icon size={16} />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.07em]">
                      Steam
                    </span>
                  </div>
                  <SectionHeading title={chart.title} description={chart.description} />
                  <div className="mt-7">
                    <GameRail games={chart.games} />
                  </div>
                </Section>
              );
            })}

            <Reveal className="mt-10 rounded-2xl border border-line bg-panel/40 p-5">
              <p className="flex items-start gap-3 text-sm leading-relaxed text-muted">
                <Sparkles size={16} className="mt-0.5 shrink-0 text-faint" />
                <span>
                  Steam publishes no public &ldquo;top games&rdquo; API — only curated storefront
                  shelves. These rankings come from IGDB, which ingests the real charts from Steam
                  and republishes them, so this is the closest thing to a genuine Steam-wide view
                  available without scraping.
                </span>
              </p>
            </Reveal>
          </>
        )}
      </Container>
    </>
  );
}
