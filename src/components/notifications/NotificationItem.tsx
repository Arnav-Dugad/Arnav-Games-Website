"use client";

/**
 * One notification row: cover, what happened, when.
 *
 * The model's body sentence ("The wait is over. Open the game page…") said
 * the same thing for every alert of a kind, so rows show the kind and the
 * date instead — the part that actually differs.
 *
 * On touch, an unread row can be swiped left to mark it read, Mail-style.
 * The swipe only ever marks read (there's no "unread" state to return to),
 * and the same action stays reachable without gestures: opening the row
 * marks it read, and the page has "Mark all read".
 */

import Link from "next/link";
import { useRef } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { Check, CalendarClock, Gamepad2, Puzzle, Rocket } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { useMediaQuery } from "@/hooks";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { haptic } from "@/lib/haptics";
import type { AppNotification, NotificationKind } from "@/lib/notifications/model";
import { cn } from "@/lib/utils/cn";

const KIND_META: Record<NotificationKind, { label: string; icon: typeof Rocket; tone: string }> = {
  "release-today": { label: "Out today", icon: Rocket, tone: "text-gold" },
  "release-soon": { label: "Coming soon", icon: CalendarClock, tone: "text-brand-soft" },
  released: { label: "Out now", icon: Gamepad2, tone: "text-mint" },
  "dlc-today": { label: "Add-on out today", icon: Puzzle, tone: "text-gold" },
  "dlc-soon": { label: "Add-on coming", icon: Puzzle, tone: "text-brand-soft" },
  "dlc-released": { label: "New add-on", icon: Puzzle, tone: "text-mint" },
};

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** How far a swipe must travel before letting go marks the row read. */
const COMMIT_AT = -72;

export function NotificationItem({
  notification,
  read,
  compact = false,
  onOpen,
  onMarkRead,
}: {
  notification: AppNotification;
  read: boolean;
  compact?: boolean;
  onOpen: () => void;
  /** Enables swipe-to-read on touch. */
  onMarkRead?: () => void;
}) {
  const meta = KIND_META[notification.kind];
  const Icon = meta.icon;
  const touch = useMediaQuery("(hover: none) and (pointer: coarse)");
  const calm = useCalmMotion();
  const swipeable = Boolean(onMarkRead) && !read && touch;

  const x = useMotionValue(0);
  // When the last swipe ended, so the click that ends it doesn't also open
  // the game. A timestamp, not a flag: a swipe that produces no click must
  // not swallow the next real tap.
  const swipedAt = useRef(0);
  // The action behind the row fades in as it's uncovered.
  const actionOpacity = useTransform(x, [0, COMMIT_AT], [0, 1]);

  const row = (
    <Link
      href={notification.href}
      onClick={(event) => {
        if (Date.now() - swipedAt.current < 400) {
          event.preventDefault();
          return;
        }
        onOpen();
      }}
      // Native link dragging would fight the swipe.
      draggable={false}
      className={cn(
        "group relative flex items-center gap-3 transition-colors",
        compact ? "rounded-2xl p-2.5 hover:bg-fg/[0.04]" : "min-h-[76px] px-4 py-3 fine:hover:bg-fg/[0.03]",
      )}
    >
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", read ? "bg-transparent" : "bg-brand")} />
      <span
        className={cn(
          "relative shrink-0 overflow-hidden rounded-lg ring-1 ring-fg/10",
          compact ? "h-14 w-[42px]" : "h-[60px] w-[45px]",
        )}
      >
        <GameCover
          name={notification.gameName}
          slug={notification.href}
          image={notification.image}
          imageFallback={notification.imageFallback}
          width={120}
          sizes="45px"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block leading-snug",
            compact ? "line-clamp-2 text-[13px]" : "line-clamp-2 text-[15px]",
            read ? "font-medium text-muted" : "font-semibold text-text",
          )}
        >
          {notification.title}
        </span>
        <span className={cn("mt-1 flex items-center gap-1 text-[12px] font-medium", meta.tone)}>
          <Icon size={12} aria-hidden />
          {meta.label}
          <span className="font-normal text-faint">· {DAY.format(new Date(notification.createdAt))}</span>
        </span>
      </span>
      {!read && <span className="sr-only">Unread</span>}
    </Link>
  );

  if (!swipeable) return row;

  return (
    <div className="relative overflow-hidden">
      <motion.span
        aria-hidden
        style={{ opacity: actionOpacity }}
        className="absolute inset-y-0 right-0 flex w-28 items-center justify-end gap-1.5 bg-mint pr-5 text-[14px] font-semibold text-white"
      >
        <Check size={16} strokeWidth={2.5} /> Read
      </motion.span>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -112, right: 0 }}
        dragElastic={{ left: 0.15, right: 0 }}
        dragSnapToOrigin={false}
        style={{ x, touchAction: "pan-y" }}
        onDragEnd={(_, info) => {
          swipedAt.current = Date.now();
          if (info.offset.x <= COMMIT_AT) {
            haptic("success");
            onMarkRead?.();
          }
          // Spring home (or jump, when motion is calmed); the row re-renders
          // as read and stops being swipeable.
          if (calm) x.set(0);
          else animate(x, 0, { type: "spring", stiffness: 500, damping: 40 });
        }}
        className="relative bg-panel"
      >
        {row}
      </motion.div>
    </div>
  );
}
