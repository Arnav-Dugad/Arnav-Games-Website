import { ExpandableText } from "@/components/ui/ExpandableText";
import { Reveal } from "@/components/motion/Reveal";
import type { GameDetail } from "@/lib/games/types";

/**
 * "About": the game's own description as body text.
 *
 * Plain type rather than a card — the description is the page's editorial
 * voice and reads better as an article than as a tile. It sits inside the
 * page's Overview section, so it takes a sub-heading rather than a section
 * title of its own. IGDB's separate storyline is deliberately not shown: it
 * mostly restated the description at greater length.
 */
export function GameEditorialOverview({ game }: { game: GameDetail }) {
  return (
    <div id="about" className="scroll-mt-36">
      <h3 className="text-[17px] font-semibold text-text">About {game.name}</h3>
      <Reveal className="mt-3">
        <ExpandableText
          text={game.description}
          paragraphClassName="text-[15px] leading-[1.75] text-muted sm:text-[17px]"
        />
      </Reveal>
    </div>
  );
}
