"use client";

/**
 * "For PC players": will it run on *my* PC, how it runs on Steam Deck and
 * Linux, and what finishing it asks (achievements).
 *
 * "Will it run?" compares the reader's own specs (kept on this device, see
 * `usePcSpecs`) with Steam's parsed requirements via `evaluateHardware`. With
 * no specs saved it asks once ("Check my PC"); the minimum/recommended table
 * is behind "Show" either way. When Steam's requirements couldn't be parsed
 * the original text (from the game record) is shown instead, unjudged.
 */

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { CircleCheck, CircleHelp, CircleX, Cpu, MonitorCog, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { haptic } from "@/lib/haptics";
import { usePcSpecs } from "@/lib/preferences/pc";
import { cn } from "@/lib/utils/cn";
import type { GameDetail, GamePcInfo, HardwareVerdictKind, PcRequirementTier, PcRequirements } from "@/lib/games/types";
import { Disclosure } from "./Disclosure";
import { pcUrl, useEndpoint, type GameIds } from "./endpoint";
import { useInsightPart, usePagePart } from "./live";
import { InfoTip } from "./InfoTip";
import { AchievementsCard, DeckLinuxCard } from "./StatsSection";

// Only needed once someone taps "Check my PC": kept out of the page's first load.
const MyPcSheet = dynamic(() => import("@/components/pc/MyPcSheet").then((mod) => mod.MyPcSheet), { ssr: false });
// Client-only by nature (specs live on the device); keeps the hardware tables out of the server render.
// Features and accessibility come from the page's lazily-loaded extras; client-only.
const PcFeatures = dynamic(() => import("./PcFeatures"), { ssr: false });
const HardwareVerdictView = dynamic(() => import("./HardwareVerdict").then((mod) => mod.HardwareVerdictView), {
  ssr: false,
  loading: () => <Skeleton className="mt-3 h-8 w-64 max-w-full rounded-full" />,
});

export const VERDICT_CHIP: Record<HardwareVerdictKind, { label: string; icon: ReactNode; className: string }> = {
  great: { label: "Runs great", icon: <Sparkles size={14} />, className: "border-mint/30 bg-mint/12 text-mint" },
  ok: { label: "Should run", icon: <CircleCheck size={14} />, className: "border-gold/30 bg-gold/12 text-gold" },
  below: { label: "Below minimum", icon: <CircleX size={14} />, className: "border-flare/30 bg-flare/12 text-flare" },
  unknown: { label: "Can’t tell yet", icon: <CircleHelp size={14} />, className: "border-line bg-fg/[0.05] text-muted" },
};

export function HardwareChip({ kind, className }: { kind: HardwareVerdictKind; className?: string }) {
  const chip = VERDICT_CHIP[kind];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-semibold leading-none", chip.className, className)}>
      <span aria-hidden>{chip.icon}</span>
      {chip.label}
    </span>
  );
}

export function PcSection({ ids, rawRequirements }: { ids: GameIds; rawRequirements: GameDetail["requirements"] }) {
  // The page's insights answer carries this; elsewhere it's its own request.
  const fromPage = useInsightPart(ids, "pc");
  const own = useEndpoint<GamePcInfo>(!fromPage && ids.steam ? pcUrl(ids) : null);
  const pc = fromPage ?? own;
  const antiCheatPart = usePagePart("antiCheat");
  const antiCheat = antiCheatPart?.status === "ready" ? antiCheatPart.data : null;
  const data = pc.status === "ready" ? pc.data : null;
  const requirements = data?.requirements ?? null;
  const rawPc = rawRequirements.find((req) => /pc|windows/i.test(req.platform)) ?? rawRequirements[0] ?? null;

  if (pc.status === "loading" && ids.steam) {
    return (
      <div aria-hidden className="space-y-4">
        <Skeleton className="h-[180px] w-full rounded-3xl" />
        <Skeleton className="h-[140px] w-full rounded-3xl" />
      </div>
    );
  }

  const hasRun = Boolean(requirements?.minimum || requirements?.recommended || rawPc);
  const hasCompat = Boolean(data?.deck || data?.proton || antiCheat);
  if (!hasRun && !hasCompat && !data?.achievements) {
    return (
      <div className="space-y-4">
        <p className="glass rounded-3xl p-5 text-[15px] text-muted sm:p-6">
          Steam hasn&rsquo;t published PC requirements, Steam Deck or Linux ratings for this game yet.
        </p>
        <PcFeatures />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasRun && <WillItRun requirements={requirements} raw={rawPc} />}
      {(hasCompat || data?.achievements) && (
        <div className={cn("grid gap-4", hasCompat && data?.achievements && "md:grid-cols-2")}>
          {hasCompat && <DeckLinuxCard deck={data?.deck ?? null} proton={data?.proton ?? null} antiCheat={antiCheat} />}
          {data?.achievements && <AchievementsCard stats={data.achievements} />}
        </div>
      )}
      <PcFeatures />
    </div>
  );
}

function WillItRun({ requirements, raw }: { requirements: PcRequirements | null; raw: GameDetail["requirements"][number] | null }) {
  const [specs] = usePcSpecs();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const parsed = Boolean(requirements && (requirements.minimum || requirements.recommended));

  const openSheet = () => {
    haptic("selection");
    setMounted(true);
    setOpen(true);
  };

  return (
    <div className="glass overflow-hidden rounded-3xl">
      <div className="relative isolate p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-[17px] font-semibold text-text">
              Will it run on your PC? <InfoTip topic="willItRun" />
            </h3>
            {specs && parsed ? null : (
              <p className="mt-1 max-w-xl text-[15px] leading-snug text-muted">
                {parsed
                  ? "Tell us about your PC once — we can detect most of it — and every PC game page will answer this."
                  : "Steam’s requirements for this game couldn’t be read automatically — the full list is below."}
              </p>
            )}
          </div>
          {parsed && (
            <button
              type="button"
              onClick={openSheet}
              className={cn(
                "press inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-5 text-[14px] font-semibold transition-colors",
                specs
                  ? "border border-line bg-fg/[0.05] text-text fine:hover:bg-fg/[0.1]"
                  : "bg-[var(--game-accent,var(--color-brand))] text-[var(--game-on-accent,#fff)] shadow-[0_10px_30px_-12px_var(--game-glow)]",
              )}
            >
              <MonitorCog size={16} aria-hidden />
              {specs ? "Edit my PC" : "Check my PC"}
            </button>
          )}
        </div>

        {specs && parsed && requirements && <HardwareVerdictView specs={specs} requirements={requirements} onRefine={openSheet} />}
      </div>

      {(parsed || raw) && (
        <div className="border-t border-line">
          <Disclosure
            bare
            className="px-5 sm:px-6"
            icon={<Cpu size={17} />}
            title="Minimum and recommended specs"
            subtitle="From Steam"
          >
            <div className="pb-5">{parsed && requirements ? <SpecTable requirements={requirements} /> : raw ? <RawSpecs raw={raw} /> : null}</div>
          </Disclosure>
        </div>
      )}

      {mounted && <MyPcSheet open={open} onClose={() => setOpen(false)} />}
    </div>
  );
}

const SPEC_ROWS: Array<{ label: string; value: (tier: PcRequirementTier) => string | null }> = [
  { label: "Graphics", value: (tier) => tier.gpu },
  { label: "Processor", value: (tier) => tier.cpu },
  { label: "Memory", value: (tier) => (tier.ramGb ? `${tier.ramGb} GB` : null) },
  { label: "Video memory", value: (tier) => (tier.vramGb ? `${tier.vramGb} GB` : null) },
  { label: "Storage", value: (tier) => (tier.storageGb ? `${tier.storageGb} GB` : null) },
  { label: "System", value: (tier) => tier.os },
];

function SpecTable({ requirements }: { requirements: PcRequirements }) {
  const tiers = [
    requirements.minimum ? { label: "Minimum", tier: requirements.minimum } : null,
    requirements.recommended ? { label: "Recommended", tier: requirements.recommended } : null,
  ].filter((entry): entry is { label: string; tier: PcRequirementTier } => entry !== null);
  const rows = SPEC_ROWS.filter((row) => tiers.some(({ tier }) => row.value(tier)));

  const columns = { ["--tiers" as string]: tiers.length };
  const grid = "sm:grid-cols-[8rem_repeat(var(--tiers),minmax(0,1fr))]";

  return (
    <div>
      {/* Column heads for wide screens; phones label each value inline instead. */}
      <div aria-hidden className={cn("hidden gap-4 border-b border-line pb-2 sm:grid", grid)} style={columns}>
        <span />
        {tiers.map(({ label }) => (
          <span key={label} className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
            {label}
          </span>
        ))}
      </div>
      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.label} className={cn("grid gap-1.5 py-3 sm:gap-4", grid)} style={columns}>
            <dt className="text-[12px] font-semibold text-faint sm:pt-0.5">{row.label}</dt>
            {tiers.map(({ label, tier }) => (
              <dd key={label} className="min-w-0 text-[14px] leading-snug text-text">
                <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint sm:sr-only">{label}</span>
                {row.value(tier) ?? <span className="text-faint">—</span>}
              </dd>
            ))}
          </div>
        ))}
      </dl>
    </div>
  );
}

function RawSpecs({ raw }: { raw: GameDetail["requirements"][number] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {raw.minimum && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">Minimum</p>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{raw.minimum}</p>
        </div>
      )}
      {raw.recommended && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">Recommended</p>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{raw.recommended}</p>
        </div>
      )}
    </div>
  );
}
