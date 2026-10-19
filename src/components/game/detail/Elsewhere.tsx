import { ArrowUpRight, BookOpen, Gauge, Hourglass, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { CommunityLinks } from "@/components/game/StoreLinks";
import { Reveal } from "@/components/motion/Reveal";
import type { GameDetail } from "@/lib/games/types";
import { DetailHeading } from "./DetailSection";

/**
 * Reference sites for the game, as quiet link chips. Every link is one the
 * data actually resolved (via Wikidata, or IGDB's own Metacritic link) —
 * never a search URL dressed up as a page.
 */
export function elsewhereLinks(game: GameDetail): { label: string; url: string; icon: ReactNode; hint: string }[] {
  const links = game.links;
  const metacritic = links?.metacritic ?? game.metacriticUrl;
  return [
    links?.wikipedia ? { label: "Wikipedia", url: links.wikipedia, icon: <BrandIcon name="wikipedia" size={14} title={null} />, hint: "Background & history" } : null,
    links?.howLongToBeat ? { label: "HowLongToBeat", url: links.howLongToBeat, icon: <Hourglass size={14} />, hint: "Completion times" } : null,
    links?.openCritic ? { label: "OpenCritic", url: links.openCritic, icon: <Gauge size={14} />, hint: "Critic reviews" } : null,
    metacritic ? { label: "Metacritic", url: metacritic, icon: <BrandIcon name="metacritic" size={14} title={null} />, hint: "Critic & user scores" } : null,
    links?.pcGamingWiki ? { label: "PCGamingWiki", url: links.pcGamingWiki, icon: <Wrench size={14} />, hint: "PC fixes & settings" } : null,
  ].filter((link): link is NonNullable<typeof link> => link !== null);
}

export function Elsewhere({ game }: { game: GameDetail }) {
  const links = elsewhereLinks(game);
  const hasCommunity = game.websites.some((site) => site.kind !== "official");
  if (links.length === 0 && !hasCommunity) return null;

  return (
    <section id="elsewhere" aria-labelledby="elsewhere-title" className="scroll-mt-36">
      <DetailHeading titleId="elsewhere-title" eyebrow="Elsewhere" icon={<BookOpen size={14} />} title="Read more about it" />
      {links.length > 0 && (
        <Reveal as="div" className="mt-5 sm:mt-6">
          <ul className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:grid-cols-3">
            {links.map((link) => (
              <li key={link.label}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="press group flex items-center gap-3 rounded-2xl border border-line bg-fg/[0.03] px-4 py-3 transition-colors fine:hover:border-line-strong fine:hover:bg-fg/[0.06]"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fg/[0.06] text-muted transition-colors group-hover:text-[var(--game-accent)]">
                    {link.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text">{link.label}</span>
                    <span className="block truncate text-xs text-faint">{link.hint}</span>
                  </span>
                  <ArrowUpRight size={14} className="shrink-0 text-faint transition-transform duration-300 fine:group-hover:-translate-y-0.5 fine:group-hover:translate-x-0.5" />
                </a>
              </li>
            ))}
          </ul>
        </Reveal>
      )}
      {hasCommunity && (
        <Reveal className="mt-4">
          <CommunityLinks websites={game.websites} />
        </Reveal>
      )}
    </section>
  );
}
