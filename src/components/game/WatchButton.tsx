"use client";

/**
 * Explicit follow toggle.
 *
 * Two presentations from one behaviour: an icon-only button that sits in a card
 * corner, and a full-width labelled button for the detail page. Signed-out
 * users get routed to sign-in with a `next` param so they land back where they
 * started.
 */

import { motion, AnimatePresence } from "motion/react";
import { BellPlus, BellRing } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/haptics";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { cn } from "@/lib/utils/cn";
import type { GameSummary } from "@/lib/games/types";

interface WatchButtonProps {
  game: GameSummary;
  /** "primary" is the full button filled with the page accent until followed — the game page's main call to action. */
  variant?: "icon" | "full" | "primary";
  /** Smaller glass chip for overlaying a poster; keeps a 44px hit area. */
  compact?: boolean;
  className?: string;
}

export function WatchButton({ game, variant = "icon", compact = false, className }: WatchButtonProps) {
  const { user, enabled } = useAuth();
  const { isFollowed, toggleFollow, syncFollow } = useWatchlist();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const calm = useCalmMotion();

  const followed = isFollowed(game.id);

  useEffect(() => {
    if (!followed || !("dlcs" in game)) return;
    void syncFollow(game).catch(() => {});
  }, [followed, game, syncFollow]);

  const handleClick = async (event: React.MouseEvent) => {
    // These render inside <Link> cards — never navigate on a toggle.
    event.preventDefault();
    event.stopPropagation();

    if (!enabled) {
      toast("Sign-in isn't configured for this deployment yet.", "info");
      return;
    }
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/game/${game.slug}`)}`);
      return;
    }

    setBusy(true);
    try {
      const nowFollowed = await toggleFollow(game);
      haptic(nowFollowed ? "success" : "light");
      toast(
        nowFollowed
          ? `Following ${game.name} — release and DLC alerts are on`
          : `Unfollowed ${game.name}`,
        nowFollowed ? "success" : "info",
      );
    } catch (err) {
      haptic("warning");
      toast(err instanceof Error ? err.message : "Couldn't update your watchlist.", "error");
    } finally {
      setBusy(false);
    }
  };

  const label = followed ? `Unfollow ${game.name}` : `Follow ${game.name}`;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label={label}
        aria-pressed={followed}
        title={label}
        className={cn(
          "press relative grid place-items-center rounded-full border backdrop-blur-md transition-[background-color,border-color,color] duration-300",
          compact
            ? "h-[34px] w-[34px] after:absolute after:-inset-[5px] after:content-['']"
            : "h-9 w-9 coarse:h-11 coarse:w-11",
          followed
            ? "border-brand/50 bg-brand/30 text-white"
            : "border-white/15 bg-black/45 text-white/85 fine:hover:bg-black/70 fine:hover:text-white",
          // Only `compact` sits over a poster. The regular icon lives on page
          // rows (card footers, timelines, search), where a dark glass chip
          // would be a grey blot on the light theme.
          !compact &&
            (followed
              ? "light:border-brand/35 light:bg-brand/12 light:text-brand-soft"
              : "light:border-fg/10 light:bg-fg/[0.05] light:text-muted light:fine:hover:bg-fg/[0.09] light:fine:hover:text-text"),
          busy && "opacity-60",
          className,
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={followed ? "on" : "off"}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 26 }}
          >
            {followed ? <BellRing size={compact ? 15 : 16} /> : <BellPlus size={compact ? 15 : 16} />}
          </motion.span>
        </AnimatePresence>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-pressed={followed}
      className={cn(
        "press inline-flex min-h-12 items-center justify-center gap-2 rounded-full border px-6 text-[15px] font-semibold transition-[background-color,border-color,color,box-shadow] duration-300",
        // Followed takes the page's cover-derived accent where there is one.
        followed
          ? "border-[color-mix(in_oklab,var(--game-accent,var(--color-brand))_55%,transparent)] bg-[color-mix(in_oklab,var(--game-accent,var(--color-brand))_20%,transparent)] text-text shadow-[0_8px_24px_-12px_var(--game-glow,transparent)]"
          : variant === "primary"
            ? "border-transparent bg-[var(--game-accent,var(--color-brand))] text-[var(--game-on-accent,#fff)] shadow-[0_12px_32px_-14px_var(--game-glow,rgba(138,114,255,0.7))] fine:hover:brightness-110"
            : "border-fg/15 bg-fg/[0.08] text-text backdrop-blur-xl fine:hover:bg-fg/[0.14]",
        busy && "opacity-60",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {/* The bell rings once when you start following. */}
        <motion.span
          key={followed ? "on" : "off"}
          initial={{ scale: 0.6, opacity: 0, rotate: 0 }}
          animate={followed && !calm ? { scale: 1, opacity: 1, rotate: [0, -16, 12, -6, 0] } : { scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="inline-flex"
        >
          {followed ? <BellRing size={17} /> : <BellPlus size={17} />}
        </motion.span>
      </AnimatePresence>
      {followed ? "Following" : "Follow game"}
    </button>
  );
}
