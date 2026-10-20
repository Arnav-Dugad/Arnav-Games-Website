"use client";

/**
 * Records where the reader owns a game.
 *
 * Multi-select on purpose: owning the same game on two storefronts is
 * completely ordinary, and forcing a single choice would quietly lose that.
 * Selections are optimistic and roll back on failure, so toggling feels
 * instant rather than waiting on a round-trip.
 */

import { useCallback, useRef, useState } from "react";
import { Check, ChevronRight, Library, Plus, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/haptics";
import { Popover } from "@/components/ui/Popover";
import { OWNERSHIP_PLATFORMS } from "@/lib/games/stores-catalog";
import { openPurchaseEditor, usePersonal } from "@/lib/personal/store";
import { formatMoney } from "@/lib/personal/spend";
import { cn } from "@/lib/utils/cn";
import type { GameSummary } from "@/lib/games/types";

export function OwnershipPicker({
  game,
  className,
  /** `icon` is the compact control for game cards; `full` is the page button. */
  variant = "full",
  /** Smaller glass chip for overlaying a poster; keeps a 44px hit area. */
  compact = false,
}: {
  game: GameSummary;
  className?: string;
  variant?: "full" | "icon";
  compact?: boolean;
}) {
  const { user, enabled } = useAuth();
  const { ownershipOf, setOwnership, ensure } = useWatchlist();
  const { toast } = useToast();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string[] | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const owned = pending ?? ownershipOf(game.id);

  const choose = async (slug: string) => {
    if (!enabled) {
      toast("Sign-in isn't configured for this deployment yet.", "info");
      return;
    }
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/game/${game.slug}`)}`);
      return;
    }

    const next = owned.includes(slug)
      ? owned.filter((entry) => entry !== slug)
      : [...owned, slug];

    haptic("selection");
    setPending(next);
    try {
      // Ownership lives on the watchlist document, so the game has to be
      // tracked before it can hold anything.
      await ensure(game);
      await setOwnership(game.id, next);
      haptic("success");
    } catch (err) {
      haptic("warning");
      setPending(null);
      toast(err instanceof Error ? err.message : "Couldn't save that.", "error");
      return;
    }
    setPending(null);
  };

  const label =
    owned.length > 0
      ? `Owned on ${owned.length} ${owned.length === 1 ? "store" : "stores"}`
      : "Mark as owned";

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={variant === "icon" ? label : undefined}
        title={variant === "icon" ? label : undefined}
        className={cn(
          "press relative inline-flex items-center gap-2 border font-semibold transition-[background-color,border-color,color] duration-300",
          // A 36px target on cards, 44px+ on touch where it's the primary tap.
          variant === "icon"
            ? compact
              ? "h-[34px] w-[34px] justify-center rounded-full backdrop-blur-md after:absolute after:-inset-[5px] after:content-['']"
              : "h-9 w-9 justify-center rounded-full coarse:h-11 coarse:w-11"
            : "min-h-12 rounded-full px-5 text-[15px]",
          owned.length > 0
            ? variant === "icon"
              ? "border-mint/45 bg-mint/20 text-white"
              : "border-mint/45 bg-mint/15 text-text"
            : variant === "icon"
              ? "border-white/15 bg-black/45 text-white backdrop-blur-xl fine:hover:bg-black/70"
              : "border-fg/15 bg-fg/[0.08] text-text backdrop-blur-xl fine:hover:bg-fg/[0.14]",
          // A non-compact icon sits on a page row, not a poster (see WatchButton).
          variant === "icon" &&
            !compact &&
            (owned.length > 0
              ? "light:bg-mint/12 light:text-mint"
              : "light:border-fg/10 light:bg-fg/[0.05] light:text-muted light:fine:hover:bg-fg/[0.09] light:fine:hover:text-text"),
        )}
      >
        <Library size={variant === "icon" ? 15 : 17} />
        {variant === "full" && (owned.length > 0 ? `Owned on ${owned.length}` : "I own this")}
        {variant === "full" && owned.length > 0 && (
          <span className="flex items-center -space-x-1">
            {owned.slice(0, 3).map((slug) => {
              const platform = OWNERSHIP_PLATFORMS.find((p) => p.slug === slug);
              return platform?.icon ? (
                <BrandIcon key={slug} name={platform.icon} size={14} title={null} tinted />
              ) : null;
            })}
          </span>
        )}
      </button>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        width={264}
        label="Where do you own this game?"
      >
        <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
          Where do you own it?
        </p>
        <ul className="max-h-[min(68vh,24rem)] overflow-y-auto overscroll-contain">
          {OWNERSHIP_PLATFORMS.map((platform, index) => {
            const active = owned.includes(platform.slug);
            return (
              <li key={platform.slug}>
                {(index === 0 || OWNERSHIP_PLATFORMS[index - 1]?.group !== platform.group) && (
                  <p className="sticky top-0 z-10 bg-panel/95 px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.07em] text-faint backdrop-blur-xl">
                    {platform.group}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => choose(platform.slug)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                    active ? "bg-mint/12 text-text" : "text-muted hover:bg-fg/[0.06] hover:text-text",
                  )}
                >
                  {platform.icon ? (
                    <BrandIcon name={platform.icon} size={15} title={null} tinted={active} />
                  ) : (
                    <Plus size={15} className="text-faint" />
                  )}
                  <span className="flex-1">{platform.name}</span>
                  {active && <Check size={14} className="text-mint" />}
                </button>
              </li>
            );
          })}
        </ul>
        {/* Once it's owned: what it cost, for the spending tracker on /stats. */}
        {open && owned.length > 0 && <PaidRow game={game} onOpen={() => setOpen(false)} />}
      </Popover>
    </div>
  );
}

/**
 * Its own component so the reader's purchases (and the rest of their play
 * records) are only read when this popover is actually open — never by the
 * dozens of cards on a grid.
 */
function PaidRow({ game, onOpen }: { game: GameSummary; onOpen: () => void }) {
  const paid = usePersonal().purchases[game.id] ?? null;
  return (
    <div className="mt-1 border-t border-line pt-1">
      <button
        type="button"
        onClick={() => {
          onOpen();
          openPurchaseEditor({ id: game.id, slug: game.slug, name: game.name, image: game.image });
        }}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-muted transition-colors hover:bg-fg/[0.06] hover:text-text"
      >
        <Wallet size={15} className="text-faint" aria-hidden />
        <span className="flex-1">{paid ? "What you paid" : "Add what you paid"}</span>
        {paid && <span className="tabular-nums text-text">{paid.amount === 0 ? "Free" : formatMoney(paid.amount, paid.currency, { whole: false })}</span>}
        <ChevronRight size={14} className="text-faint" aria-hidden />
      </button>
    </div>
  );
}
