"use client";

import { useMemo, useState } from "react";
import { Bell, BellRing, CalendarClock, CheckCheck, Radio } from "lucide-react";
import { NotificationItem } from "./NotificationItem";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { useNotifications } from "@/lib/notifications/NotificationsProvider";
import { cn } from "@/lib/utils/cn";

type Filter = "all" | "unread";

export function NotificationsView() {
  const { notifications, unreadCount, loading, isRead, markRead, markAllRead } = useNotifications();
  const [filter, setFilter] = useState<Filter>("all");
  const releaseCount = notifications.length;
  const dlcCount = notifications.filter((item) => item.kind.startsWith("dlc-")).length;
  const visible = useMemo(
    () =>
      notifications.filter((item) => {
        if (filter === "unread") return !isRead(item.id);
        return true;
      }),
    [notifications, filter, isRead],
  );

  if (loading) {
    return (
      <Container className="py-10 lg:py-14">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => <div key={index} className="shimmer-bg h-28 rounded-3xl" />)}
        </div>
        <div className="mt-8 space-y-3">{Array.from({ length: 5 }, (_, index) => <div key={index} className="shimmer-bg h-28 rounded-2xl" />)}</div>
      </Container>
    );
  }

  return (
    <Container className="py-8 lg:py-12">
      <Stagger className="grid gap-3 sm:grid-cols-3" onMount gap={0.05}>
        <StaggerItem><Metric icon={<BellRing size={18} />} label="Unread" value={unreadCount} tone="brand" /></StaggerItem>
        <StaggerItem><Metric icon={<CalendarClock size={18} />} label={dlcCount ? `Release updates · ${dlcCount} DLC` : "Release updates"} value={releaseCount} tone="mint" /></StaggerItem>
        <StaggerItem><Metric icon={<CheckCheck size={18} />} label="Read" value={releaseCount - unreadCount} tone="gold" /></StaggerItem>
      </Stagger>

      <Reveal onMount className="mt-8 flex flex-col gap-3 rounded-2xl border border-line bg-panel/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex overflow-x-auto rounded-xl border border-line bg-fg/[0.04] p-1 no-scrollbar">
          <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>All <span>{notifications.length}</span></FilterButton>
          <FilterButton active={filter === "unread"} onClick={() => setFilter("unread")}>Unread <span>{unreadCount}</span></FilterButton>
        </div>
        {unreadCount > 0 && <Button variant="secondary" size="sm" icon={<CheckCheck size={15} />} onClick={markAllRead}>Mark all read</Button>}
      </Reveal>

      <section className="mt-7" aria-live="polite">
        {visible.length === 0 ? (
          <EmptyState
            icon={filter === "all" ? <Bell size={23} /> : <CheckCheck size={23} />}
            title={notifications.length === 0 ? "Nothing needs your attention" : "You're caught up here"}
            body={notifications.length === 0 ? "Follow games to receive only their release and new DLC reminders." : "There are no notifications matching this filter."}
            action={notifications.length === 0 ? { href: "/upcoming", label: "Find upcoming games" } : { onClick: () => setFilter("all"), label: "Show everything" }}
          />
        ) : (
          <Stagger as="ul" onMount className="space-y-2.5" gap={0.035}>
            {visible.map((notification) => (
              <StaggerItem as="li" key={notification.id}>
                <NotificationItem notification={notification} read={isRead(notification.id)} onOpen={() => markRead(notification.id)} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>

      <Reveal className="mt-10 overflow-hidden rounded-3xl border border-brand/20 bg-[radial-gradient(circle_at_0%_0%,rgba(124,92,255,0.16),transparent_44%),color-mix(in_oklab,var(--color-panel)_55%,transparent)] p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div className="flex gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-mint/20 bg-mint/10 text-mint"><Radio size={18} /></span>
            <div><h2 className="font-display text-lg font-bold">Alerts, computed on your device</h2><p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">This inbox is derived from the games you follow, so it needs no server, no permissions and no configuration. Choose which kinds you see in Settings.</p></div>
          </div>
          <Button href="/settings#notifications" variant="secondary" size="sm">Notification settings</Button>
        </div>
      </Reveal>
    </Container>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "brand" | "mint" | "gold" }) {
  return (
    <div className="glass rounded-3xl p-5">
      <span className={cn("grid h-10 w-10 place-items-center rounded-2xl", tone === "mint" ? "bg-mint/10 text-mint" : tone === "gold" ? "bg-gold/10 text-gold" : "bg-brand/10 text-brand-soft")}>{icon}</span>
      <p className="mt-4 font-display text-3xl font-black tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn("flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-3 coarse:min-h-11 text-xs font-semibold transition-colors", active ? "bg-fg/10 text-text" : "text-muted hover:text-text", "[&_span]:text-[10px] [&_span]:text-faint [&_span]:tabular-nums")}>{children}</button>;
}
