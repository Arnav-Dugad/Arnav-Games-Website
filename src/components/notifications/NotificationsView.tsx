"use client";

/**
 * The notification inbox: grouped like iOS — what's happening today, what's
 * coming, what just landed — each group a single inset list.
 *
 * Alerts are derived on this device from the games you follow, so there is
 * nothing to configure here beyond the one switch in Settings, linked at the
 * foot of the page.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { NotificationItem } from "./NotificationItem";
import { EmptyState } from "@/components/ui/EmptyState";
import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { SegmentedControl } from "@/components/filters";
import { useNotifications } from "@/lib/notifications/NotificationsProvider";
import type { AppNotification, NotificationKind } from "@/lib/notifications/model";
import { haptic } from "@/lib/haptics";

type Filter = "all" | "unread";

const GROUPS: { title: string; kinds: NotificationKind[] }[] = [
  { title: "Today", kinds: ["release-today", "dlc-today"] },
  { title: "Coming up", kinds: ["release-soon", "dlc-soon"] },
  { title: "Recently released", kinds: ["released", "dlc-released"] },
];

export function NotificationsView() {
  const { notifications, unreadCount, loading, isRead, markRead, markAllRead } = useNotifications();
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(() => {
    const visible = filter === "unread" ? notifications.filter((item) => !isRead(item.id)) : notifications;
    return GROUPS.map((group) => ({
      title: group.title,
      items: visible.filter((item) => group.kinds.includes(item.kind)),
    })).filter((group) => group.items.length > 0);
  }, [notifications, filter, isRead]);

  if (loading) {
    return (
      <Container className="pb-12">
        <div className="max-w-3xl space-y-3" aria-hidden>
          <Skeleton className="h-11 w-56 rounded-full" />
          <Skeleton className="mt-6 h-4 w-24 rounded" />
          <Skeleton className="h-[228px] w-full rounded-2xl" />
        </div>
      </Container>
    );
  }

  if (notifications.length === 0) {
    return (
      <Container className="pb-12">
        <EmptyState
          className="max-w-3xl"
          icon={<Bell size={24} />}
          title="No notifications yet"
          body="Follow a game and you'll hear about it here when release day is close."
          action={{ href: "/upcoming", label: "Find games to follow" }}
        />
      </Container>
    );
  }

  return (
    <Container className="pb-12 lg:pb-16">
      <div className="max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <SegmentedControl
            label="Show"
            value={filter}
            onChange={setFilter}
            fill={false}
            segments={[
              { value: "all", label: "All", count: notifications.length },
              { value: "unread", label: "Unread", count: unreadCount },
            ]}
          />
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => {
                haptic("success");
                markAllRead();
              }}
              className="press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[15px] font-medium text-brand-soft transition-colors fine:hover:bg-brand/10"
            >
              <CheckCheck size={16} aria-hidden />
              Mark all read
            </button>
          )}
        </div>

        <div aria-live="polite" className="mt-6 space-y-7">
          {groups.length === 0 ? (
            <EmptyState
              icon={<CheckCheck size={24} />}
              title="You're all caught up"
              action={{ onClick: () => setFilter("all"), label: "Show all" }}
            />
          ) : (
            groups.map((group) => (
              <Group key={group.title} title={group.title} items={group.items} isRead={isRead} markRead={markRead} />
            ))
          )}
        </div>

        <p className="mt-8 px-4 text-[13px] text-muted">
          Reminders run from two weeks before release to three days after.{" "}
          <Link href="/settings#notifications" className="font-medium text-brand-soft">
            Change in Settings
          </Link>
        </p>
      </div>
    </Container>
  );
}

function Group({
  title,
  items,
  isRead,
  markRead,
}: {
  title: string;
  items: AppNotification[];
  isRead: (id: string) => boolean;
  markRead: (id: string) => void;
}) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 px-4 text-[13px] font-medium uppercase tracking-[0.04em] text-faint">{title}</h2>
      <ul className="overflow-hidden rounded-2xl border border-line bg-panel/55 light:bg-panel [&>*+*]:border-t [&>*+*]:border-line">
        {items.map((notification) => (
          <li key={notification.id}>
            <NotificationItem
              notification={notification}
              read={isRead(notification.id)}
              onOpen={() => markRead(notification.id)}
              onMarkRead={() => markRead(notification.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
