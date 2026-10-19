"use client";

/**
 * PC features and accessibility, from PCGamingWiki: can I read it, hear it,
 * play it my way, and will it fill my screen?
 *
 * Every chip is one of three states the wiki states outright — yes, limited
 * (or only with a community tweak), no. Features the article leaves blank
 * or marks "unknown" aren't drawn at all: no chip is better than a guessed
 * one. Loaded with the page's extras, once the section is near.
 */

import { ArrowUpRight, Check, Minus, X } from "lucide-react";
import { useNearId } from "@/hooks";
import { PCGW_ACCESSIBILITY, PCGW_LABELS } from "@/lib/games/external-rules";
import { cn } from "@/lib/utils/cn";
import type { PcgwFeatureKey, PcgwFeatures, PcgwSupport } from "@/lib/games/types";
import { useGameExtras } from "./live";

/** Display and performance, in the order a PC player scans for them. */
const DISPLAY: PcgwFeatureKey[] = ["ultrawide", "4k", "hdr", "fps120", "rayTracing", "upscaling", "frameGen", "borderless"];
/** Accessibility, plus plain controller support when "full" support isn't stated. */
const ACCESS: PcgwFeatureKey[] = [...PCGW_ACCESSIBILITY, "controller", "playstationControllers"];

type Level = "yes" | "limited" | "no";

function level(value: PcgwSupport | undefined): Level | null {
  if (value === "true" || value === "always on") return "yes";
  if (value === "limited" || value === "hackable") return "limited";
  if (value === "false") return "no";
  return null;
}

const LEVEL_TEXT: Record<Level, string> = { yes: "Yes", limited: "Limited", no: "No" };

interface ChipData {
  key: string;
  label: string;
  level: Level;
  note?: string;
}

function chipsFor(features: PcgwFeatures, keys: PcgwFeatureKey[]): ChipData[] {
  const chips: ChipData[] = [];
  for (const key of keys) {
    // "Controller support" only when the stronger "Full controller support" says nothing.
    if (key === "controller" && features.values.fullController) continue;
    if (key === "upscaling" && features.upscaling.length > 0) {
      chips.push({ key, label: features.upscaling.join(", "), level: "yes" });
      continue;
    }
    const value = features.values[key];
    const state = level(value);
    if (!state) continue;
    chips.push({ key, label: PCGW_LABELS[key], level: state, note: value === "hackable" ? "with a tweak" : value === "limited" ? "limited" : undefined });
  }
  return chips;
}

export default function PcFeatures() {
  const near = useNearId("pc");
  const extras = useGameExtras(near);
  const features = extras?.status === "ready" ? extras.data.pcgw : null;
  if (!features) return null;

  const access = chipsFor(features, ACCESS);
  const display = chipsFor(features, DISPLAY);
  if (access.length === 0 && display.length === 0) return null;

  return (
    <div className="glass rounded-3xl p-5 sm:p-6">
      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        {access.length > 0 && <Group title="Accessibility" chips={access} />}
        {display.length > 0 && <Group title="Display and performance" chips={display} />}
      </div>
      <a
        href={features.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-flex min-h-10 items-center gap-1 text-[13px] font-medium text-muted transition-colors fine:hover:text-text"
      >
        PCGamingWiki
        <ArrowUpRight size={13} aria-hidden />
      </a>
    </div>
  );
}

function Group({ title, chips }: { title: string; chips: ChipData[] }) {
  return (
    <div>
      <h3 className="text-[17px] font-semibold text-text">{title}</h3>
      <ul className="mt-3 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li
            key={chip.key}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium",
              chip.level === "yes" && "bg-mint/12 text-text",
              chip.level === "limited" && "bg-gold/12 text-text",
              chip.level === "no" && "bg-fg/[0.04] text-faint",
            )}
          >
            <span aria-hidden className={cn("shrink-0", chip.level === "yes" ? "text-mint" : chip.level === "limited" ? "text-gold" : "text-faint")}>
              {chip.level === "yes" ? <Check size={14} strokeWidth={2.5} /> : chip.level === "limited" ? <Minus size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
            </span>
            <span className={cn(chip.level === "no" && "line-through decoration-fg/30")}>{chip.label}</span>
            {chip.note && <span className="text-[12px] text-muted">{chip.note}</span>}
            <span className="sr-only">: {LEVEL_TEXT[chip.level]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
