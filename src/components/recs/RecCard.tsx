"use client";

/**
 * Recommended games, with the engine's reasons on every card.
 *
 * Two shapes:
 *  - `RecPosterCard`: the site's ordinary poster (GameCard) plus one line of
 *    "why". Feedback lives in the long-press / right-click menu, and on
 *    hover as two small glass buttons on desktop.
 *  - `RecFeatureCard`: a wide card for the top picks, where there is room
 *    for the reason chips and both feedback buttons inline (the touch path
 *    that doesn't need a long-press).
 *
 * Feedback is optimistic: "Not interested" hides the card at once (with an
 * Undo), "More like this" lights the thumb; both persist through
 * `useRecFeedback` and reshape the next answer.
 */

import Link from "next/link";
import { useCallback, useMemo, type ReactNode } from "react";
import {
  Building2,
  CalendarClock,
  Clock3,
  Cloud,
  EyeOff,
  Gem,
  Heart,
  Layers,
  MonitorSmartphone,
  Sparkles,
  Star,
  Tag,
  ThumbsUp,
} from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { GameCard } from "@/components/game/GameCard";
import { GameCover } from "@/components/game/GameCover";
import { useGameMenuTarget, type RecommendationMenu } from "@/components/interactions/game-menu-targets";
import { ScorePill } from "@/components/ui/ScoreRing";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/haptics";
import { feedbackFor, useRecFeedback } from "@/lib/recs/feedback";
import { cn } from "@/lib/utils/cn";
import { releaseLabel } from "@/lib/utils/format";
import type { GameSummary, RecReason, RecReasonKind, RecommendedGame } from "@/lib/games/types";

const REASON_ICON: Record<RecReasonKind, ReactNode> = {
  seed: <Heart size={12} />,
  shares: <Tag size={12} />,
  steamTag: <Tag size={12} />,
  series: <Layers size={12} />,
  developer: <Building2 size={12} />,
  platform: <MonitorSmartphone size={12} />,
  gamePass: <BrandIcon name="xbox" size={11} title={null} />,
  geforceNow: <Cloud size={12} />,
  quality: <Star size={12} />,
  gem: <Gem size={12} />,
  length: <Clock3 size={12} />,
  upcoming: <CalendarClock size={12} />,
  new: <Sparkles size={12} />,
};

/** Feedback for one game: the current opinion, the menu wiring and the two actions. */
export function useRecActions(game: GameSummary) {
  const { items, set } = useRecFeedback();
  const { toast } = useToast();
  const current = feedbackFor(items, game.id);

  const give = useCallback(
    (kind: "up" | "not-interested") => {
      // Tapping "More like this" again takes it back, like a toggle.
      const next = kind === "up" && current === "up" ? null : kind;
      haptic(next === "not-interested" ? "warning" : "success");
      void set(game.id, next);
      if (next === "not-interested") {
        toast(`${game.name} won’t be suggested`, "info", { label: "Undo", onAction: () => void set(game.id, current) });
      } else if (next === "up") {
        toast("Got it — more like this", "success");
      }
    },
    [current, game.id, game.name, set, toast],
  );

  const menu = useMemo<RecommendationMenu>(() => ({ current, onFeedback: give }), [current, give]);
  return { current, give, menu };
}

/** A cloud badge only when the reasons already say so — never a per-card lookup. */
function cloudFrom(reasons: RecReason[]): "geforceNow" | "gamePass" | null {
  if (reasons.some((reason) => reason.kind === "gamePass")) return "gamePass";
  if (reasons.some((reason) => reason.kind === "geforceNow")) return "geforceNow";
  return null;
}

export function CloudBadge({
  kind,
  className,
  onImage = true,
}: {
  kind: "geforceNow" | "gamePass";
  className?: string;
  /** Over cover art (dark glass) or on a page surface (quiet tint). */
  onImage?: boolean;
}) {
  return (
    <span
      className={cn(
        "pointer-events-none inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] font-semibold",
        onImage ? "bg-black/60 text-white shadow-[inset_0_0_0_1px_#ffffff24] backdrop-blur-md" : "bg-fg/[0.07] text-muted",
        className,
      )}
    >
      {kind === "gamePass" ? <BrandIcon name="xbox" size={10} title={null} /> : <Cloud size={11} aria-hidden />}
      {kind === "gamePass" ? "Game Pass" : "GeForce NOW"}
    </span>
  );
}

/** The engine's reasons, most important first. */
export function ReasonChips({ reasons, max = 3, className }: { reasons: RecReason[]; max?: number; className?: string }) {
  if (reasons.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Why it’s here">
      {reasons.slice(0, max).map((reason, index) => (
        <li
          key={`${reason.kind}-${index}`}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium leading-none",
            index === 0 ? "bg-brand/15 text-brand-soft" : "bg-fg/[0.06] text-muted",
          )}
        >
          <span aria-hidden className="shrink-0">{REASON_ICON[reason.kind]}</span>
          <span className="truncate">{reason.text}</span>
        </li>
      ))}
    </ul>
  );
}

function FeedbackButtons({
  current,
  give,
  name,
  className,
  onImage = false,
}: {
  current: string | null;
  give: (kind: "up" | "not-interested") => void;
  name: string;
  className?: string;
  onImage?: boolean;
}) {
  const base = onImage
    ? "bg-black/55 text-white shadow-[inset_0_0_0_1px_#ffffff26] backdrop-blur-md fine:hover:bg-black/75"
    : "bg-fg/[0.06] text-muted fine:hover:bg-fg/[0.12] fine:hover:text-text";
  return (
    <div className={cn("flex gap-1.5", className)}>
      <button
        type="button"
        aria-pressed={current === "up"}
        aria-label={`More like ${name}`}
        title="More like this"
        onClick={(event) => {
          event.preventDefault();
          give("up");
        }}
        className={cn(
          "press grid h-9 w-9 place-items-center rounded-full transition-colors coarse:h-11 coarse:w-11",
          current === "up" ? "bg-brand text-white" : base,
        )}
      >
        <ThumbsUp size={15} aria-hidden fill={current === "up" ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        aria-label={`Not interested in ${name}`}
        title="Not interested"
        onClick={(event) => {
          event.preventDefault();
          give("not-interested");
        }}
        className={cn("press grid h-9 w-9 place-items-center rounded-full transition-colors coarse:h-11 coarse:w-11", base)}
      >
        <EyeOff size={15} aria-hidden />
      </button>
    </div>
  );
}

export function RecPosterCard({
  rec,
  sizes = "176px",
  priority = false,
  skip = [],
}: {
  rec: RecommendedGame;
  sizes?: string;
  priority?: boolean;
  /** Reasons the surrounding shelf already states (e.g. "On your PC" under "For your PC"). */
  skip?: RecReasonKind[];
}) {
  const { current, give, menu } = useRecActions(rec.game);
  const cloud = cloudFrom(rec.reasons);
  // One reason on a poster: the strongest that the caption under the title
  // doesn't already say (its date). The wide cards carry the rest.
  const line = rec.reasons.find((reason) => reason.kind !== "new" && reason.kind !== "upcoming" && !skip.includes(reason.kind))?.text ?? null;
  return (
    <GameCard
      game={rec.game}
      sizes={sizes}
      priority={priority}
      showOwnership={false}
      recommendation={menu}
      overlay={
        <>
          {cloud && <CloudBadge kind={cloud} className="absolute bottom-2 left-2" />}
          {/* Desktop: the two feedback buttons appear on hover; touch uses the long-press menu. */}
          <FeedbackButtons
            current={current}
            give={give}
            name={rec.game.name}
            onImage
            className="absolute bottom-2 right-2 z-10 hidden opacity-0 transition-opacity duration-200 fine:flex fine:group-hover/card:opacity-100 fine:group-focus-within/card:opacity-100"
          />
        </>
      }
      footer={
        line ? (
          <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-faint">{line}</p>
        ) : null
      }
    />
  );
}

/** A wide card for the top picks: cover, title, reason chips and inline feedback. */
export function RecFeatureCard({ rec, priority = false }: { rec: RecommendedGame; priority?: boolean }) {
  const { game, reasons } = rec;
  const { current, give, menu } = useRecActions(game);
  const menuRef = useGameMenuTarget(game, undefined, menu);
  const cloud = cloudFrom(reasons);
  const href = `/game/${game.slug}`;

  return (
    <div
      ref={menuRef}
      data-game-menu
      className="press-menu-target group/card relative flex h-full gap-3.5 rounded-[22px] border border-line bg-panel p-3 transition-colors fine:hover:border-line-strong"
    >
      <Link
        prefetch={false}
        href={href}
        data-menu-preview
        aria-label={game.name}
        className="relative block w-[96px] shrink-0 self-start overflow-hidden rounded-[14px] shadow-[0_10px_24px_-14px_#000] sm:w-[108px]"
      >
        <span className="relative block aspect-[3/4]">
          <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={240} sizes="108px" priority={priority} />
        </span>
        <span className="absolute right-1.5 top-1.5">
          <ScorePill score={game.metacritic} onImage />
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link prefetch={false} href={href} className="line-clamp-2 text-[17px] font-semibold leading-tight tracking-[-0.01em] text-text fine:hover:text-brand-soft">
          {game.name}
        </Link>
        <p className="mt-0.5 truncate text-[12px] text-muted">
          {[game.genres[0]?.name.replace(/\s*\([^)]*\)$/, ""), releaseLabel(game)].filter(Boolean).join(" · ")}
        </p>
        <ReasonChips reasons={reasons} className="mt-2.5" />
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {cloud ? <CloudBadge kind={cloud} onImage={false} /> : <span />}
          <FeedbackButtons current={current} give={give} name={game.name} />
        </div>
      </div>
    </div>
  );
}
