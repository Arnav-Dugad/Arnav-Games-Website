"use client";

/**
 * The weekly owner digest: status of the latest build, a live preview of the
 * exact email, and "Send test now". Without `RESEND_API_KEY` the digest
 * still builds every Monday and lives here — the panel says so plainly.
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Mail, MailX, Send, TriangleAlert } from "lucide-react";
import type { DigestRecord } from "@/lib/analytics/types";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Panel, PanelEmpty } from "./ui";
import type { AdminFetch } from "./useAdminFetch";
import { cn } from "@/lib/utils/cn";

interface DigestPayload {
  latest: DigestRecord | null;
  emailConfigured: boolean;
}

const dayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const builtFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

export function DigestPanel({ adminFetch }: { adminFetch: AdminFetch }) {
  const [data, setData] = useState<DigestPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await adminFetch("/api/admin/digest");
      const body = (await response.json()) as DigestPayload & { error?: string };
      if (!response.ok || body.error) throw new Error();
      setData(body);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [adminFetch]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the await
    void load();
  }, [load]);

  const sendNow = async () => {
    setSending(true);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin/digest", { method: "POST" });
      const body = (await response.json()) as DigestPayload & { error?: string; retryAfter?: number };
      if (response.status === 429) {
        setNotice(`Just sent one — try again in ${Math.ceil((body.retryAfter ?? 60) / 60)} min.`);
      } else if (!response.ok || body.error) {
        setNotice("Couldn't build the digest. Check the Worker logs.");
      } else {
        setData(body);
        const d = body.latest;
        setNotice(
          d?.delivery === "sent"
            ? `Sent to ${d.recipients} address${d.recipients === 1 ? "" : "es"}.`
            : d?.delivery === "failed"
              ? "Built, but the email provider refused it — see below."
              : "Built. Email is off, so it's here only.",
        );
      }
    } catch {
      setNotice("Network error — nothing was sent.");
    } finally {
      setSending(false);
    }
  };

  const latest = data?.latest ?? null;
  const emailOn = data?.emailConfigured ?? false;

  return (
    <Panel
      className="lg:col-span-12"
      icon={<Mail size={16} />}
      title="Weekly digest"
      subtitle="Last week's numbers, every Monday at 08:00 UTC"
      action={
        <Button size="sm" variant="secondary" icon={<Send size={14} />} loading={sending} disabled={!data} onClick={() => void sendNow()}>
          {emailOn ? "Send test now" : "Build now"}
        </Button>
      }
    >
      {failed && !data ? (
        <PanelEmpty>Couldn&rsquo;t load the digest.</PanelEmpty>
      ) : !data ? (
        <Skeleton className="h-28 rounded-2xl" />
      ) : (
        <>
          {!emailOn && (
            <p className="mb-4 flex items-start gap-2.5 rounded-2xl border border-gold/30 bg-gold/[0.07] px-4 py-3 text-[13px] leading-relaxed text-muted">
              <MailX size={15} className="mt-0.5 shrink-0 text-gold" aria-hidden />
              <span>
                <span className="font-semibold text-text">Email delivery is off.</span> Set{" "}
                <code className="font-mono text-[12px]">RESEND_API_KEY</code> to receive this every Monday. Until then
                the digest is built on schedule and viewable here only.
              </span>
            </p>
          )}
          {notice && (
            <p role="status" className="mb-4 rounded-2xl bg-fg/[0.05] px-4 py-2.5 text-[13px] text-muted">
              {notice}
            </p>
          )}

          {!latest ? (
            <PanelEmpty>No digest yet. The first one builds next Monday — or build one now.</PanelEmpty>
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold" title={latest.subject}>
                    {dayFmt.format(latest.periodStart * 1000)} – {dayFmt.format(latest.periodEnd * 1000)}
                  </p>
                  <p className="mt-0.5 text-[12px] text-faint">
                    {latest.kind === "test" ? "Test build" : "Scheduled"} · built {builtFmt.format(latest.createdAt * 1000)} UTC
                  </p>
                </div>
                <DeliveryChip record={latest} />
              </div>
              {latest.delivery === "failed" && latest.error && (
                <p className="mt-3 rounded-xl bg-flare/[0.07] px-3 py-2 font-mono text-[12px] text-muted">{latest.error}</p>
              )}

              <button
                type="button"
                onClick={() => setPreview((v) => !v)}
                aria-expanded={preview}
                className="press mt-4 inline-flex items-center gap-1.5 rounded-full px-1 text-[13px] font-semibold text-brand-soft"
              >
                <ChevronDown size={15} className={cn("transition-transform", preview && "rotate-180")} aria-hidden />
                {preview ? "Hide preview" : "Preview email"}
              </button>
              {preview && (
                // Sandboxed with no permissions: the email is our HTML, but it
                // quotes visitor-typed searches, so it gets no script or origin.
                <iframe
                  title="Digest email preview"
                  sandbox=""
                  srcDoc={latest.html}
                  className="mt-3 h-[640px] w-full rounded-2xl border border-line bg-white"
                />
              )}
            </div>
          )}
          <p className="mt-4 text-[12px] leading-relaxed text-faint">
            Sent from <code className="font-mono">onboarding@resend.dev</code> unless <code className="font-mono">DIGEST_FROM</code>{" "}
            is set; Resend only delivers that sender to the address that owns the Resend account. Recipients are the
            admin list (<code className="font-mono">ADMIN_EMAILS</code>).
          </p>
        </>
      )}
    </Panel>
  );
}

function DeliveryChip({ record }: { record: DigestRecord }) {
  const meta =
    record.delivery === "sent"
      ? { icon: CheckCircle2, text: `Emailed to ${record.recipients}`, className: "text-mint bg-mint/10" }
      : record.delivery === "failed"
        ? { icon: TriangleAlert, text: "Email failed", className: "text-flare bg-flare/10" }
        : { icon: MailX, text: "Not emailed", className: "text-muted bg-fg/[0.06]" };
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold", meta.className)}>
      <meta.icon size={13} aria-hidden />
      {meta.text}
    </span>
  );
}
