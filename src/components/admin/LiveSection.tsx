"use client";

/**
 * "Online now": the PresenceRoom's live count and the pages people are on,
 * polled every 10 seconds while the dashboard is visible.
 */

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import type { PresenceSnapshot } from "@/lib/analytics/types";
import { BarList, formatCount } from "./charts";
import { Panel, PanelEmpty } from "./ui";
import { startVisiblePolling, type AdminFetch } from "./useAdminFetch";
import { cn } from "@/lib/utils/cn";

const POLL_MS = 10_000;

export function LiveSection({ adminFetch }: { adminFetch: AdminFetch }) {
  const [snapshot, setSnapshot] = useState<PresenceSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      adminFetch("/api/admin/presence")
        .then(async (response) => {
          const body = (await response.json()) as PresenceSnapshot & { error?: string };
          if (cancelled) return;
          if (!response.ok || body.error) {
            setFailed(true);
            return;
          }
          setFailed(false);
          setSnapshot(body);
        })
        .catch(() => !cancelled && setFailed(true));
    };
    const stop = startVisiblePolling(tick, POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [adminFetch]);

  const unavailable = snapshot?.available === false;
  const online = snapshot?.online ?? null;

  return (
    <>
      <div className="glass relative flex min-w-0 flex-col overflow-hidden rounded-3xl p-5 sm:p-6 lg:col-span-4">
        <p className="flex items-center gap-2 text-[13px] font-medium text-muted">
          <LiveDot active={!unavailable && !failed && snapshot !== null} />
          Online now
        </p>
        <p
          className={cn(
            "mt-3 font-display font-bold leading-none tracking-[-0.04em] tabular-nums",
            online === null ? "text-[26px] font-semibold text-faint sm:text-[28px]" : "text-[56px] sm:text-[64px]",
          )}
          aria-live="polite"
        >
          {online === null ? (unavailable ? "Not live here" : "—") : formatCount(online)}
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          {unavailable
            ? "Live presence works on the deployed site. Durable Objects don't run under next dev."
            : failed
              ? "Couldn't reach the live counter. Retrying every 10 seconds."
              : snapshot === null
                ? "Connecting…"
                : `${online === 1 ? "Visitor" : "Visitors"} with the site open in a visible tab, updated every 10 seconds.`}
        </p>
        <p className="mt-auto pt-4 text-[11px] leading-relaxed text-faint">
          Tabs report every 30s while visible and active; counted for 75s after the last beat. Do Not Track, GPC and
          /admin are never counted.
        </p>
      </div>

      <Panel className="lg:col-span-8" icon={<Radio size={16} />} title="Live pages" subtitle="Where people are right now">
        {unavailable ? (
          <PanelEmpty>Live pages appear here once the site is deployed to Cloudflare.</PanelEmpty>
        ) : !snapshot || snapshot.pages.length === 0 ? (
          <PanelEmpty>{snapshot ? "Nobody is on the site this minute." : "Waiting for the first update…"}</PanelEmpty>
        ) : (
          <BarList
            items={snapshot.pages.map((page) => ({
              key: page.path,
              label: <span className="font-mono text-[12px]">{page.path}</span>,
              value: page.count,
              href: page.path,
            }))}
          />
        )}
      </Panel>
    </>
  );
}

/** Mint and breathing while live; a still grey dot otherwise. */
function LiveDot({ active }: { active: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden>
      {active && <span className="absolute inset-0 animate-ping rounded-full bg-mint/60 motion-reduce:hidden" />}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", active ? "bg-mint" : "bg-faint")} />
    </span>
  );
}
