/**
 * The weekly owner digest: last week's numbers as an email (HTML + text).
 *
 * Built from the same `computeStats` the dashboard uses, pinned to the last
 * full ISO week (Monday–Sunday, UTC) and compared with the week before. Every
 * build is stored in D1 so /admin can preview it; it's emailed only when
 * `RESEND_API_KEY` is set. Search queries are visitor-typed text, so every
 * string that reaches the HTML is escaped.
 */

import type { D1Database } from "@/lib/cloudflare/db";
import { adminEmails } from "./admin-auth";
import { readEnv } from "./runtime";
import { computeStats } from "./stats";
import { VITAL_THRESHOLDS, type DigestDelivery, type DigestRecord, type Kpi, type StatsResponse, type VitalSummary } from "./types";
import { weekStartOf } from "./week";

const WEEK = 7 * 86_400;
const KEEP_DIGESTS = 20;

/** Monday 00:00 UTC of the previous week → Sunday 23:59:59. */
export function lastWeekPeriod(nowSeconds = Math.floor(Date.now() / 1000)): { start: number; end: number } {
  const thisMonday = weekStartOf(nowSeconds);
  return { start: thisMonday - WEEK, end: thisMonday - 1 };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const fmt = new Intl.NumberFormat("en");
const dayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

function change(kpi: Kpi): { text: string; tone: "up" | "down" | "flat" } {
  if (kpi.previous === 0) return kpi.current > 0 ? { text: "new", tone: "up" } : { text: "no change", tone: "flat" };
  const pct = ((kpi.current - kpi.previous) / kpi.previous) * 100;
  if (Math.abs(pct) < 0.5) return { text: "flat", tone: "flat" };
  return { text: `${pct > 0 ? "+" : ""}${Math.round(pct)}%`, tone: pct > 0 ? "up" : "down" };
}

const percent = (value: number, base: number) => (base > 0 ? `${Math.round((value / base) * 100)}%` : "—");

function formatVital(vital: VitalSummary): string {
  if (vital.p75 === null) return "no samples";
  const value = vital.name === "CLS" ? vital.p75.toFixed(2) : vital.name === "LCP" ? `${(vital.p75 / 1000).toFixed(2)} s` : `${Math.round(vital.p75)} ms`;
  const t = VITAL_THRESHOLDS[vital.name];
  const rating = vital.p75 <= t.good ? "good" : vital.p75 <= t.poor ? "needs work" : "poor";
  return `${value} (${rating}, ${fmt.format(vital.samples)} samples)`;
}

const ROMAN_WORD = /^(?:i{1,3}|iv|vi{0,3}|ix|x)$/;
const prettySlug = (slug: string) =>
  slug.split("-").map((w) => (ROMAN_WORD.test(w) ? w.toUpperCase() : w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
/** "home:trending" → "Home · Trending", as on the dashboard. */
const prettySource = (src: string) =>
  src.split(":").map((part) => part.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())).join(" · ");
const plural = (n: number, word: string) => `${fmt.format(n)} ${word}${n === 1 ? "" : "s"}`;

interface DigestContent {
  subject: string;
  html: string;
  text: string;
}

/** Pure: stats in, email out. Exported for the preview and for tests. */
export function renderDigest(stats: StatsResponse, period: { start: number; end: number }, siteUrl: string | null): DigestContent {
  const range = `${dayFmt.format(period.start * 1000)} – ${dayFmt.format(period.end * 1000)}`;
  const { kpis } = stats;
  const pv = change(kpis.pageviews);
  const subject = `Arnav Games weekly: ${fmt.format(kpis.pageviews.current)} pageviews (${pv.text}) · ${range}`;

  const returningShare = percent(stats.returning.current, stats.returning.currentDays);
  const followRate = percent(kpis.follows.current, kpis.gameViews.current);
  const tiles: { label: string; value: string; delta?: ReturnType<typeof change> }[] = [
    { label: "Pageviews", value: fmt.format(kpis.pageviews.current), delta: pv },
    { label: "Searches", value: fmt.format(kpis.searches.current), delta: change(kpis.searches) },
    { label: "Follows", value: fmt.format(kpis.follows.current), delta: change(kpis.follows) },
    { label: "Sign-ups", value: fmt.format(kpis.signups.current), delta: change(kpis.signups) },
    { label: "Returning visitors", value: returningShare },
    { label: "Follow rate", value: followRate },
  ];

  const lists: { title: string; rows: [string, string][]; empty: string }[] = [
    {
      title: "Top games",
      rows: stats.topGames.slice(0, 5).map((g) => [prettySlug(g.slug), `${plural(g.views, "view")}${g.follows ? ` · ${plural(g.follows, "follow")}` : ""}`]),
      empty: "No game pages viewed.",
    },
    {
      title: "Top searches",
      rows: stats.topSearches.slice(0, 5).map((q) => [q.query, `${fmt.format(q.count)}×`]),
      empty: "No searches.",
    },
    {
      title: "Searches with no results",
      rows: stats.zeroResultSearches.slice(0, 5).map((q) => [q.query, `${fmt.format(q.count)}×`]),
      empty: "Every search found something.",
    },
    {
      title: "What drove follows & sign-ups",
      rows: stats.attribution
        .slice(0, 5)
        .map((a) => [a.src ? prettySource(a.src) : "No recorded source", `${plural(a.views, "view")} · ${plural(a.follows, "follow")} · ${plural(a.signups, "sign-up")}`]),
      empty: "No attributed game views yet.",
    },
    {
      title: "Web Vitals (p75)",
      rows: stats.vitals.map((v) => [v.name, formatVital(v)]),
      empty: "No samples.",
    },
  ];

  // Newest cohort that has had a full week to come back.
  const cohort = stats.retention.find((c) => c.size > 0 && c.weeks[1] != null);
  const retentionLine = cohort
    ? `Of ${fmt.format(cohort.size)} browsers first seen in ${cohort.cohort}, ${fmt.format(cohort.weeks[1]!.returners)} (${percent(cohort.weeks[1]!.returners, cohort.size)}) came back the following week.`
    : "Not enough history for a retention snapshot yet.";

  const dashboard = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/admin` : null;

  // --- Text
  const text = [
    `Arnav Games — weekly digest, ${range} (UTC)`,
    "",
    ...tiles.map((t) => `${t.label}: ${t.value}${t.delta ? ` (${t.delta.text} vs previous week)` : ""}`),
    "",
    ...lists.flatMap((list) => [
      list.title,
      ...(list.rows.length ? list.rows.map(([a, b]) => `  • ${a} — ${b}`) : [`  ${list.empty}`]),
      "",
    ]),
    "Retention",
    `  ${retentionLine}`,
    "",
    "Cookieless and estimated: counts are events, not tracked people.",
    dashboard ? `Dashboard: ${dashboard}` : "",
  ].join("\n");

  // --- HTML (inline styles and tables: what email clients actually render)
  const toneColor = { up: "#1f7f38", down: "#d1003f", flat: "#6e6e73" } as const;
  const tileCells = tiles
    .map(
      (t) => `<td width="33%" style="padding:6px;vertical-align:top">
  <div style="background:#ffffff;border-radius:14px;padding:14px 14px 12px;min-height:66px">
    <div style="font-size:12px;color:#6e6e73">${escapeHtml(t.label)}</div>
    <div style="font-size:24px;font-weight:700;letter-spacing:-0.02em;color:#1d1d1f;margin-top:4px">${escapeHtml(t.value)}</div>
    ${t.delta ? `<div style="font-size:12px;font-weight:600;color:${toneColor[t.delta.tone]};margin-top:4px">${escapeHtml(t.delta.text)} <span style="color:#86868b;font-weight:400">vs prior week</span></div>` : ""}
  </div>
</td>`,
    )
    .reduce<string[]>((rows, cell, i) => {
      if (i % 3 === 0) rows.push("");
      rows[rows.length - 1] += cell;
      return rows;
    }, [])
    .map((cells) => `<tr>${cells}</tr>`)
    .join("");

  const listBlocks = lists
    .map(
      (list) => `<tr><td style="padding:6px">
  <div style="background:#ffffff;border-radius:14px;padding:16px">
    <div style="font-size:15px;font-weight:600;color:#1d1d1f;margin-bottom:8px">${escapeHtml(list.title)}</div>
    ${
      list.rows.length
        ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${list.rows
            .map(
              ([a, b]) =>
                `<tr><td style="padding:6px 0;border-top:1px solid #f0f0f2;font-size:14px;color:#1d1d1f">${escapeHtml(a)}</td><td align="right" style="padding:6px 0 6px 12px;border-top:1px solid #f0f0f2;font-size:13px;color:#6e6e73;white-space:nowrap">${escapeHtml(b)}</td></tr>`,
            )
            .join("")}</table>`
        : `<div style="font-size:13px;color:#6e6e73">${escapeHtml(list.empty)}</div>`
    }
  </div>
</td></tr>`,
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f5f5f7"><tr><td align="center" style="padding:28px 12px">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px">
<tr><td style="padding:0 6px 18px">
  <div style="font-size:13px;font-weight:600;color:#6a4dff">Arnav Games · Weekly digest</div>
  <div style="font-size:30px;font-weight:700;letter-spacing:-0.03em;color:#1d1d1f;margin-top:4px">${escapeHtml(range)}</div>
  <div style="font-size:14px;color:#6e6e73;margin-top:4px">Last week, Monday to Sunday (UTC), compared with the week before.</div>
</td></tr>
<tr><td><table width="100%" cellpadding="0" cellspacing="0" role="presentation">${tileCells}</table></td></tr>
<tr><td><table width="100%" cellpadding="0" cellspacing="0" role="presentation">${listBlocks}
<tr><td style="padding:6px"><div style="background:#ffffff;border-radius:14px;padding:16px">
  <div style="font-size:15px;font-weight:600;color:#1d1d1f;margin-bottom:6px">Retention</div>
  <div style="font-size:14px;line-height:1.5;color:#1d1d1f">${escapeHtml(retentionLine)}</div>
  <div style="font-size:13px;color:#6e6e73;margin-top:4px">Returning visitors were ${escapeHtml(returningShare)} of visitor-days.</div>
</div></td></tr>
</table></td></tr>
<tr><td style="padding:16px 6px 0;font-size:12px;line-height:1.5;color:#86868b">
  ${dashboard ? `<a href="${escapeHtml(dashboard)}" style="display:inline-block;background:#6a4dff;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:999px;margin-bottom:14px">Open the dashboard</a><br>` : ""}
  Cookieless and estimated: counts are events, not tracked people, and visitors with Do Not Track or Global Privacy Control are never counted. You get this because your address is on the site&rsquo;s admin list.
</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Build, deliver, store
// ---------------------------------------------------------------------------

async function deliver(content: DigestContent): Promise<{ delivery: DigestDelivery; recipients: number; error: string | null }> {
  const key = await readEnv("RESEND_API_KEY");
  if (!key) return { delivery: "not-configured", recipients: 0, error: null };
  const to = [...(await adminEmails())];
  if (to.length === 0) return { delivery: "failed", recipients: 0, error: "ADMIN_EMAILS is empty" };
  const from = (await readEnv("DIGEST_FROM")) ?? "Arnav Games <onboarding@resend.dev>";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: content.subject, html: content.html, text: content.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      return { delivery: "failed", recipients: 0, error: `Resend ${response.status}: ${detail}` };
    }
    return { delivery: "sent", recipients: to.length, error: null };
  } catch (err) {
    return { delivery: "failed", recipients: 0, error: String(err).slice(0, 300) };
  }
}

/** Builds last week's digest, emails it when configured, and stores it. */
export async function runDigest(db: D1Database, kind: DigestRecord["kind"]): Promise<DigestRecord> {
  const period = lastWeekPeriod();
  const stats = await computeStats(db, "7d", period.end);
  // Static access first: NEXT_PUBLIC_* is inlined at build time.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (await readEnv("NEXT_PUBLIC_SITE_URL")) || null;
  const content = renderDigest(stats, period, siteUrl);
  const outcome = await deliver(content);
  const createdAt = Math.floor(Date.now() / 1000);

  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO analytics_digests (kind, created_at, period_start, period_end, subject, html, text, delivery, recipients, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(kind, createdAt, period.start, period.end, content.subject, content.html, content.text, outcome.delivery, outcome.recipients, outcome.error),
    // Only the latest few are ever shown; don't let weekly HTML pile up.
    db.prepare(`DELETE FROM analytics_digests WHERE id NOT IN (SELECT id FROM analytics_digests ORDER BY id DESC LIMIT ${KEEP_DIGESTS})`),
  ]);

  return {
    id: Number(inserted?.meta.last_row_id ?? 0),
    kind,
    createdAt,
    periodStart: period.start,
    periodEnd: period.end,
    ...content,
    ...outcome,
  };
}

export async function latestDigest(db: D1Database): Promise<DigestRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, kind, created_at, period_start, period_end, subject, html, text, delivery, recipients, error
       FROM analytics_digests ORDER BY id DESC LIMIT 1`,
    )
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: Number(row.id),
    kind: row.kind === "test" ? "test" : "scheduled",
    createdAt: Number(row.created_at),
    periodStart: Number(row.period_start),
    periodEnd: Number(row.period_end),
    subject: String(row.subject),
    html: String(row.html),
    text: String(row.text),
    delivery: (row.delivery as DigestDelivery) ?? "not-configured",
    recipients: Number(row.recipients ?? 0),
    error: row.error == null ? null : String(row.error),
  };
}

/** Seconds since the most recent test send, or null if there's never been one. */
export async function secondsSinceLastTest(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare("SELECT MAX(created_at) AS t FROM analytics_digests WHERE kind = 'test'")
    .first<{ t: number | null }>();
  return row?.t == null ? null : Math.floor(Date.now() / 1000) - row.t;
}
