"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Bell, BellRing, CheckCheck, Sparkles } from "lucide-react";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useNotifications } from "@/lib/notifications/NotificationsProvider";
import { useClickOutside, useEscapeKey } from "@/hooks";
import { cn } from "@/lib/utils/cn";

export function NotificationBell() {
  const { user, enabled } = useAuth();
  const { notifications, unreadCount, loading, isRead, markRead, markAllRead } = useNotifications();
  const pathname = usePathname();
  // Pinned to the route it was opened on: Back or any navigation closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === pathname;
  const close = useCallback(() => setOpenOn(null), []);
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, close, open);
  useEscapeKey(close, open);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpenOn((current) => (current === pathname ? null : pathname))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className={cn(
          "press relative grid h-10 w-10 place-items-center rounded-full border transition-all duration-300 coarse:h-11 coarse:w-11",
          open
            ? "border-brand/55 bg-brand/15 text-text ring-2 ring-brand/20"
            : "border-fg/10 bg-fg/[0.07] text-muted fine:hover:border-line-strong fine:hover:text-text",
        )}
      >
        {unreadCount > 0 ? <BellRing size={16} /> : <Bell size={16} />}
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid min-h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-bg bg-flare px-1 text-[9px] font-black leading-none text-white tabular-nums">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label="Notifications"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            // Phones: pinned to the screen's edges under the header. Anchored
            // to the bell, a viewport-wide panel ran ~34px off the left edge
            // (the bell isn't at the right edge — the avatar is), cutting
            // off every notification's leading text. Capped to the height
            // under the header so landscape phones can reach the footer link.
            className="material material-menu fixed inset-x-3 top-[calc(var(--chrome-top)+0.5rem)] z-50 flex max-h-[calc(100dvh-var(--chrome-top)-var(--tabbar-space)-1rem)] origin-top-right flex-col overflow-hidden rounded-3xl shadow-[0_28px_90px_-30px_rgba(0,0,0,0.9)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+14px)] sm:w-[25rem]"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3.5">
              <div>
                <h2 className="font-display text-sm font-bold">Notifications</h2>
                <p className="mt-0.5 text-[11px] text-faint">
                  {user ? (unreadCount ? `${unreadCount} waiting for you` : "You're all caught up") : "Personal game alerts"}
                </p>
              </div>
              {user && unreadCount > 0 && (
                <button type="button" onClick={markAllRead} className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold coarse:min-h-11 text-brand-soft transition-colors hover:bg-brand/10 hover:text-white">
                  <CheckCheck size={14} /> Mark all read
                </button>
              )}
            </header>

            {/* The one scrolling region, whatever the state, so the footer
                link stays in reach on a 390px-tall landscape phone. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain sm:max-h-[34rem]">
              {!user ? (
                <div className="flex flex-col items-center px-6 py-9 text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl border border-brand/20 bg-brand/10 text-brand-soft"><Sparkles size={19} /></span>
                  <h3 className="mt-4 font-display text-sm font-bold">Your releases, right on time</h3>
                  <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted">Sign in to get release and DLC reminders only for games you follow.</p>
                  {enabled && <Button href="/login?next=%2Fnotifications" size="sm" className="mt-5" onClick={() => close()}>Sign in</Button>}
                </div>
              ) : loading ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 3 }, (_, index) => <div key={index} className="shimmer-bg h-20 rounded-2xl" />)}
                </div>
              ) : notifications.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <Bell size={21} className="mx-auto text-faint" />
                  <h3 className="mt-3 text-sm font-semibold">Quiet for now</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">Follow a game and its release or DLC alerts will appear here.</p>
                </div>
              ) : (
                <div className="space-y-1 p-2.5">
                  {notifications.slice(0, 5).map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      read={isRead(notification.id)}
                      compact
                      onOpen={() => { markRead(notification.id); close(); }}
                    />
                  ))}
                </div>
              )}
            </div>

            <footer className="shrink-0 border-t border-line p-2.5">
              <Link href="/notifications" onClick={() => close()} className="flex min-h-11 items-center justify-center rounded-xl text-xs font-semibold text-muted transition-colors hover:bg-fg/[0.05] hover:text-text">
                Open notification center
              </Link>
            </footer>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
