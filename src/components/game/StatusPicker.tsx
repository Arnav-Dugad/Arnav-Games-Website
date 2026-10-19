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

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Check, CircleOff, Gamepad2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import type { WatchStatus } from "@/lib/firebase/db";
import type { GameSummary } from "@/lib/games/types";
import { isUnreleased } from "@/lib/utils/format";

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
  const current = statusOf(game.id);
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

    setBusy(value);
    try {
      await ensure(game);
      await setStatus(game.id, value);
      toast(
        value === "none"
          ? "Play status cleared"
          : `Marked as ${OPTIONS.find((o) => o.value === value)?.label.toLowerCase()}`,
        "success",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save that.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="group"
      aria-label="Your status with this game"
      className={cn(
        "flex items-center gap-1 rounded-full border border-white/[0.09] bg-white/[0.06] p-1 sm:inline-flex",
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
            disabled={busy !== null}
            className={cn(
              "press inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-300 sm:flex-none",
              "disabled:opacity-60",
              active
                ? "bg-brand text-white shadow-[inset_0_1px_0_#ffffff40,0_6px_18px_-6px_rgba(138,114,255,0.7)]"
                : "text-muted fine:hover:bg-white/8 fine:hover:text-text",
            )}
          >
            <Icon size={14} className={cn(busy === option.value && "animate-spin")} />
            <span className={cn(option.value === "none" ? "sr-only sm:not-sr-only" : "hidden sm:inline")}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
