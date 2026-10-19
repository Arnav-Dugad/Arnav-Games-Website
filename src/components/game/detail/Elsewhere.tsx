import { ArrowUpRight, Gauge, Hourglass, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { CommunityLinks } from "@/components/game/StoreLinks";
import type { GameDetail } from "@/lib/games/types";

/**
 * Reference sites for the game, as a quiet list in the Overview's side
 * column (it used to be a full section of its own near the end, which read
 * as one more thing to scroll past). Every link is one the data actually
 * resolved (via Wikidata, or IGDB's own Metacritic link) — never a search URL
 * dressed up as a page.
 */
function elsewhereLinks(game: GameDetail): { label: string; url: string; icon: ReactNode; hint: string }[] {
  const links = game.links;
  const metacritic = links?.metacritic ?? game.metacriticUrl;
  return [
    links?.wikipedia ? { label: "Wikipedia", url: links.wikipedia, icon: <BrandIcon name="wikipedia" size={14} title={null} />, hint: "Background and history" } : null,
    links?.howLongToBeat ? { label: "HowLongToBeat", url: links.howLongToBeat, icon: <Hourglass size={14} />, hint: "Completion times" } : null,
    links?.openCritic ? { label: "OpenCritic", url: links.openCritic, icon: <Gauge size={14} />, hint: "Critic reviews" } : null,
    metacritic ? { label: "Metacritic", url: metacritic, icon: <BrandIcon name="metacritic" size={14} title={null} />, hint: "Critic and user scores" } : null,
    links?.pcGamingWiki ? { label: "PCGamingWiki", url: links.pcGamingWiki, icon: <Wrench size={14} />, hint: "PC fixes and settings" } : null,
  ].filter((link): link is NonNullable<typeof link> => link !== null);
}

export function Elsewhere({ game }: { game: GameDetail }) {
  const links = elsewhereLinks(game);
  const hasCommunity = game.websites.some((site) => site.kind !== "official");
  if (links.length === 0 && !hasCommunity) return null;

  return (
    <div className="glass rounded-3xl p-5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">Read more</h3>
      {links.length > 0 && (
        <ul className="-mx-2">
          {links.map((link) => (
            <li key={link.label}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors fine:hover:bg-fg/[0.05]"
              >
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-fg/[0.06] text-muted group-hover:text-[var(--game-accent)]">
                  {link.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-text">{link.label}</span>
                  <span className="block truncate text-[12px] text-faint">{link.hint}</span>
                </span>
                <ArrowUpRight size={13} aria-hidden className="shrink-0 text-faint" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {hasCommunity && (
        <div className={links.length > 0 ? "mt-3 border-t border-line pt-3" : undefined}>
          <CommunityLinks websites={game.websites} />
        </div>
      )}
    </div>
  );
}
