"use client";

/**
 * Review watch — for the fortnight either side of launch, when "is it any
 * good?" is the whole conversation.
 *
 * Before launch it counts down and says, honestly, that reviews usually land
 * around release. Review embargo times aren't published anywhere we can read,
 * so it never names one. After launch it gathers the verdicts as they arrive:
 * IGDB's critic aggregate (server-rendered, refreshed by re-requesting the
 * page's server data every few minutes), Steam's live user summary, and links
 * out to the critic aggregators.
 *
 * The phase is decided in the browser after mount: the server only knows the
 * day, and a page cached around midnight would otherwise show the wrong half.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Eye, RefreshCw } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { Countdown } from "@/components/game/Countdown";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils/cn";
import { compactNumber, parseISO } from "@/lib/utils/format";
import { useGameLive } from "./live";

const SERVER_REFRESH_MS = 10 * 60_000;

export function ReviewWatch({
  launchDate,
  critic,
  links,
  hasSteam,
}: {
  launchDate: string;
  critic: { score: number | null; label: string };
  links: { openCritic: string | null; metacritic: string | null };
  hasSteam: boolean;
}) {
  const router = useRouter();
  const { data, status, refreshing, refresh } = useGameLive();
  const [launched, setLaunched] = useState<boolean | null>(null);

  useEffect(() => {
    const target = parseISO(launchDate)?.getTime() ?? 0;
    const check = () => setLaunched(Date.now() >= target);
    const frame = requestAnimationFrame(check);
    const interval = window.setInterval(check, 30_000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, [launchDate]);

  // After launch, pick up a new IGDB critic aggregate without a reload.
  useEffect(() => {
    if (!launched) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, SERVER_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [launched, router]);

  if (launched === null) return <div className="h-[180px]" aria-hidden />;

  const reviews = data?.steamReviews ?? null;
  const updated = data?.fetchedAt ? new Date(data.fetchedAt) : null;
  const outLinks = [
    links.openCritic ? { label: "OpenCritic", url: links.openCritic, icon: null } : null,
    links.metacritic ? { label: "Metacritic", url: links.metacritic, icon: "metacritic" } : null,
  ].filter((link): link is NonNullable<typeof link> => link !== null);

  return (
    <section
      id="review-watch"
      aria-labelledby="review-watch-title"
      className="relative isolate scroll-mt-36 overflow-hidden rounded-3xl border border-[color-mix(in_oklab,var(--game-accent)_30%,transparent)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--game-accent)_14%,transparent),transparent_60%)] p-5 sm:p-7"
    >
      <span aria-hidden className="pointer-events-none absolute -left-20 -top-24 -z-10 h-64 w-64 rounded-full bg-[var(--game-glow)] blur-3xl" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))]">
            <Eye size={14} /> Review watch
          </p>
          <h2 id="review-watch-title" className="mt-1 text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">
            {launched ? "The verdicts are coming in" : "Reviews are on the way"}
          </h2>
        </div>
        {launched && (
          <button
            type="button"
            onClick={() => {
              refresh();
              router.refresh();
            }}
            className="press inline-flex items-center gap-1.5 rounded-full bg-fg/[0.07] px-3 py-1.5 text-xs font-medium text-muted transition-colors fine:hover:text-text"
          >
            <RefreshCw size={12} className={cn(refreshing && "animate-spin")} />
            {updated ? `Updated ${updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Refresh"}
          </button>
        )}
      </div>

      {!launched ? (
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Critic reviews typically arrive around launch. This card switches to live scores the moment the game is out — check back on release day.
          </p>
          <Countdown date={launchDate} size="sm" className="shrink-0" />
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-4 rounded-2xl bg-fg/[0.04] p-4">
            {critic.score !== null ? (
              <>
                <ScoreRing score={critic.score} size={64} strokeWidth={5} label={critic.label} />
                <div>
                  <p className="text-sm font-semibold text-text">{critic.label}</p>
                  <p className="text-xs text-muted">Aggregate from published reviews</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">No critic aggregate yet — scores appear once enough reviews are published.</p>
            )}
          </div>

          {hasSteam && (
            <div className="rounded-2xl bg-fg/[0.04] p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
                <BrandIcon name="steam" size={11} title={null} /> Steam user reviews
              </p>
              {status === "loading" && !data ? (
                <div aria-hidden className="mt-2 space-y-2">
                  <Skeleton className="h-5 w-32 rounded-full" />
                  <Skeleton className="h-3 w-40 rounded-full" />
                </div>
              ) : reviews ? (
                <>
                  <p className="mt-1 text-lg font-bold text-text">{reviews.description || `${reviews.percent}% positive`}</p>
                  <p className="text-xs text-muted tabular-nums">
                    {reviews.percent}% positive · {compactNumber(reviews.total)} reviews
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted">No Steam reviews yet.</p>
              )}
            </div>
          )}
        </div>
      )}

      {outLinks.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {outLinks.map((link) => (
            <li key={link.label}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="press inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-fg/[0.04] px-4 text-[13px] font-medium text-text transition-colors fine:hover:border-line-strong"
              >
                {link.icon && <BrandIcon name={link.icon} size={13} title={null} />}
                {link.label}
                <ArrowUpRight size={13} className="text-faint" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
