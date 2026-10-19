"use client";

/**
 * Stats: who is playing (our own hourly Steam samples), and how it runs on
 * PC handhelds and Linux (Steam Deck, ProtonDB) plus what finishing it asks
 * of you (achievements).
 *
 * Everything here is from sources we can name, and "since" dates are shown
 * wherever the data is our own recording — a 90-day chart over nine days of
 * samples would otherwise imply a history we don't have. Ranges longer than
 * what we've recorded are disabled rather than drawn mostly empty.
 */

import { LayoutGroup, motion } from "motion/react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Activity, BadgeCheck, CircleAlert, CircleHelp, CircleSlash, Trophy, Users } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import { compactNumber } from "@/lib/utils/format";
import type { AchievementStats, DeckStatus, GamePcInfo, PlayerHistory, ProtonTier } from "@/lib/games/types";
import { DetailSection } from "./DetailSection";
import { pcUrl, playersUrl, useEndpoint, type GameIds } from "./endpoint";
import { useLiveField } from "./live";
import { TimeChart } from "./TimeChart";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const RANGES = [
  { value: "24h", label: "24H", ms: DAY },
  { value: "7d", label: "7D", ms: 7 * DAY },
  { value: "30d", label: "30D", ms: 30 * DAY },
  { value: "90d", label: "90D", ms: 90 * DAY },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];

const full = new Intl.NumberFormat("en-US");
const playersLabel = (n: number) => (n >= 100_000 ? compactNumber(n) : full.format(n));
const HOUR_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric" });
const AXIS_HOUR = new Intl.DateTimeFormat("en-US", { hour: "numeric" });
const AXIS_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
// UTC like every other calendar date on the site: `since` is a UTC day, and a
// local-zone format showed it a day early west of Greenwich.
const SINCE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const SINCE_SHORT_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "since Oct 19" this year, "since Oct 19, 2025" otherwise — the tile's note truncated with the year. */
function sinceLabel(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return `since ${(sameYear ? SINCE_SHORT_FMT : SINCE_FMT).format(date)}`;
}

export function StatsSection({ ids }: { ids: GameIds }) {
  // Same cached requests the cards make; read here only to know whether
  // there's anything at all, so an empty section explains itself instead of
  // leaving a bare heading.
  const history = useEndpoint<PlayerHistory>(playersUrl(ids));
  const pc = useEndpoint<GamePcInfo>(pcUrl(ids));
  const live = useLiveField((data) => data.steamPlayers);
  const noPlayers =
    history.status !== "loading" && live.state === "empty" && !(history.status === "ready" && history.data.points.length > 0);
  const noPc =
    pc.status !== "loading" && (pc.status !== "ready" || (!pc.data.deck && !pc.data.proton && !pc.data.achievements));

  return (
    <DetailSection
      id="stats"
      eyebrow="Stats"
      icon={<Activity size={14} />}
      title="Players and PC"
      description="Live Steam numbers we record every hour, plus how it runs on Steam Deck and Linux."
    >
      {noPlayers && noPc ? (
        <p className="glass rounded-3xl p-5 text-[15px] text-muted sm:p-6">
          Steam isn&rsquo;t sharing player numbers or PC compatibility for this game yet.
        </p>
      ) : (
        <div className="space-y-4">
          <PlayersCard ids={ids} />
          <PcCards ids={ids} />
        </div>
      )}
    </DetailSection>
  );
}

/* ------------------------------------------------------------------------ */

function PlayersCard({ ids }: { ids: GameIds }) {
  const history = useEndpoint<PlayerHistory>(playersUrl(ids));
  const live = useLiveField((data) => data.steamPlayers);
  const [range, setRange] = useState<RangeKey>("7d");

  const points = useMemo(
    () => (history.status === "ready" ? history.data.points.map((point) => ({ t: point.t * 1000, v: point.players })) : []),
    [history],
  );
  const recorded = points.length > 1 ? points[points.length - 1].t - points[0].t : 0;
  // A range is offered once we've recorded at least half of it.
  const available = RANGES.filter((option, index) => index === 0 || recorded >= option.ms / 2);
  const effective = available.some((option) => option.value === range) ? range : available[available.length - 1].value;
  const rangeMs = RANGES.find((option) => option.value === effective)!.ms;
  const visible = useMemo(() => {
    if (points.length === 0) return points;
    const cutoff = points[points.length - 1].t - rangeMs;
    return points.filter((point) => point.t >= cutoff);
  }, [points, rangeMs]);

  const now = live.state === "ready" ? live.value : points.length ? points[points.length - 1].v : null;
  const data = history.status === "ready" ? history.data : null;
  const loading = history.status === "loading" && live.state === "loading";

  if (!loading && now === null && points.length === 0) return null;

  const peakInRange = visible.length ? Math.max(...visible.map((point) => point.v)) : null;

  return (
    <div className="glass rounded-3xl p-5 sm:p-6">
      <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:gap-x-4">
        <Stat
          label="Playing now"
          icon={live.state === "ready" ? <LiveDot /> : <Users size={13} />}
          value={now !== null ? playersLabel(now) : null}
          loading={loading}
          note="on Steam"
        />
        <Stat
          label="24-hour peak"
          value={data?.peak24h != null ? playersLabel(data.peak24h) : null}
          loading={history.status === "loading"}
        />
        <Stat
          label="Tracked peak"
          value={data?.peakTracked != null ? playersLabel(data.peakTracked) : null}
          loading={history.status === "loading"}
          note={data?.since ? sinceLabel(data.since) : undefined}
        />
      </div>

      {history.status === "loading" ? (
        <Skeleton className="mt-6 h-[200px] w-full rounded-2xl" />
      ) : points.length >= 3 ? (
        <div className="mt-6 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-muted">
              Concurrent players
              {peakInRange !== null && (
                <span className="text-faint"> · peak {playersLabel(peakInRange)} in this range</span>
              )}
            </p>
            {available.length > 1 && (
              <RangeControl
                options={available.map((option) => ({ value: option.value, label: option.label }))}
                value={effective}
                onChange={(value) => setRange(value as RangeKey)}
                label="Chart range"
              />
            )}
          </div>
          <TimeChart
            className="mt-4"
            points={visible}
            height={200}
            formatValue={(v) => `${full.format(Math.round(v))} players`}
            formatTick={(v) => compactNumber(Math.round(v))}
            formatTime={(t) => HOUR_FMT.format(new Date(t))}
            formatAxisTime={(t) => (rangeMs <= DAY ? AXIS_HOUR : AXIS_DAY).format(new Date(t))}
            label="Steam concurrent players"
            summary={`Hourly Steam player counts over the last ${effective}. Latest ${playersLabel(visible[visible.length - 1]?.v ?? 0)}, peak ${playersLabel(peakInRange ?? 0)}.`}
          />
        </div>
      ) : (
        <p className="mt-5 border-t border-line pt-4 text-[13px] leading-relaxed text-muted">
          We&rsquo;ve only just started recording players for this game. The chart fills in hour by hour.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
  note,
  icon,
  className,
}: {
  label: string;
  value: string | null;
  loading: boolean;
  note?: string;
  icon?: ReactNode;
  className?: string;
}) {
  if (!loading && value === null) return null;
  return (
    <div className={cn("min-w-0", className)}>
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        {icon}
        {label}
      </p>
      {loading || value === null ? (
        <Skeleton className="mt-2 h-8 w-24 rounded-lg" />
      ) : (
        <p className="mt-1 font-display text-[clamp(1.15rem,5.6vw,2rem)] font-bold leading-none tracking-[-0.02em] text-text">{value}</p>
      )}
      {note && value !== null && <p className="mt-1.5 truncate text-[12px] text-faint">{note}</p>}
    </div>
  );
}

function LiveDot() {
  return (
    <span aria-hidden className="relative flex h-2 w-2">
      <span className="absolute inset-0 animate-ping rounded-full bg-flare/70 [animation-duration:1.8s]" />
      <span className="relative h-2 w-2 rounded-full bg-flare" />
    </span>
  );
}

/** A compact segmented control: a radio group with a sliding thumb. */
export function RangeControl({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const calm = useCalmMotion();
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div role="radiogroup" aria-label={label} className="flex rounded-full border border-line bg-fg/[0.05] p-0.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                if (selected) return;
                haptic("selection");
                onChange(option.value);
              }}
              className={cn(
                "press relative min-h-9 min-w-11 rounded-full px-3 text-[12px] font-semibold tabular-nums transition-colors coarse:min-h-10",
                selected ? "text-text" : "text-muted fine:hover:text-text",
              )}
            >
              {selected && (
                <motion.span
                  layoutId="range-thumb"
                  aria-hidden
                  transition={calm ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42 }}
                  className="absolute inset-0 rounded-full bg-panel shadow-[0_1px_4px_-1px_rgba(0,0,0,0.35)] light:shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
                />
              )}
              <span className="relative">{option.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

/* ------------------------------------------------------------------------ */

export const DECK: Record<DeckStatus, { label: string; detail: string; icon: ReactNode; className: string }> = {
  verified: {
    label: "Verified",
    detail: "Plays great on Steam Deck, out of the box.",
    icon: <BadgeCheck size={16} />,
    className: "text-mint",
  },
  playable: {
    label: "Playable",
    detail: "Works, but may need a tweak — small text or a controller setting.",
    icon: <CircleAlert size={16} />,
    className: "text-gold",
  },
  unsupported: {
    label: "Unsupported",
    detail: "Valve reports it doesn't currently run on Steam Deck.",
    icon: <CircleSlash size={16} />,
    className: "text-flare",
  },
  unknown: {
    label: "Not yet tested",
    detail: "Valve hasn't reviewed it for Steam Deck yet.",
    icon: <CircleHelp size={16} />,
    className: "text-muted",
  },
};

const PROTON: Record<ProtonTier, { label: string; dot: string }> = {
  native: { label: "Native Linux", dot: "bg-mint" },
  platinum: { label: "Platinum", dot: "bg-[#b4c7dc]" },
  gold: { label: "Gold", dot: "bg-[#cfb53b]" },
  silver: { label: "Silver", dot: "bg-[#a6a6a6]" },
  bronze: { label: "Bronze", dot: "bg-[#cd7f32]" },
  borked: { label: "Borked", dot: "bg-flare" },
  pending: { label: "Pending", dot: "bg-fg/30" },
};

function PcCards({ ids }: { ids: GameIds }) {
  const pc = useEndpoint<GamePcInfo>(pcUrl(ids));
  if (pc.status === "loading") {
    return (
      <div aria-hidden className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-[168px] rounded-3xl" />
        <Skeleton className="h-[168px] rounded-3xl" />
      </div>
    );
  }
  if (pc.status !== "ready") return null;
  const { deck, proton, achievements } = pc.data;
  const hasCompat = Boolean(deck || proton);
  if (!hasCompat && !achievements) return null;

  return (
    <div className={cn("grid gap-4", hasCompat && achievements && "md:grid-cols-2")}>
      {hasCompat && (
        <div className="glass rounded-3xl p-5 sm:p-6">
          <h3 className="text-[17px] font-semibold text-text">Handheld &amp; Linux</h3>
          <dl className="mt-4 divide-y divide-line">
            {deck && (
              <div className="flex items-start gap-3 pb-3.5">
                <dt className="sr-only">Steam Deck</dt>
                <span className={cn("mt-0.5 shrink-0", DECK[deck].className)} aria-hidden>
                  {DECK[deck].icon}
                </span>
                <dd className="min-w-0">
                  <p className="text-[15px] font-semibold text-text">
                    Steam Deck <span className={DECK[deck].className}>{DECK[deck].label}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted">{DECK[deck].detail}</p>
                </dd>
              </div>
            )}
            {proton && (
              <div className={cn("flex items-start gap-3", deck && "pt-3.5")}>
                <dt className="sr-only">ProtonDB</dt>
                <span className="mt-0.5 shrink-0 text-muted" aria-hidden>
                  <BrandIcon name="linux" size={16} title={null} />
                </span>
                <dd className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 text-[15px] font-semibold text-text">
                    ProtonDB
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", PROTON[proton.tier].dot)} />
                      {PROTON[proton.tier].label}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted">
                    {proton.tier === "native"
                      ? "Has a native Linux build."
                      : proton.reports > 0
                        ? `From ${full.format(proton.reports)} player ${proton.reports === 1 ? "report" : "reports"}${proton.confidence ? ` · ${proton.confidence} confidence` : ""}`
                        : "Not enough reports yet."}
                  </p>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {achievements && <AchievementsCard stats={achievements} />}
    </div>
  );
}

function AchievementsCard({ stats }: { stats: AchievementStats }) {
  // One hue, light → dark as achievements get rarer (a sequential ramp);
  // counts are also in the legend, so colour never carries meaning alone.
  const bands = [
    { key: "common", label: "Common", count: stats.rarity.common, opacity: 0.28 },
    { key: "uncommon", label: "Uncommon", count: stats.rarity.uncommon, opacity: 0.5 },
    { key: "rare", label: "Rare", count: stats.rarity.rare, opacity: 0.75 },
    { key: "ultraRare", label: "Ultra rare", count: stats.rarity.ultraRare, opacity: 1 },
  ];
  const counted = bands.reduce((sum, band) => sum + band.count, 0);

  return (
    <div className="glass rounded-3xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[17px] font-semibold text-text">Achievements</h3>
        <Trophy size={17} className="shrink-0 text-[var(--game-accent)]" aria-hidden />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <p className="font-display text-[28px] font-bold leading-none text-text">{full.format(stats.total)}</p>
          <p className="mt-1 text-[12px] text-muted">to unlock</p>
        </div>
        {stats.rarest !== null && (
          <div>
            <p className="font-display text-[28px] font-bold leading-none text-text">{formatPercent(stats.rarest)}</p>
            <p className="mt-1 text-[12px] text-muted">of players have the rarest</p>
          </div>
        )}
      </div>

      {counted > 0 && (
        <>
          <div className="mt-5 flex h-2.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={bands.map((band) => `${band.count} ${band.label.toLowerCase()}`).join(", ")}>
            {bands
              .filter((band) => band.count > 0)
              .map((band) => (
                <span
                  key={band.key}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{
                    width: `${(band.count / counted) * 100}%`,
                    background: `color-mix(in oklab, var(--game-accent) ${band.opacity * 100}%, transparent)`,
                  }}
                />
              ))}
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
            {bands.map((band) => (
              <li key={band.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-sm"
                  style={{ background: `color-mix(in oklab, var(--game-accent) ${band.opacity * 100}%, transparent)` }}
                />
                {band.label} <span className="tabular-nums text-faint">{band.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {stats.highlighted.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Notable achievements">
          {stats.highlighted.slice(0, 8).map((achievement) => (
            <li key={achievement.name} title={achievement.name} className="relative h-10 w-10 overflow-hidden rounded-lg bg-fg/[0.06]">
              {/* eslint-disable-next-line @next/next/no-img-element -- Steam's achievement CDN isn't a configured image host; 64px icons need no optimisation. */}
              <img src={achievement.icon} alt={achievement.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatPercent(value: number): string {
  if (value < 0.1) return "<0.1%";
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}
