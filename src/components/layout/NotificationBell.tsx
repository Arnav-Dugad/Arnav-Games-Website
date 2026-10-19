"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, () => setOpen(false), open);
  useEscapeKey(() => setOpen(false), open);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className={cn(
          "press relative grid h-10 w-10 place-items-center rounded-full border transition-all duration-300",
          open
            ? "border-brand/55 bg-brand/15 text-white ring-2 ring-brand/20"
            : "border-white/10 bg-white/[0.07] text-muted fine:hover:border-line-strong fine:hover:text-text",
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
            className="material absolute right-0 top-[calc(100%+14px)] z-50 w-[min(25rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-3xl shadow-[0_28px_90px_-30px_rgba(0,0,0,0.9)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5">
              <div>
                <h2 className="font-display text-sm font-bold">Notifications</h2>
                <p className="mt-0.5 text-[11px] text-faint">
                  {user ? (unreadCount ? `${unreadCount} waiting for you` : "You're all caught up") : "Personal game alerts"}
                </p>
              </div>
              {user && unreadCount > 0 && (
                <button type="button" onClick={markAllRead} className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-brand-soft transition-colors hover:bg-brand/10 hover:text-white">
                  <CheckCheck size={14} /> Mark all read
                </button>
              )}
            </header>

            {!user ? (
              <div className="flex flex-col items-center px-6 py-9 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-brand/20 bg-brand/10 text-brand-soft"><Sparkles size={19} /></span>
                <h3 className="mt-4 font-display text-sm font-bold">Your releases, right on time</h3>
                <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted">Sign in to get release and DLC reminders only for games you follow.</p>
                {enabled && <Button href="/login?next=%2Fnotifications" size="sm" className="mt-5" onClick={() => setOpen(false)}>Sign in</Button>}
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
              <div className="max-h-[min(34rem,70vh)] space-y-1 overflow-y-auto p-2.5">
                {notifications.slice(0, 5).map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    read={isRead(notification.id)}
                    compact
                    onOpen={() => { markRead(notification.id); setOpen(false); }}
                  />
                ))}
              </div>
            )}

            <footer className="border-t border-line p-2.5">
              <Link href="/notifications" onClick={() => setOpen(false)} className="flex min-h-10 items-center justify-center rounded-xl text-xs font-semibold text-muted transition-colors hover:bg-white/[0.05] hover:text-text">
                Open notification center
              </Link>
            </footer>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
