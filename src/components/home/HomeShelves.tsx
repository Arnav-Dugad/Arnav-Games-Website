/**
 * Home shelves fed by the newer data sources: the hype-ranked calendar and
 * the Game Pass catalogue.
 *
 * Each is an async server component meant to sit behind its own <Suspense>.
 * Both are cached, but a cold Game Pass match costs several upstream calls
 * (Microsoft's catalogue, then joining BigIds back to IGDB), and the rest of
 * the homepage shouldn't wait on it — so these stream in after the page shell
 * instead of holding up the hero.
 *
 * Every shelf renders nothing when its list is empty or unavailable: an
 * absent shelf is honest, a shelf of placeholders is not.
 */

import { BrandIcon } from "@/components/brand/BrandIcon";
import { GameRail } from "@/components/game/GameRail";
import { Container, Section, SectionHeading } from "@/components/ui/SectionHeading";
import { getGamePassLeavingSoon, getGamePassRecentlyAdded, getMostAnticipated } from "@/lib/games/source";
import { AnticipatedRail } from "./AnticipatedRail";

export async function AnticipatedShelf() {
  const anticipated = await getMostAnticipated(14);
  if (anticipated.data.length < 3) return null;

  return (
    <Section className="py-8 sm:py-11">
      <Container>
        <SectionHeading
          eyebrow="Hype index"
          title="Most anticipated"
          description="Upcoming games ranked by follows, want-to-play lists and attention on IGDB."
          href="/upcoming?ordering=-hypes"
        />
      </Container>
      <div className="mt-7">
        <AnticipatedRail items={anticipated.data} />
      </div>
    </Section>
  );
}

export async function GamePassShelves() {
  const [added, leaving] = await Promise.all([getGamePassRecentlyAdded(), getGamePassLeavingSoon()]);
  if (added.data.length === 0 && leaving.data.length === 0) return null;

  return (
    <>
      {added.data.length > 0 && (
        <Section className="py-8 sm:py-11">
          <Container>
            <SectionHeading
              eyebrow="Xbox Game Pass"
              title={<GamePassTitle>New on Game Pass</GamePassTitle>}
              description="Recently added to the console and PC library."
            />
          </Container>
          <div className="mt-7">
            <GameRail games={added.data.slice(0, 16)} />
          </div>
        </Section>
      )}

      {leaving.data.length > 0 && (
        <Section className="py-8 sm:py-11">
          <Container>
            <SectionHeading
              eyebrow="Last chance"
              title={<GamePassTitle>Leaving Game Pass soon</GamePassTitle>}
              description="Play these on your subscription before they rotate out."
            />
          </Container>
          <div className="mt-7">
            <GameRail games={leaving.data.slice(0, 16)} />
          </div>
        </Section>
      )}
    </>
  );
}

function GamePassTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {children}
      <GamePassBadge />
    </span>
  );
}

/** Xbox green, so the shelf reads as a subscription catalogue at a glance. */
function GamePassBadge() {
  return (
    // Decorative: the heading text already says "Game Pass".
    <span aria-hidden className="inline-flex translate-y-px items-center gap-1 rounded-[7px] bg-[#107c10] px-2 py-1 align-middle font-sans text-[11px] font-bold uppercase leading-none tracking-[0.06em] text-white shadow-[inset_0_1px_0_#ffffff33]">
      <BrandIcon name="xbox" size={12} title={null} />
      Game Pass
    </span>
  );
}
