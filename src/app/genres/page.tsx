import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Container } from "@/components/ui/SectionHeading";
import { DataSourceNotice } from "@/components/ui/DataSourceNotice";
import { getGenres, isDegraded } from "@/lib/games/source";
import { popularSteamTags } from "@/lib/games/steam-tags";
import { hueFromString } from "@/lib/utils/format";
import { byId, taxonomyShowcase } from "./_lib/showcase";
import { TaxonomyTile } from "./_components/TaxonomyTile";

// Dynamic shell: a failed build-time request must not publish an empty grid.
// The IGDB answers behind it are cached for hours.
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Game genres",
  description: "Browse every game genre — action, RPG, strategy, indie and more.",
};

/**
 * IGDB's genre names are taxonomy labels ("Hack and slash/Beat 'em up",
 * "Real Time Strategy (RTS)"). Tiles show the name people say out loud; the
 * filter itself still uses the slug, so nothing about the link changes.
 */
const FRIENDLY: Record<string, string> = {
  "hack-and-slash-beat-em-up": "Hack and slash",
  "real-time-strategy-rts": "Real-time strategy",
  "turn-based-strategy-tbs": "Turn-based strategy",
  "role-playing-rpg": "Role-playing",
  "card-and-board-game": "Card and board",
  "quiz-trivia": "Quiz and trivia",
  "moba": "MOBA",
};

export default async function GenresPage() {
  const [{ data: genres, source }, tags] = await Promise.all([getGenres(), popularSteamTags()]);
  // Only IGDB ids can be counted against IGDB; a Steam fallback list shows
  // plain tiles.
  const showcase =
    source === "igdb"
      ? await taxonomyShowcase(byId("genres", new Map(genres.map((genre) => [genre.slug, genre.id]))))
      : new Map();

  // Biggest first: the genres most people are after lead, and the long tail
  // (pinball, quiz) sits at the end instead of interrupting it.
  const ordered = [...genres].sort(
    (a, b) =>
      (showcase.get(b.slug)?.count ?? -1) - (showcase.get(a.slug)?.count ?? -1) ||
      a.name.localeCompare(b.name),
  );

  return (
    <>
      <PageHeader title="Genres" />

      <Container className="pb-12 lg:pb-16">
        {source === "unavailable" && (
          <div className="mb-8">
            <DataSourceNotice source={source} degraded={isDegraded(source)} />
          </div>
        )}

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
          {ordered.map((genre) => (
            <li key={genre.id}>
              <TaxonomyTile
                href={`/browse?genres=${genre.slug}`}
                name={FRIENDLY[genre.slug] ?? genre.name}
                hue={hueFromString(genre.slug)}
                showcase={showcase.get(genre.slug)}
              />
            </li>
          ))}
        </ul>

        {/* How games feel rather than what they are: Steam's most-used player tags. */}
        {tags.length > 0 && (
          <section aria-labelledby="popular-tags" className="mt-12 sm:mt-16">
            <h2 id="popular-tags" className="text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">Popular tags</h2>
            <p className="mt-1 text-[13px] text-muted">The tags players use most on Steam</p>
            <ul className="mt-6 grid grid-cols-2 gap-3 sm:mt-7 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
              {tags.map((tag) => (
                <li key={tag}>
                  <TaxonomyTile href={`/browse?search=${encodeURIComponent(tag)}`} name={tag} hue={hueFromString(tag)} compact />
                </li>
              ))}
            </ul>
          </section>
        )}
      </Container>
    </>
  );
}
