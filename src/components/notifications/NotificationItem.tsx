"use client";

import Link from "next/link";
import { CalendarClock, Gamepad2, Puzzle, Rocket } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import type { AppNotification, NotificationKind } from "@/lib/notifications/model";
import { cn } from "@/lib/utils/cn";

const KIND_META: Record<NotificationKind, { label: string; icon: typeof Rocket; tone: string }> = {
  "release-today": { label: "Releases today", icon: Rocket, tone: "text-gold bg-gold/10 border-gold/20" },
  "release-soon": { label: "Coming soon", icon: CalendarClock, tone: "text-brand-soft bg-brand/10 border-brand/20" },
  released: { label: "Out now", icon: Gamepad2, tone: "text-neon bg-neon/10 border-neon/20" },
  "dlc-today": { label: "DLC today", icon: Puzzle, tone: "text-gold bg-gold/10 border-gold/20" },
  "dlc-soon": { label: "DLC incoming", icon: Puzzle, tone: "text-brand-soft bg-brand/10 border-brand/20" },
  "dlc-released": { label: "New add-on", icon: Puzzle, tone: "text-neon bg-neon/10 border-neon/20" },
};

export function NotificationItem({
  notification,
  read,
  compact = false,
  onOpen,
}: {
  notification: AppNotification;
  read: boolean;
  compact?: boolean;
  onOpen: () => void;
}) {
  const meta = KIND_META[notification.kind];
  const Icon = meta.icon;

  return (
    <Link
      href={notification.href}
      onClick={onOpen}
      className={cn(
        "group relative flex gap-3 rounded-2xl border p-3 transition-[background-color,border-color,transform] duration-300",
        read
          ? "border-transparent bg-transparent hover:border-line hover:bg-white/[0.035]"
          : "border-brand/20 bg-brand/[0.065] hover:border-brand/35 hover:bg-brand/[0.09]",
        !compact && "sm:p-4 fine:hover:translate-x-0.5",
      )}
    >
      <span
        className={cn(
          "relative shrink-0 overflow-hidden rounded-xl border border-line bg-bg-elev",
          compact ? "h-14 w-11" : "h-[72px] w-14",
        )}
      >
        <GameCover
          name={notification.gameName}
          slug={notification.href}
          image={notification.image}
          imageFallback={notification.imageFallback}
          width={144}
          sizes={compact ? "44px" : "56px"}
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]", meta.tone)}>
            <Icon size={10} /> {meta.label}
          </span>
          {!read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand shadow-[0_0_12px_var(--color-brand)]" aria-label="Unread" />}
        </span>
        <span className={cn("mt-1.5 block font-semibold leading-snug", compact ? "line-clamp-1 text-[13px]" : "text-sm sm:text-[15px]")}>
          {notification.title}
        </span>
        <span className={cn("mt-1 block leading-relaxed text-muted", compact ? "line-clamp-2 text-[11px]" : "text-xs sm:text-[13px]")}>
          {notification.body}
        </span>
      </span>
    </Link>
  );
}
