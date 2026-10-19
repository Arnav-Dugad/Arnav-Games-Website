import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowUpRight, User } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { GameCard } from "@/components/game/GameCard";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/SectionHeading";
import { isIgdbImage, sizedImage } from "@/lib/games/image";
import { getPerson } from "@/lib/games/people";
import type { Person, PersonRole } from "@/lib/games/types";

// Wikidata and IGDB answers are cached for a week (see people.ts); the page
// renders per request like the game page, so an outage is never baked in.
export const revalidate = 0;

type Params = Promise<{ qid: string }>;

const ROLE: Record<PersonRole, { one: string; many: string }> = {
  director: { one: "Director", many: "Directors" },
  designer: { one: "Designer", many: "Designers" },
  composer: { one: "Composer", many: "Composers" },
  producer: { one: "Producer", many: "Producers" },
  writer: { one: "Writer", many: "Writers" },
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { qid } = await params;
  const person = await getPerson(qid.toUpperCase());
  if (!person) return { title: "Person not found" };
  const roles = person.roles.map((role) => ROLE[role].one.toLowerCase()).join(", ");
  return {
    title: person.name,
    description: person.description ?? `${person.name}, ${roles} — the games they made.`,
  };
}

/**
 * A person behind games (director, writer, composer…), from Wikidata with
 * their IGDB games: photo, roles, Wikipedia, then every game with the role
 * they held on it. Linked from a game page's "Key people".
 */
export default async function PersonPage({ params }: { params: Params }) {
  const { qid } = await params;
  const person = await getPerson(qid.toUpperCase());
  if (!person) notFound();

  const years = person.games.map(({ game }) => game.released?.slice(0, 4)).filter((year): year is string => Boolean(year)).sort();
  const span = years.length > 0 ? (years[0] === years[years.length - 1] ? years[0] : `${years[0]}–${years[years.length - 1]}`) : null;
  const facts = [`${person.games.length} ${person.games.length === 1 ? "game" : "games"}`, span].filter(Boolean).join(" · ");
  const backdrop = backdropFor(person);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Person",
            name: person.name,
            description: person.description ?? undefined,
            image: person.image ?? undefined,
            sameAs: person.wikipedia ? [person.wikipedia] : undefined,
          }).replace(/</g, "\\u003c"),
        }}
      />
      <header className="relative isolate overflow-hidden border-b border-line">
        {/* Art from their best-known game, blurred: the page takes on the colour of the work. */}
        {backdrop && (
          <div aria-hidden className="absolute inset-0 -z-20">
            <Image src={backdrop} alt="" fill priority sizes="100vw" unoptimized={isIgdbImage(backdrop)} className="scale-110 object-cover opacity-35 blur-[8px] saturate-[1.1]" />
          </div>
        )}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-bg via-bg/85 to-bg/50" />

        <Container className="pb-9 pt-[calc(var(--chrome-top)+2.5rem)] lg:pb-14 lg:pt-32">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
            <Reveal direction="right" className="relative h-28 w-28 shrink-0 overflow-hidden rounded-full bg-panel-2 shadow-[0_30px_70px_-30px_#000] ring-1 ring-fg/15 sm:h-40 sm:w-40">
              {person.image ? (
                // Wikimedia Commons thumbnail; not a configured next/image host.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={person.image} alt={person.name} className="h-full w-full object-cover" />
              ) : (
                <span className="grid h-full w-full place-items-center text-faint">
                  <User size={40} aria-hidden />
                </span>
              )}
            </Reveal>
            <div className="min-w-0 flex-1">
              <Reveal>
                <h1 className="break-words font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-text sm:text-5xl">{person.name}</h1>
              </Reveal>
              <Reveal delay={0.08}>
                {person.description && <p className="mt-2 max-w-2xl text-[15px] leading-snug text-muted sm:text-[17px]">{capitalise(person.description)}</p>}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {person.roles.map((role) => (
                    <span key={role} className="rounded-full bg-fg/[0.08] px-3 py-1.5 text-[13px] font-semibold text-text">
                      {ROLE[role].one}
                    </span>
                  ))}
                  {person.wikipedia && (
                    <a
                      href={person.wikipedia}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-semibold text-text transition-colors fine:hover:bg-fg/[0.06] coarse:min-h-11"
                    >
                      <BrandIcon name="wikipedia" size={14} title={null} />
                      Wikipedia
                      <ArrowUpRight size={13} aria-hidden className="text-faint" />
                    </a>
                  )}
                </div>
              </Reveal>
            </div>
          </div>
        </Container>
      </header>

      <Container className="py-10 lg:py-14">
        <section aria-labelledby="person-games">
          <div className="flex items-end justify-between gap-4">
            <h2 id="person-games" className="text-[22px] font-bold leading-tight tracking-[-0.02em] sm:text-[28px]">
              Games
            </h2>
            <p className="text-[13px] tabular-nums text-muted">{facts}</p>
          </div>
          <ul className="mt-6 grid grid-cols-2 gap-3.5 sm:mt-7 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:grid-cols-6">
            {person.games.map(({ game, roles }, index) => (
              <li key={game.id}>
                <GameCard
                  game={game}
                  priority={index < 4}
                  footer={<p className="mt-1 truncate text-[12px] font-medium text-[color-mix(in_oklab,var(--color-brand-soft)_80%,var(--color-text))]">{roles.map((role) => ROLE[role].one).join(", ")}</p>}
                />
              </li>
            ))}
          </ul>
        </section>
      </Container>
    </>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Key art from the best-rated of their games, for the hero wash. */
function backdropFor(person: Person): string | null {
  const best = [...person.games].sort((a, b) => (b.game.metacritic ?? 0) - (a.game.metacritic ?? 0))[0]?.game;
  const art = best?.screenshots[0] ?? best?.image ?? null;
  return art ? sizedImage(art, 1280) : null;
}
