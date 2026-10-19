"use client";

/**
 * Game Pass as one shelf with a switch between "Just added" and "Leaving
 * soon", rather than two stacked rails with the same badge and the same
 * covers' worth of visual weight. Either list may be empty; the switch only
 * offers lists that have games.
 */

import { useState } from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { GameRail } from "@/components/game/GameRail";
import { SegmentedControl } from "@/components/filters/SegmentedControl";
import { Container, SectionHeading } from "@/components/ui/SectionHeading";
import type { GameSummary } from "@/lib/games/types";

type ListId = "added" | "leaving";

export function GamePassSwitcher({ added, leaving }: { added: GameSummary[]; leaving: GameSummary[] }) {
  const lists = [
    { value: "added" as const, label: "Just added", games: added, description: "Recently added to the console and PC library." },
    { value: "leaving" as const, label: "Leaving soon", games: leaving, description: "Play these on your subscription before they rotate out." },
  ].filter((list) => list.games.length > 0);
  const [active, setActive] = useState<ListId>(lists[0]?.value ?? "added");
  const current = lists.find((list) => list.value === active) ?? lists[0];
  if (!current) return null;

  return (
    <section data-track-src="home:game-pass" aria-labelledby="home-game-pass-title" className="py-9 sm:py-12 lg:py-14">
      <Container>
        <SectionHeading
          eyebrow="Subscriptions"
          title={
            <span id="home-game-pass-title" className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
              Xbox Game Pass
              <GamePassBadge />
            </span>
          }
          description={current.description}
          href="https://www.xbox.com/xbox-game-pass/games"
          linkLabel="Full catalogue"
        />
        {lists.length > 1 && (
          <SegmentedControl
            label="Game Pass list"
            className="mt-5 sm:max-w-sm"
            segments={lists.map((list) => ({ value: list.value, label: list.label, count: list.games.length }))}
            value={current.value}
            onChange={setActive}
          />
        )}
      </Container>
      <div className="mt-6 sm:mt-7">
        {/* Keyed so switching lists starts the rail from its first card. */}
        <GameRail key={current.value} games={current.games.slice(0, 16)} />
      </div>
    </section>
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
