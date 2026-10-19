import { MessageSquareQuote } from "lucide-react";
import { ExpandableText } from "@/components/ui/ExpandableText";
import { Reveal } from "@/components/motion/Reveal";
import { DetailSection } from "@/components/game/detail/DetailSection";
import type { GameDetail } from "@/lib/games/types";

/**
 * "About": the game's own description as body text, with the narrative
 * premise (when IGDB has one) set apart as a pull-quote.
 *
 * Plain type rather than a card — the description is the page's editorial
 * voice and reads better as an article than as a tile. The old row of
 * "Play styles / Perspective / Themes / Languages" chips beneath it repeated
 * the fact sheet beside it word for word, so it's gone.
 */
export function GameEditorialOverview({ game }: { game: GameDetail }) {
  return (
    <DetailSection id="about" eyebrow="About" title={`About ${game.name}`}>
      <div className="space-y-6">
        <Reveal>
          <ExpandableText
            text={game.description}
            paragraphClassName="text-[15px] leading-[1.75] text-muted sm:text-[17px]"
          />
        </Reveal>

        {game.storyline && (
          <Reveal
            delay={0.06}
            className="relative isolate overflow-hidden rounded-3xl border border-[color-mix(in_oklab,var(--game-accent)_24%,transparent)] bg-[radial-gradient(circle_at_0%_0%,var(--game-glow),transparent_55%),linear-gradient(145deg,color-mix(in_oklab,var(--color-panel)_90%,transparent),var(--color-bg-elev))] p-5 sm:p-7"
          >
            <MessageSquareQuote size={56} aria-hidden className="absolute -right-1 top-1 -z-10 text-fg/[0.05]" />
            <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))]">
              <MessageSquareQuote size={14} aria-hidden /> The premise
            </h3>
            <ExpandableText text={game.storyline} collapsedRem={10} paragraphClassName="text-[15px] leading-[1.75] text-muted" />
          </Reveal>
        )}
      </div>
    </DetailSection>
  );
}
