"use client";

/**
 * The private analytics dashboard.
 *
 * Auth is enforced on the server (`/api/admin/stats` verifies the Firebase
 * ID token and the email allow-list); this component only decides which
 * honest state to show — signing in, locked, unavailable — and never holds
 * anything a non-admin could read, because it never receives it.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Database,
  Gauge,
  Globe2,
  KeyRound,
  LockKeyhole,
  MailWarning,
  Minus,
  RefreshCw,
  Search,
  Settings2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  STATS_RANGES,
  VITAL_THRESHOLDS,
  type AdminDenial,
  type Device,
  type Kpi,
  type StatsRange,
  type StatsResponse,
  type VitalSummary,
} from "@/lib/analytics/types";
import { BarList, SegmentedBar, Sparkline, TrendChart, formatCount, pct, type Segment } from "./charts";
import { cn } from "@/lib/utils/cn";

type FetchError = AdminDenial | "storage-unavailable" | "query-failed" | "network";

const RANGE_LABELS: Record<StatsRange, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

/*
 * Device hues, validated as a categorical set (dark surface #1c1c1e and a
 * light surface; all-pairs CVD ΔE ≥ 8.8). Brand violet is desktop, so the
 * other two are new hues rather than the gold/flare reserved for status.
 */
const DEVICE_COLORS: Record<Device | "unknown", string> = {
  mobile: "#2a9fd6",
  tablet: "#cf7712",
  desktop: "#8a72ff",
  unknown: "var(--color-faint)",
};
const DEVICE_LABELS: Record<Device | "unknown", string> = {
  mobile: "Mobile",
  tablet: "Tablet",
  desktop: "Desktop",
  unknown: "Unknown",
};

export function AdminDashboard() {
  const { user, loading: authLoading, enabled, signOut } = useAuth();
  const searchParams = useSearchParams();
  // See `devBypass` in lib/analytics/admin-auth.ts — the server ignores this
  // outside `next dev` on localhost, and production builds strip this branch.
  const devBypass = process.env.NODE_ENV === "development" && searchParams.get("devBypass") === "1";

  const [range, setRange] = useState<StatsRange>("7d");
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: StatsResponse; error?: FetchError } | null>(null);
  const [lastGood, setLastGood] = useState<StatsResponse | null>(null);

  const canFetch = devBypass || (!authLoading && Boolean(user));
  const requestKey = canFetch ? `${range}|${user?.uid ?? "dev"}|${reload}` : null;
  const fetching = requestKey !== null && result?.key !== requestKey;

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const headers: Record<string, string> = {};
        if (user && !devBypass) headers.Authorization = `Bearer ${await user.getIdToken()}`;
        const query = new URLSearchParams({ range });
        if (devBypass) query.set("devBypass", "1");
        const response = await fetch(`/api/admin/stats?${query}`, {
          headers,
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as (StatsResponse & { error?: FetchError }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || body.error) {
          setResult({ key: requestKey, error: body?.error ?? "network" });
          return;
        }
        setResult({ key: requestKey, data: body });
        setLastGood(body);
      } catch {
        if (!controller.signal.aborted) setResult({ key: requestKey, error: "network" });
      }
    })();
    return () => controller.abort();
  }, [requestKey, range, user, devBypass]);

  // ---- Gate states ---------------------------------------------------------
  if (!devBypass) {
    if (authLoading) return <DashboardSkeleton />;
    if (!enabled) {
      return (
        <Gate icon={<Settings2 size={24} className="text-gold" />} title="Accounts aren't configured">
          Add the Firebase web-app keys to this deployment. The dashboard signs you in with the same account system as
          the rest of the site.
        </Gate>
      );
    }
    if (!user) {
      return (
        <Gate
          icon={<LockKeyhole size={24} className="text-brand-soft" />}
          title="Sign in to view analytics"
          actions={<Button href="/login?next=%2Fadmin">Sign in</Button>}
        >
          This dashboard is private to the site owner. Sign in with an admin account and you&rsquo;ll come straight back
          here.
        </Gate>
      );
    }
  }

  const error = result?.key === requestKey ? result?.error : undefined;
  if (error === "not-admin") {
    return (
      <Gate
        icon={<KeyRound size={24} className="text-brand-soft" />}
        title="This dashboard is private"
        actions={<Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>}
      >
        You&rsquo;re signed in as <span className="font-semibold text-text">{user?.email ?? "this account"}</span>, which
        isn&rsquo;t on the admin list. Nothing here is broken — it just isn&rsquo;t meant for this account.
      </Gate>
    );
  }
  if (error === "unverified") {
    return (
      <Gate icon={<MailWarning size={24} className="text-gold" />} title="Verify your email first">
        Admin access requires a verified email address, so nobody can claim the owner&rsquo;s address with a new
        password account. Verify it (or sign in with Google), then reload.
      </Gate>
    );
  }
  if (error === "signed-out" || error === "invalid-token") {
    return (
      <Gate
        icon={<LockKeyhole size={24} className="text-brand-soft" />}
        title="Your session couldn't be verified"
        actions={<Button onClick={() => setReload((n) => n + 1)}>Try again</Button>}
      >
        The sign-in token was rejected or expired. Trying again fetches a fresh one.
      </Gate>
    );
  }
  if (error === "not-configured" || error === "storage-unavailable") {
    return (
      <Gate icon={<Database size={24} className="text-gold" />} title="Analytics storage isn't available here">
        {error === "not-configured"
          ? "The Firebase project id isn't set on the server, so admin tokens can't be verified."
          : "The D1 database binding (DB) isn't reachable in this environment. Events are only recorded and read on Cloudflare Workers or in `next dev` with local D1."}
      </Gate>
    );
  }

  const data = (result?.key === requestKey ? result?.data : undefined) ?? lastGood;
  if (!data) {
    if (error) {
      return (
        <Gate
          icon={<TriangleAlert size={24} className="text-flare" />}
          title="Couldn't load analytics"
          actions={<Button onClick={() => setReload((n) => n + 1)}>Retry</Button>}
        >
          The stats request failed. This is usually a network blip; retrying is safe.
        </Gate>
      );
    }
    return <DashboardSkeleton />;
  }

  return (
    <Container className="pb-16">
      {devBypass && (
        <p className="mb-4 rounded-2xl border border-gold/30 bg-gold/[0.08] px-4 py-2.5 text-[13px] text-muted">
          <span className="font-semibold text-gold">Development bypass.</span> Local data, no sign-in. This mode
          doesn&rsquo;t exist in production builds.
        </p>
      )}

      {/* Filters scope everything below them, in one row above the content.
          Sticky on desktop only: on phones it would float over the tiles. */}
      <div className="z-20 -mx-1 mb-5 flex items-center gap-3 px-1 py-2 lg:sticky lg:top-20">
        <RangeControl value={range} onChange={setRange} />
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          className="press material-thin grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition-colors fine:hover:text-text"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={15} className={cn(fetching && "animate-spin")} />
        </button>
        <p className="ml-auto hidden text-[12px] text-faint sm:block">
          {data.bucket === "hour" ? "Hourly" : "Daily"} buckets · UTC
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-2xl border border-flare/30 bg-flare/[0.06] px-4 py-2.5 text-[13px] text-muted">
          Couldn&rsquo;t refresh — showing the last loaded numbers.
        </p>
      )}

      {/* Refetch keeps the frame: the previous render dims instead of flashing. */}
      <div className={cn("transition-opacity duration-300", fetching && "opacity-55")} aria-busy={fetching}>
        {data.lifetime.events === 0 ? (
          <NoDataYet />
        ) : (
          <DashboardBody data={data} />
        )}
      </div>
    </Container>
  );
}

/* ---------------------------------------------------------------------------
 * Body
 * ------------------------------------------------------------------------ */

function DashboardBody({ data }: { data: StatsResponse }) {
  const { kpis, series } = data;
  const fmt = useMemo(() => timeFormatters(data.bucket), [data.bucket]);
  const rangeLabel = RANGE_LABELS[data.range];

  const followRate = (k: Kpi, views: Kpi) => ({
    current: views.current > 0 ? k.current / views.current : 0,
    previous: views.previous > 0 ? k.previous / views.previous : 0,
  });
  const rate = followRate(kpis.follows, kpis.gameViews);

  const trend = series.map((p) => ({
    t: p.t,
    value: p.pageviews,
    details: [
      { label: "game pages", value: p.gameViews },
      { label: "searches", value: p.searches },
      { label: "follows", value: p.follows },
    ],
  }));
  const totalPageviews = kpis.pageviews.current;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-12 lg:gap-4 xl:grid-cols-6">
        <KpiTile label="Pageviews" kpi={kpis.pageviews} spark={series.map((p) => p.pageviews)} />
        <KpiTile label="Searches" kpi={kpis.searches} spark={series.map((p) => p.searches)} />
        <KpiTile label="Follows" kpi={kpis.follows} spark={series.map((p) => p.follows)} />
        <KpiTile label="Owned" kpi={kpis.owns} spark={series.map((p) => p.owns)} />
        <KpiTile label="Sign-ups" kpi={kpis.signups} spark={series.map((p) => p.signups)} />
        <KpiTile
          label="Follow rate"
          kpi={rate}
          rate
          note={`${formatCount(kpis.follows.current)} of ${formatCount(kpis.gameViews.current)} game views`}
          spark={series.map((p) => (p.gameViews > 0 ? p.follows / p.gameViews : 0))}
        />
      </div>

      {/* Trend */}
      <Panel
        className="lg:col-span-8"
        icon={<BarChart3 size={16} />}
        title="Pageviews"
        subtitle={`${formatCount(totalPageviews)} in the last ${rangeLabel}`}
      >
        {totalPageviews === 0 ? (
          <PanelEmpty>No pageviews in this range.</PanelEmpty>
        ) : (
          <TrendChart
            points={trend}
            label="Pageviews"
            formatTick={fmt.tick}
            formatTooltipTime={fmt.tooltip}
            className="mt-2"
          />
        )}
      </Panel>

      {/* Vitals */}
      <Panel
        className="lg:col-span-4"
        icon={<Gauge size={16} />}
        title="Web Vitals"
        subtitle="75th percentile of real visits"
      >
        <VitalsList vitals={data.vitals} />
      </Panel>

      {/* Ranked lists */}
      <Panel className="lg:col-span-4" title="Top pages" subtitle="By pageviews">
        {data.topPages.length === 0 ? (
          <PanelEmpty>No pages viewed in this range.</PanelEmpty>
        ) : (
          <BarList
            items={data.topPages.map((page) => ({
              key: page.path,
              label: <span className="font-mono text-[12px]">{page.path}</span>,
              value: page.count,
              href: page.path,
            }))}
          />
        )}
      </Panel>

      <Panel className="lg:col-span-4" title="Top games" subtitle="Game page views · follows">
        {data.topGames.length === 0 ? (
          <PanelEmpty>No game pages viewed or followed in this range.</PanelEmpty>
        ) : (
          <BarList
            items={data.topGames.map((game) => ({
              key: game.slug,
              label: prettySlug(game.slug),
              value: game.views,
              meta: game.follows || game.owns
                ? [game.follows && `${game.follows} follow${game.follows === 1 ? "" : "s"}`, game.owns && `${game.owns} owned`].filter(Boolean).join(" · ")
                : undefined,
              href: `/game/${game.slug}`,
              title: game.slug,
            }))}
          />
        )}
      </Panel>

      <Panel className="lg:col-span-4" title="Referrers" subtitle="Where visits came from">
        {data.referrers.length === 0 ? (
          <PanelEmpty>No external referrers yet — visits so far were direct or from this site.</PanelEmpty>
        ) : (
          <BarList
            items={data.referrers.map((ref) => ({
              key: ref.host,
              label: ref.host,
              value: ref.count,
            }))}
          />
        )}
      </Panel>

      {/* Search */}
      <Panel
        className="lg:col-span-6"
        icon={<Search size={16} />}
        title="Searches with no results"
        subtitle="Games people looked for and didn't find"
      >
        {data.zeroResultSearches.length === 0 ? (
          <PanelEmpty>
            {data.topSearches.length === 0
              ? "No searches in this range."
              : "Every search in this range found something."}
          </PanelEmpty>
        ) : (
          <ul className="divide-y divide-line">
            {data.zeroResultSearches.map((row) => (
              <li key={row.query} className="flex items-center gap-3 py-2.5 text-[13px] first:pt-0">
                <Link
                  href={`/search?q=${encodeURIComponent(row.query)}`}
                  className="min-w-0 flex-1 truncate font-medium text-text fine:hover:text-brand-soft"
                >
                  {row.query}
                </Link>
                <span className="shrink-0 text-faint">{relativeTime(row.lastSeen, data.generatedAt)}</span>
                <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-text">
                  {formatCount(row.count)}×
                </span>
              </li>
            ))}
          </ul>
        )}
        <SearchCaveat />
      </Panel>

      <Panel className="lg:col-span-6" title="Top searches" subtitle="Count · average results">
        {data.topSearches.length === 0 ? (
          <PanelEmpty>No searches in this range.</PanelEmpty>
        ) : (
          <BarList
            items={data.topSearches.map((row) => ({
              key: row.query,
              label: row.query,
              value: row.count,
              meta: `avg ${Math.round(row.avgResults)} results`,
              href: `/search?q=${encodeURIComponent(row.query)}`,
            }))}
          />
        )}
        <SearchCaveat />
      </Panel>

      {/* Audience */}
      <Panel className="lg:col-span-5 lg:self-start" icon={<Globe2 size={16} />} title="Countries" subtitle="By pageviews">
        {data.countries.length === 0 ? (
          <PanelEmpty>
            No country data yet. It comes from Cloudflare&rsquo;s edge, so local development always reads as unknown.
          </PanelEmpty>
        ) : (
          <BarList
            items={data.countries.map((country) => ({
              key: country.code,
              label: (
                <span className="flex items-center gap-2">
                  <span aria-hidden className="text-[15px] leading-none">{flagEmoji(country.code)}</span>
                  {countryName(country.code)}
                </span>
              ),
              value: country.count,
              title: country.code,
            }))}
          />
        )}
        {data.unknownCountry > 0 && (
          <p className="mt-4 text-[12px] text-faint">
            {formatCount(data.unknownCountry)} pageview{data.unknownCountry === 1 ? "" : "s"} without a country (local,
            Tor or no edge header).
          </p>
        )}
      </Panel>

      <div className="grid gap-4 lg:col-span-7 lg:gap-5">
        <Panel title="Devices" subtitle="Share of pageviews">
          {data.devices.length === 0 ? (
            <PanelEmpty>No pageviews in this range.</PanelEmpty>
          ) : (
            <SegmentedBar
              segments={data.devices.map(
                (d): Segment => ({
                  key: d.device,
                  label: DEVICE_LABELS[d.device],
                  value: d.count,
                  color: DEVICE_COLORS[d.device],
                }),
              )}
            />
          )}
        </Panel>
        <Panel title="Funnel by device" subtitle="Visit → game page → follow → sign-up">
          <Funnel rows={data.funnel} />
        </Panel>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Pieces
 * ------------------------------------------------------------------------ */

function RangeControl({ value, onChange }: { value: StatsRange; onChange: (range: StatsRange) => void }) {
  return (
    <div role="radiogroup" aria-label="Time range" className="material flex items-center gap-0.5 rounded-full p-1">
      {STATS_RANGES.map((range) => {
        const selected = range === value;
        return (
          <button
            key={range}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Last ${RANGE_LABELS[range]}`}
            onClick={() => onChange(range)}
            className={cn(
              "press h-8 min-w-[3.25rem] rounded-full px-3 text-[13px] font-semibold tabular-nums transition-colors coarse:h-9",
              selected ? "bg-fg/[0.14] text-text" : "text-muted fine:hover:text-text",
            )}
          >
            {range.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  icon,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("glass min-w-0 rounded-3xl p-5 sm:p-6", className)}>
      <header className="mb-5 flex items-start gap-2.5">
        {icon && <span className="mt-0.5 text-brand-soft">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[13px] leading-relaxed text-muted">
      {children}
    </p>
  );
}

function KpiTile({
  label,
  kpi,
  spark,
  rate = false,
  note,
}: {
  label: string;
  kpi: Kpi;
  spark: number[];
  rate?: boolean;
  note?: string;
}) {
  const value = rate ? `${(kpi.current * 100).toFixed(kpi.current > 0 && kpi.current < 0.1 ? 1 : 0)}%` : formatCount(kpi.current);
  return (
    <div className="glass flex min-w-0 flex-col rounded-3xl p-4 sm:p-5">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="mt-1.5 font-display text-[28px] font-bold leading-none tracking-[-0.03em] sm:text-[32px]">{value}</p>
      <Delta kpi={kpi} rate={rate} />
      {note && <p className="mt-1 truncate text-[11px] text-faint">{note}</p>}
      <Sparkline values={spark} className="mt-auto pt-3" />
    </div>
  );
}

/** Signed change vs the same elapsed span of the previous period. Up is good
 *  for every metric here; the arrow carries direction, not just the colour. */
function Delta({ kpi, rate }: { kpi: Kpi; rate: boolean }) {
  const { current, previous } = kpi;
  let text: string;
  let direction: "up" | "down" | "flat";
  if (rate) {
    const points = (current - previous) * 100;
    direction = Math.abs(points) < 0.05 ? "flat" : points > 0 ? "up" : "down";
    text = `${points > 0 ? "+" : ""}${points.toFixed(1)} pts`;
  } else if (previous === 0) {
    direction = current > 0 ? "up" : "flat";
    text = current > 0 ? "New" : "No change";
  } else {
    const change = ((current - previous) / previous) * 100;
    direction = Math.abs(change) < 0.5 ? "flat" : change > 0 ? "up" : "down";
    text = `${change > 0 ? "+" : ""}${Math.round(change)}%`;
  }
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return (
    <p className="mt-2 flex items-center gap-1 text-[12px]">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-semibold",
          direction === "up" && "text-mint",
          direction === "down" && "text-flare",
          direction === "flat" && "text-muted",
        )}
      >
        <Icon size={13} aria-hidden />
        {text}
      </span>
      <span className="text-faint">vs prior</span>
    </p>
  );
}

type Rating = "good" | "needs-improvement" | "poor";
function rate(name: VitalSummary["name"], value: number): Rating {
  const t = VITAL_THRESHOLDS[name];
  return value <= t.good ? "good" : value <= t.poor ? "needs-improvement" : "poor";
}
const RATING_META: Record<Rating, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  good: { label: "Good", className: "text-mint", icon: CheckCircle2 },
  "needs-improvement": { label: "Needs work", className: "text-gold", icon: TriangleAlert },
  poor: { label: "Poor", className: "text-flare", icon: XCircle },
};
const VITAL_LABELS: Record<VitalSummary["name"], string> = {
  LCP: "Largest Contentful Paint",
  INP: "Interaction to Next Paint",
  CLS: "Cumulative Layout Shift",
};

function formatVital(name: VitalSummary["name"], value: number): string {
  if (name === "CLS") return value.toFixed(2);
  if (name === "LCP" && value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

function VitalsList({ vitals }: { vitals: VitalSummary[] }) {
  if (vitals.every((v) => v.samples === 0)) {
    return <PanelEmpty>No vitals yet. They&rsquo;re reported when a visitor leaves or hides a page.</PanelEmpty>;
  }
  return (
    <ul className="space-y-5">
      {vitals.map((vital) => {
        const rating = vital.p75 === null ? null : rate(vital.name, vital.p75);
        const meta = rating ? RATING_META[rating] : null;
        const t = VITAL_THRESHOLDS[vital.name];
        return (
          <li key={vital.name}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0">
                <span className="text-[15px] font-semibold">{vital.name}</span>
                <span className="ml-2 hidden text-[12px] text-faint min-[420px]:inline">{VITAL_LABELS[vital.name]}</span>
              </p>
              <p className="shrink-0 font-display text-[22px] font-bold tabular-nums leading-none">
                {vital.p75 === null ? "—" : formatVital(vital.name, vital.p75)}
              </p>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[12px]">
              {meta ? (
                <span className={cn("inline-flex items-center gap-1 font-semibold", meta.className)}>
                  <meta.icon size={13} aria-hidden />
                  {meta.label}
                </span>
              ) : (
                <span className="text-faint">No samples</span>
              )}
              <span className="text-faint">
                {formatCount(vital.samples)} sample{vital.samples === 1 ? "" : "s"} · good ≤ {formatVital(vital.name, t.good)}
              </span>
            </div>
            {vital.samples > 0 && (
              <div
                className="mt-2.5 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full"
                role="img"
                aria-label={`${pct(vital.good, vital.samples)} good, ${pct(vital.needsImprovement, vital.samples)} needs improvement, ${pct(vital.poor, vital.samples)} poor`}
              >
                {vital.good > 0 && <span className="h-full bg-mint" style={{ flexGrow: vital.good }} title={`Good ${pct(vital.good, vital.samples)}`} />}
                {vital.needsImprovement > 0 && <span className="h-full bg-gold" style={{ flexGrow: vital.needsImprovement }} title={`Needs improvement ${pct(vital.needsImprovement, vital.samples)}`} />}
                {vital.poor > 0 && <span className="h-full bg-flare" style={{ flexGrow: vital.poor }} title={`Poor ${pct(vital.poor, vital.samples)}`} />}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const FUNNEL_STAGES = [
  { key: "visits", label: "Visits" },
  { key: "gameViews", label: "Game pages" },
  { key: "follows", label: "Follows" },
  { key: "signups", label: "Sign-ups" },
] as const;

function Funnel({ rows }: { rows: StatsResponse["funnel"] }) {
  const total = rows.reduce(
    (sum, row) => ({
      visits: sum.visits + row.visits,
      gameViews: sum.gameViews + row.gameViews,
      follows: sum.follows + row.follows,
      signups: sum.signups + row.signups,
    }),
    { visits: 0, gameViews: 0, follows: 0, signups: 0 },
  );
  if (total.visits + total.gameViews + total.follows + total.signups === 0) {
    return <PanelEmpty>No visits in this range.</PanelEmpty>;
  }
  const max = Math.max(1, ...FUNNEL_STAGES.map((s) => total[s.key]));

  return (
    <div>
      <ol className="grid grid-cols-4 gap-2 sm:gap-3">
        {FUNNEL_STAGES.map((stage, index) => {
          const value = total[stage.key];
          return (
            <li key={stage.key} className="min-w-0">
              <div className="flex h-20 items-end rounded-xl bg-fg/[0.04] p-1 sm:h-24">
                <div
                  className="w-full rounded-t-[4px] rounded-b-[2px] bg-brand"
                  style={{ height: `${Math.max(3, (value / max) * 100)}%` }}
                  title={`${stage.label}: ${formatCount(value)}`}
                />
              </div>
              <p className="mt-2 font-display text-[18px] font-bold leading-none tabular-nums">{formatCount(value)}</p>
              <p className="mt-1 truncate text-[12px] text-muted">{stage.label}</p>
              {index > 0 && (
                <p className="text-[11px] tabular-nums text-faint">{ratio(value, total.visits)} of visits</p>
              )}
            </li>
          );
        })}
      </ol>

      <div className="-mx-1 mt-6 overflow-x-auto px-1">
        <table className="w-full min-w-[22rem] text-left text-[13px]">
          <caption className="sr-only">Funnel stages by device</caption>
          <thead>
            <tr className="text-[12px] text-faint">
              <th scope="col" className="pb-2 font-medium">Device</th>
              {FUNNEL_STAGES.map((stage) => (
                <th key={stage.key} scope="col" className="pb-2 text-right font-medium">{stage.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.device}>
                <th scope="row" className="py-2 font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: DEVICE_COLORS[row.device] }} />
                    {DEVICE_LABELS[row.device]}
                  </span>
                </th>
                {FUNNEL_STAGES.map((stage, index) => (
                  <td key={stage.key} className="py-2 text-right tabular-nums">
                    <span className="font-semibold">{formatCount(row[stage.key])}</span>
                    {index > 0 && <span className="ml-1 text-[11px] text-faint">{ratio(row[stage.key], row.visits)}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-faint">
        Stage counts, not tracked people: with no cookies or IDs, each column counts events, so a visitor who opens
        three game pages adds three. A visit is a page load (the first pageview of a tab).
      </p>
    </div>
  );
}

function SearchCaveat() {
  return (
    <p className="mt-4 text-[12px] leading-relaxed text-faint">
      Search runs as you type, so partial queries are counted too. Counts are searches the server answered; edge-cached
      repeats aren&rsquo;t seen.
    </p>
  );
}

function NoDataYet() {
  return (
    <div className="glass flex flex-col items-center rounded-3xl px-6 py-20 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-fg/[0.06] text-faint">
        <BarChart3 size={24} />
      </span>
      <h2 className="mt-5 font-display text-xl font-bold">No data yet</h2>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted">
        Events appear as people visit. Pageviews, searches, follows and Web Vitals are recorded without cookies, and
        visitors with Do Not Track or Global Privacy Control are never counted.
      </p>
    </div>
  );
}

function Gate({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Container className="flex min-h-[55svh] flex-col items-center justify-center pb-24 pt-8 text-center">
      <span className="glass grid h-16 w-16 place-items-center rounded-2xl">{icon}</span>
      <h2 className="mt-6 font-display text-2xl font-bold sm:text-3xl">{title}</h2>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">{children}</p>
      {actions && <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{actions}</div>}
    </Container>
  );
}

function DashboardSkeleton() {
  return (
    <Container className="pb-16">
      <Skeleton className="mb-5 h-10 w-64 rounded-full" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-3xl" />
        ))}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <Skeleton className="h-80 rounded-3xl lg:col-span-8" />
        <Skeleton className="h-80 rounded-3xl lg:col-span-4" />
      </div>
    </Container>
  );
}

/* ---------------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------------ */

function timeFormatters(bucket: StatsResponse["bucket"]) {
  const hour = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const longDay = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return bucket === "hour"
    ? {
        tick: (t: number) => hour.format(t * 1000),
        tooltip: (t: number) => `${day.format(t * 1000)}, ${hour.format(t * 1000)} UTC`,
      }
    : {
        tick: (t: number) => day.format(t * 1000),
        tooltip: (t: number) => `${longDay.format(t * 1000)} (UTC)`,
      };
}

function ratio(value: number, base: number): string {
  if (base <= 0) return "—";
  const p = (value / base) * 100;
  return p >= 10 || p === 0 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`;
}

function relativeTime(ts: number, now: number): string {
  const seconds = Math.max(0, now - ts);
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/** "the-witcher-4" → "The Witcher 4". Steam fallback slugs keep their suffix. */
function prettySlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

let regionNames: Intl.DisplayNames | null | undefined;
function countryName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  return regionNames?.of(code) ?? code;
}
