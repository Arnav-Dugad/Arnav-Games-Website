"use client";

/**
 * Where the reader is with a game: no status, want to play, playing, or played.
 *
 * A segmented control rather than a dropdown, because showing the small set of
 * mutually-exclusive states makes the current one
 * readable at a glance — which is the point on a page you land on to remember
 * what you were doing.
 *
 * Selecting any state creates a personal record if needed. Status never owns
 * that record: tapping it cannot erase follows, ownership, or subscription
 * history stored alongside it.
 */

import dynamic from "next/dynamic";
import { useId, useState } from "react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { Bookmark, Check, CircleOff, Gamepad2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { useToast } from "@/components/ui/Toast";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import type { WatchStatus } from "@/lib/firebase/db";
import type { GameSummary } from "@/lib/games/types";
import { isUnreleased } from "@/lib/utils/format";

// The "Played" celebration is only needed after a tap; it stays out of the first load.
const UnlockToast = dynamic(() => import("@/components/game/detail/UnlockToast").then((mod) => mod.UnlockToast), { ssr: false });

const OPTIONS: { value: WatchStatus; label: string; icon: typeof Bookmark }[] = [
  { value: "none", label: "No status", icon: CircleOff },
  { value: "want", label: "Want to play", icon: Bookmark },
  { value: "playing", label: "Playing", icon: Gamepad2 },
  { value: "played", label: "Played", icon: Check },
];

export function StatusPicker({
  game,
  className,
}: {
  game: GameSummary;
  className?: string;
}) {
  const { user, enabled } = useAuth();
  const { statusOf, setStatus, ensure } = useWatchlist();
  const { toast } = useToast();
  const router = useRouter();

  const [busy, setBusy] = useState<WatchStatus | null>(null);
  // Shown as selected the instant it is tapped; the store catches up.
  const [optimistic, setOptimistic] = useState<WatchStatus | null>(null);
  const current = optimistic ?? statusOf(game.id);
  const calm = useCalmMotion();
  const pillId = useId();
  // Bumped per "Played"; also the toast's key, so marking twice replays it.
  const [unlocks, setUnlocks] = useState(0);
  const options = isUnreleased(game)
    ? OPTIONS.filter((option) => option.value === "none" || option.value === "want")
    : OPTIONS;

  const choose = async (value: WatchStatus) => {
    if (!enabled) {
      toast("Sign-in isn't configured for this deployment yet.", "info");
      return;
    }
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/game/${game.slug}`)}`);
      return;
    }

    // Checked before the busy flag: re-selecting the active state is a no-op,
    // and flagging it first disabled the whole group for a render tick while
    // doing nothing.
    if (current === value) return;

    haptic("selection");
    setBusy(value);
    setOptimistic(value);
    try {
      await ensure(game);
      await setStatus(game.id, value);
      haptic("success");
      if (value === "played" && !calm) {
        // Finishing a game gets a moment of its own; with motion off, the plain toast says it.
        setUnlocks((count) => count + 1);
      } else {
        toast(
          value === "none"
            ? "Play status cleared"
            : `Marked as ${OPTIONS.find((o) => o.value === value)?.label.toLowerCase()}`,
          "success",
        );
      }
    } catch (err) {
      haptic("warning");
      toast(err instanceof Error ? err.message : "Couldn't save that.", "error");
    } finally {
      setBusy(null);
      setOptimistic(null);
    }
  };

  return (
    <div
      role="group"
      aria-label="Your status with this game"
      className={cn(
        "flex items-center gap-1 rounded-full border border-fg/[0.09] bg-fg/[0.06] p-1 sm:inline-flex",
        className,
      )}
    >
      {options.map((option) => {
        const active = (current ?? "none") === option.value;
        const Icon = busy === option.value ? Loader2 : option.icon;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            aria-pressed={active}
            // Labels are visual-only below `sm` (icons carry the row there), so
            // the name has to live on the button or phones get four unnamed buttons.
            aria-label={option.label}
            title={option.label}
            disabled={busy !== null}
            className={cn(
              "press relative isolate inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-300 sm:flex-none coarse:min-h-11",
              busy !== null && busy !== option.value && "opacity-60",
              active
                ? "text-[var(--game-on-accent,#fff)]"
                : "text-muted fine:hover:bg-fg/[0.08] fine:hover:text-text",
            )}
          >
            {/* One pill that glides between segments, like iOS's segmented
                control, tinted with the page's cover accent when there is one. */}
            {active && (
              <motion.span
                layoutId={pillId}
                aria-hidden
                transition={calm ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }}
                className="absolute inset-0 -z-10 rounded-full bg-[var(--game-accent,var(--color-brand))] shadow-[inset_0_1px_0_#ffffff40,0_6px_18px_-6px_var(--game-glow,rgba(138,114,255,0.7))]"
              />
            )}
            <Icon size={14} className={cn(busy === option.value && "animate-spin")} />
            <span className={cn(option.value === "none" ? "sr-only sm:not-sr-only" : "hidden sm:inline")}>{option.label}</span>
          </button>
        );
      })}
      {unlocks > 0 && <UnlockToast key={unlocks} name={game.name} />}
    </div>
  );
}
