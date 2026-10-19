"use client";

/**
 * The private analytics dashboard.
 *
 * Auth is enforced on the server (every `/api/admin/*` route verifies the
 * Firebase ID token and the admin claim/allow-list); this component only
 * decides which honest state to show — signing in, locked, unavailable — and
 * never holds anything a non-admin could read, because it never receives it.
 *
 * Layout: one sticky bar (range + section jump links) over eight sections —
 * Live, Traffic, Engagement, Search, Attribution, Retention, Performance,
 * Digest. Live and Digest load on their own, so they work even before any
 * event exists.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  CheckCircle2,
  Database,
  Gauge,
  Globe2,
  KeyRound,
  LockKeyhole,
  MailWarning,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
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
import { BarList, SegmentedBar, TrendChart, formatCount, pct, type Segment } from "./charts";
import { AttributionPanel } from "./AttributionPanel";
import { DigestPanel } from "./DigestPanel";
import { LiveSection } from "./LiveSection";
import { RetentionPanel } from "./RetentionPanel";
import { SearchFixes } from "./SearchFixes";
import { Caveat, KpiTile, Panel, PanelEmpty, Section, relativeTime } from "./ui";
import { useAdminFetch, type AdminFetch } from "./useAdminFetch";
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

const SECTIONS = [
  { id: "live", label: "Live" },
  { id: "traffic", label: "Traffic" },
  { id: "engagement", label: "Engagement" },
  { id: "search", label: "Search" },
  { id: "attribution", label: "Attribution" },
  { id: "retention", label: "Retention" },
  { id: "performance", label: "Performance" },
  { id: "digest", label: "Digest" },
] as const;

export function AdminDashboard() {
  const { user, loading: authLoading, enabled, signOut } = useAuth();
  const searchParams = useSearchParams();
  // See `devBypass` in lib/analytics/admin-auth.ts — the server ignores this
  // outside `next dev` on localhost, and production builds strip this branch.
  const devBypass = process.env.NODE_ENV === "development" && searchParams.get("devBypass") === "1";
  const adminFetch = useAdminFetch(user, devBypass);

  const [range, setRange] = useState<StatsRange>("7d");
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: StatsResponse; error?: FetchError } | null>(null);
  const [lastGood, setLastGood] = useState<StatsResponse | null>(null);

  const canFetch = devBypass || (!authLoading && Boolean(user));
  const requestKey = canFetch ? `${range}|${user?.uid ?? "dev"}|${reload}` : null;
  const fetching = requestKey !== null && result?.key !== requestKey;
  const activeSection = useActiveSection(lastGood !== null);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const headers: Record<string, string> = {};
        // Forced refresh: a newly granted `admin` claim only appears in a fresh token.
        if (user && !devBypass) headers.Authorization = `Bearer ${await user.getIdToken(true)}`;
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

      <AdminIdentity
        email={devBypass ? "dev-bypass@localhost" : (user?.email ?? null)}
        onSignOut={devBypass ? undefined : () => void signOut()}
      />

      {/* Filters scope everything below them, in one bar above the content.
          A blurred material, so it stays legible while panels scroll under. */}
      <div className="sticky top-[4.5rem] z-30 -mx-1 px-1 py-2 lg:top-[5.25rem]">
        <div className="material flex items-center gap-1 rounded-full p-1 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.5)]">
          <RangeControl value={range} onChange={setRange} />
          <span aria-hidden className="mx-1 hidden h-5 w-px shrink-0 bg-line-strong md:block" />
          <SectionNav active={activeSection} className="hidden md:flex" />
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            className="press ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors fine:hover:bg-fg/[0.08] fine:hover:text-text coarse:h-10 coarse:w-10"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw size={15} className={cn(fetching && "animate-spin")} />
          </button>
        </div>
      </div>
      <SectionNav active={activeSection} className="-mx-4 flex px-3 md:hidden" />

      {error && (
        <p role="alert" className="mt-3 rounded-2xl border border-flare/30 bg-flare/[0.06] px-4 py-2.5 text-[13px] text-muted">
          Couldn&rsquo;t refresh — showing the last loaded numbers.
        </p>
      )}

      <Section id="live" title="Live" scope="Right now">
        <LiveSection adminFetch={adminFetch} />
      </Section>

      {/* Refetch keeps the frame: the previous render dims instead of flashing. */}
      <div className={cn("transition-opacity duration-300", fetching && "opacity-55")} aria-busy={fetching}>
        {data.lifetime.events === 0 ? (
          <div className="pt-9">
            <NoDataYet />
          </div>
        ) : (
          <DashboardBody data={data} adminFetch={adminFetch} />
        )}
      </div>

      <Section id="digest" title="Digest" scope="Weekly">
        <DigestPanel adminFetch={adminFetch} />
      </Section>
    </Container>
  );
}

/* ---------------------------------------------------------------------------
 * Header pieces
 * ------------------------------------------------------------------------ */

/** Which section sits in the reading band just under the sticky bar. */
function useActiveSection(ready: boolean): string {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    if (!ready || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) setActive(visible[0].target.id);
      },
      { rootMargin: "-25% 0px -65% 0px" },
    );
    for (const section of SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ready]);
  return active;
}

function SectionNav({ active, className }: { active: string; className?: string }) {
  return (
    <nav
      aria-label="Dashboard sections"
      className={cn("min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]", className)}
    >
      {SECTIONS.map((section) => {
        const current = active === section.id;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={current ? "location" : undefined}
            className={cn(
              "press shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors coarse:py-3",
              current ? "text-text md:bg-fg/[0.08]" : "text-faint fine:hover:text-text",
            )}
          >
            {section.label}
          </a>
        );
      })}
    </nav>
  );
}

function AdminIdentity({ email, onSignOut }: { email: string | null; onSignOut?: () => void }) {
  return (
    <div className="mb-2 flex min-w-0 items-center gap-2.5">
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand/15 px-2.5 py-1 text-[12px] font-semibold text-brand-soft">
        <ShieldCheck size={13} aria-hidden />
        Admin
      </span>
      {email && (
        <span className="min-w-0 truncate text-[13px] text-muted" title={email}>
          {email}
        </span>
      )}
      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="press ml-auto shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold text-faint fine:hover:text-text coarse:min-h-11"
        >
          Sign out
        </button>
      )}
    </div>
  );
}

function RangeControl({ value, onChange }: { value: StatsRange; onChange: (range: StatsRange) => void }) {
  return (
    <div role="radiogroup" aria-label="Time range" className="flex shrink-0 items-center gap-0.5">
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
              "press h-8 min-w-[3.25rem] rounded-full px-3 text-[13px] font-semibold tabular-nums transition-colors coarse:h-10",
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

/* ---------------------------------------------------------------------------
 * Body
 * ------------------------------------------------------------------------ */

function DashboardBody({ data, adminFetch }: { data: StatsResponse; adminFetch: AdminFetch }) {
  const { kpis, series } = data;
  const fmt = useMemo(() => timeFormatters(data.bucket), [data.bucket]);
  const rangeLabel = RANGE_LABELS[data.range];
  const scope = `Last ${rangeLabel}`;

  const rate: Kpi = {
    current: kpis.gameViews.current > 0 ? kpis.follows.current / kpis.gameViews.current : 0,
    previous: kpis.gameViews.previous > 0 ? kpis.follows.previous / kpis.gameViews.previous : 0,
  };
  const returning = data.returning;
  const returningShare: Kpi = {
    current: returning.currentDays > 0 ? returning.current / returning.currentDays : 0,
    previous: returning.previousDays > 0 ? returning.previous / returning.previousDays : 0,
  };

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
    <>
      <Section id="traffic" title="Traffic" scope={scope}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-12 lg:gap-4">
          <KpiTile label="Pageviews" kpi={kpis.pageviews} spark={series.map((p) => p.pageviews)} />
          <KpiTile label="Searches" kpi={kpis.searches} spark={series.map((p) => p.searches)} />
          <div className="col-span-2 grid sm:col-span-1">
            <KpiTile
              label="Returning visitors"
              kpi={returningShare}
              rate
              note={
                returning.currentDays > 0
                  ? `${formatCount(returning.current)} of ${formatCount(returning.currentDays)} visitor-days · estimated`
                  : "No tagged visits in this range yet"
              }
            />
          </div>
        </div>

        <Panel
          className="lg:col-span-8"
          icon={<BarChart3 size={16} />}
          title="Pageviews"
          subtitle={`${formatCount(totalPageviews)} in the last ${rangeLabel} · ${data.bucket === "hour" ? "hourly" : "daily"}, UTC`}
        >
          {totalPageviews === 0 ? (
            <PanelEmpty>No pageviews in this range.</PanelEmpty>
          ) : (
            <TrendChart points={trend} label="Pageviews" formatTick={fmt.tick} formatTooltipTime={fmt.tooltip} className="mt-2" />
          )}
        </Panel>

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

        <Panel className="lg:col-span-4" title="Referrers" subtitle="Where visits came from">
          {data.referrers.length === 0 ? (
            <PanelEmpty>No external referrers yet — visits so far were direct or from this site.</PanelEmpty>
          ) : (
            <BarList items={data.referrers.map((ref) => ({ key: ref.host, label: ref.host, value: ref.count }))} />
          )}
        </Panel>

        <Panel className="lg:col-span-4" icon={<Globe2 size={16} />} title="Countries" subtitle="By pageviews">
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
            <Caveat>
              {formatCount(data.unknownCountry)} pageview{data.unknownCountry === 1 ? "" : "s"} without a country (local,
              Tor or no edge header).
            </Caveat>
          )}
        </Panel>

        <Panel className="lg:col-span-4" title="Devices" subtitle="Share of pageviews">
          {data.devices.length === 0 ? (
            <PanelEmpty>No pageviews in this range.</PanelEmpty>
          ) : (
            <SegmentedBar
              segments={data.devices.map(
                (d): Segment => ({ key: d.device, label: DEVICE_LABELS[d.device], value: d.count, color: DEVICE_COLORS[d.device] }),
              )}
            />
          )}
        </Panel>
      </Section>

      <Section id="engagement" title="Engagement" scope={scope}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-12 lg:gap-4">
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

        <Panel className="lg:col-span-5" title="Top games" subtitle="Game page views · follows">
          {data.topGames.length === 0 ? (
            <PanelEmpty>No game pages viewed or followed in this range.</PanelEmpty>
          ) : (
            <BarList
              items={data.topGames.map((game) => ({
                key: game.slug,
                label: prettySlug(game.slug),
                value: game.views,
                meta:
                  game.follows || game.owns
                    ? [game.follows && `${game.follows} follow${game.follows === 1 ? "" : "s"}`, game.owns && `${game.owns} owned`]
                        .filter(Boolean)
                        .join(" · ")
                    : undefined,
                href: `/game/${game.slug}`,
                title: game.slug,
              }))}
            />
          )}
        </Panel>

        <Panel className="lg:col-span-7" title="Funnel by device" subtitle="Visit → game page → follow → sign-up">
          <Funnel rows={data.funnel} />
        </Panel>
      </Section>

      <Section id="search" title="Search" scope={scope}>
        <Panel
          className="lg:col-span-6"
          icon={<Search size={16} />}
          title="Searches with no results"
          subtitle="Games people looked for and didn't find"
        >
          {data.zeroResultSearches.length === 0 ? (
            <PanelEmpty>
              {data.topSearches.length === 0 ? "No searches in this range." : "Every search in this range found something."}
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
                  <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-text">{formatCount(row.count)}×</span>
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

        <SearchFixes adminFetch={adminFetch} />
      </Section>

      <Section id="attribution" title="Attribution" scope={scope}>
        <AttributionPanel data={data} />
      </Section>

      <Section id="retention" title="Retention" scope="Last 8 weeks">
        <RetentionPanel data={data} />
      </Section>

      <Section id="performance" title="Performance" scope={scope}>
        <Panel className="lg:col-span-12" icon={<Gauge size={16} />} title="Web Vitals" subtitle="75th percentile of real visits">
          <VitalsList vitals={data.vitals} />
        </Panel>
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Pieces
 * ------------------------------------------------------------------------ */

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
    <ul className="grid gap-6 md:grid-cols-3 md:gap-8">
      {vitals.map((vital) => {
        const rating = vital.p75 === null ? null : rate(vital.name, vital.p75);
        const meta = rating ? RATING_META[rating] : null;
        const t = VITAL_THRESHOLDS[vital.name];
        return (
          <li key={vital.name}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0">
                <span className="text-[15px] font-semibold">{vital.name}</span>
                <span className="ml-2 hidden text-[12px] text-faint min-[420px]:inline md:hidden xl:inline">{VITAL_LABELS[vital.name]}</span>
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
              {index > 0 && <p className="text-[11px] tabular-nums text-faint">{ratio(value, total.visits)} of visits</p>}
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
      <Caveat>
        Stage counts, not tracked people: with no cookies or IDs, each column counts events, so a visitor who opens three
        game pages adds three. A visit is a page load (the first pageview of a tab).
      </Caveat>
    </div>
  );
}

function SearchCaveat() {
  return (
    <Caveat>
      Search runs as you type, so partial queries are counted too. Counts are searches the server answered; edge-cached
      repeats aren&rsquo;t seen.
    </Caveat>
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
      <Skeleton className="mb-3 h-6 w-48 rounded-full" />
      <Skeleton className="mb-8 h-12 w-full max-w-xl rounded-full" />
      <div className="grid gap-5 lg:grid-cols-12">
        <Skeleton className="h-52 rounded-3xl lg:col-span-4" />
        <Skeleton className="h-52 rounded-3xl lg:col-span-8" />
      </div>
      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-3xl" />
        ))}
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

/** "hades-ii" → "Hades II". Steam fallback slugs keep their suffix. */
function prettySlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => (/^(?:i{1,3}|iv|vi{0,3}|ix|x)$/.test(word) ? word.toUpperCase() : word ? word[0].toUpperCase() + word.slice(1) : word))
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
