import {
  Building2,
  Gamepad2,
  Shapes,
  Sparkles,
  Tag,
  User,
} from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { cn } from "@/lib/utils/cn";
import type { SearchHit, SearchKind } from "@/lib/games/search";
import { ResilientMediaImage } from "@/components/game/ResilientMediaImage";
import { isUnreleased } from "@/lib/utils/format";

const ICONS: Record<SearchKind, typeof Gamepad2> = {
  game: Gamepad2,
  franchise: Sparkles,
  company: Building2,
  character: User,
  genre: Tag,
  platform: Shapes,
};

const TONES: Record<SearchKind, string> = {
  game: "from-brand/35 to-brand/5 text-brand-soft",
  franchise: "from-flare/25 to-flare/5 text-flare",
  company: "from-gold/25 to-gold/5 text-gold",
  character: "from-mint/25 to-mint/5 text-mint",
  genre: "from-brand/30 to-neon/5 text-brand-soft",
  platform: "from-neon/25 to-brand/5 text-neon",
};

export function SearchHitVisual({
  hit,
  size = "compact",
}: {
  hit: SearchHit;
  size?: "compact" | "card";
}) {
  const Icon = ICONS[hit.kind];
  // `flex` on every root: the visual is often placed in a plain block (the
  // preview pane, the top-hit card), where an inline span would collapse.
  const dimensions = size === "card" ? "h-24 w-[72px] rounded-2xl" : "h-14 w-[42px] rounded-xl";

  if (hit.kind === "game") {
    const upcoming = hit.released !== undefined && isUnreleased({
      released: hit.released ?? null,
      releaseWindow: hit.releaseWindow ?? null,
      tba: hit.tba ?? false,
    });
    return (
      <span className={cn("relative flex shrink-0 overflow-hidden border border-fg/10", dimensions)}>
        <GameCover
          name={hit.name}
          slug={hit.slug}
          image={hit.image}
          imageFallback={null}
          width={size === "card" ? 200 : 96}
          sizes={size === "card" ? "80px" : "44px"}
        />
        {upcoming && (
          <span className="absolute inset-x-1 bottom-1 rounded-md bg-brand/90 px-1 py-0.5 text-center text-[8px] font-black uppercase tracking-[0.06em] text-white">
            Upcoming
          </span>
        )}
      </span>
    );
  }

  if (hit.image) {
    return (
      <span className={cn("relative flex shrink-0 overflow-hidden border border-fg/10 bg-fg/[0.05]", dimensions, hit.kind === "company" || hit.kind === "platform" ? "p-2" : "")}>
        <ResilientMediaImage
          src={hit.image}
          alt=""
          sizes={size === "card" ? "80px" : "44px"}
          className={hit.kind === "company" || hit.kind === "platform" ? "object-contain p-2" : "object-cover"}
        />
      </span>
    );
  }

  return (
    <span className={cn("grid shrink-0 place-items-center border border-fg/10 bg-gradient-to-br", dimensions, TONES[hit.kind])}>
      <Icon size={size === "card" ? 25 : 17} />
    </span>
  );
}

export function SearchKindIcon({ kind, size = 15 }: { kind: SearchKind; size?: number }) {
  const Icon = ICONS[kind];
  return <Icon aria-hidden size={size} />;
}
