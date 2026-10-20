"use client";

/**
 * "My PC": the reader's parts, screen and goals, entered once (see
 * `usePcSpecs`; mirrored to the account when signed in). Used by "Will it
 * run?" on game pages and the compare table; Settings opens the same sheet.
 *
 * It starts by asking the browser what it can tell (`detectPc`) and shows
 * that as "We detected… Is this right?" — one tap fills it in, "Not right"
 * dismisses it. Detection is approximate and never saved on its own.
 *
 * The part fields are free text with suggestions, not closed pickers: people
 * know their card as "3060" or "RX 580", and `matchGpu`/`matchCpu` understand
 * those. Under each field a line says what we recognised, so a typo is caught
 * here rather than producing a confusing verdict later. Everything beyond
 * the three parts is optional and tucked under "More about your PC".
 */

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Cpu, Gamepad2, Laptop, Monitor, MonitorCog, ScanSearch, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import {
  CPU_SUGGESTIONS,
  GPU_SUGGESTIONS,
  RES_LABEL,
  STORAGE_LABEL,
  matchCpu,
  matchGpu,
  typicalVram,
  type HardwareMatch,
} from "@/lib/games/hardware";
import { detectPc, type DetectedPc } from "@/lib/games/pc-detect";
import type { PcFormFactor, PcGoal, PcOs, PcResolution, PcStorageKind, UserPcSpecs } from "@/lib/games/types";
import { haptic } from "@/lib/haptics";
import { usePcSpecs } from "@/lib/preferences/pc";
import { cn } from "@/lib/utils/cn";

const RAM_OPTIONS = [4, 8, 12, 16, 24, 32, 64];
const VRAM_OPTIONS = [2, 4, 6, 8, 10, 12, 16, 20, 24];
const FREE_OPTIONS = [25, 50, 100, 250, 500, 1000];
const OS_LABEL: Record<PcOs, string> = { windows: "Windows", macos: "macOS", linux: "Linux", steamos: "SteamOS" };
const FORM_LABEL: Record<PcFormFactor, string> = { desktop: "Desktop", laptop: "Laptop", handheld: "Handheld" };

/** "What do you want from games?" — plain presets over the three goal dials. */
const GOALS: Array<{ label: string; goal: PcGoal }> = [
  { label: "Just run it", goal: { resolution: "720p", fps: 30, quality: "low" } },
  { label: "Smooth 1080p", goal: { resolution: "1080p", fps: 60, quality: "medium" } },
  { label: "1080p High", goal: { resolution: "1080p", fps: 60, quality: "high" } },
  { label: "High refresh", goal: { resolution: "1080p", fps: 120, quality: "high" } },
  { label: "1440p High", goal: { resolution: "1440p", fps: 60, quality: "high" } },
  { label: "Max 1440p", goal: { resolution: "1440p", fps: 60, quality: "max" } },
  { label: "4K High", goal: { resolution: "4k", fps: 60, quality: "high" } },
];

const sameGoal = (a?: PcGoal, b?: PcGoal) => Boolean(a && b && a.resolution === b.resolution && a.fps === b.fps && a.quality === b.quality);

export function MyPcSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="My PC" description="Lets every PC game page say how it will run for you.">
      {/* Mounted per opening, so each one starts from the saved specs rather than a half-edited draft. */}
      {open && <MyPcForm onDone={onClose} />}
    </Sheet>
  );
}

function MyPcForm({ onDone }: { onDone: () => void }) {
  const [specs, setSpecs] = usePcSpecs();
  const [gpu, setGpu] = useState(specs?.gpu ?? "");
  const [cpu, setCpu] = useState(specs?.cpu ?? "");
  const [ram, setRam] = useState<number | null>(specs?.ramGb ?? null);
  const [formFactor, setFormFactor] = useState<PcFormFactor | undefined>(specs?.formFactor);
  const [vram, setVram] = useState<number | undefined>(specs?.vramGb);
  const [storage, setStorage] = useState<PcStorageKind | undefined>(specs?.storage);
  const [free, setFree] = useState<number | undefined>(specs?.freeStorageGb);
  const [os, setOs] = useState<PcOs | undefined>(specs?.os);
  const [display, setDisplay] = useState<UserPcSpecs["display"]>(specs?.display);
  const [goal, setGoal] = useState<PcGoal | undefined>(specs?.goal);
  const [detected, setDetected] = useState<DetectedPc | null>(null);
  const [detection, setDetection] = useState<"pending" | "shown" | "applied" | "dismissed">("pending");
  const [more, setMore] = useState(Boolean(specs?.storage || specs?.os || specs?.display || specs?.freeStorageGb));
  const canSave = Boolean((gpu.trim() || cpu.trim()) && ram);
  const laptop = formFactor === "laptop";
  const gpuMatch = gpu.trim() ? matchGpu(gpu, { laptop }) : null;
  const typical = gpu.trim() ? typicalVram(gpu, { laptop }) : null;

  // Ask the browser once per opening. Nothing is applied until the reader says so.
  useEffect(() => {
    let live = true;
    void detectPc().then((found) => {
      if (!live) return;
      setDetected(found);
      setDetection(found.gpu || found.display || found.os ? "shown" : "dismissed");
    });
    return () => {
      live = false;
    };
  }, []);

  const applyDetected = () => {
    if (!detected) return;
    haptic("success");
    if (detected.gpu) setGpu(detected.gpu.name);
    if (detected.formFactor) setFormFactor(detected.formFactor);
    if (detected.display) setDisplay({ resolution: detected.display.resolution, ...(detected.display.refreshHz ? { refreshHz: detected.display.refreshHz } : {}) });
    if (detected.os) setOs(detected.os);
    if (detected.memoryGb && detected.memoryGb < 8 && !ram) setRam(detected.memoryGb);
    if (detected.display || detected.os) setMore(true);
    setDetection("applied");
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave || !ram) return;
        const next: UserPcSpecs = { gpu: gpu.trim(), cpu: cpu.trim(), ramGb: ram };
        if (formFactor) next.formFactor = formFactor;
        if (vram) next.vramGb = vram;
        if (storage) next.storage = storage;
        if (free) next.freeStorageGb = free;
        if (os) next.os = os;
        if (display) next.display = display;
        if (goal) next.goal = goal;
        setSpecs(next);
        haptic("success");
        onDone();
      }}
    >
      {detection === "shown" && detected && (
        <DetectedCard detected={detected} onUse={applyDetected} onDismiss={() => setDetection("dismissed")} />
      )}
      {detection === "applied" && (
        <p className="flex items-center gap-2 rounded-2xl bg-mint/10 px-4 py-3 text-[13px] text-text" aria-live="polite">
          <Check size={15} className="shrink-0 text-mint" aria-hidden />
          Filled in from this device. Check it below.
        </p>
      )}

      <Choices
        label="Kind of PC"
        value={formFactor}
        onChange={setFormFactor}
        options={(["desktop", "laptop", "handheld"] as const).map((value) => ({
          value,
          label: FORM_LABEL[value],
          icon: value === "desktop" ? <Monitor size={15} /> : value === "laptop" ? <Laptop size={15} /> : <Gamepad2 size={15} />,
        }))}
      />

      <div>
        <PartField
          label="Graphics card"
          icon={<MonitorCog size={15} />}
          value={gpu}
          onChange={setGpu}
          suggestions={GPU_SUGGESTIONS}
          match={(text) => matchGpu(text, { laptop })}
          placeholder="e.g. RTX 4060 Laptop, RX 6700 XT"
        />
        {gpuMatch && (
          <Choices
            className="mt-3"
            label="Video memory"
            hint={typical ? `${typical} GB is typical for this card` : undefined}
            value={vram}
            onChange={setVram}
            options={VRAM_OPTIONS.map((gb) => ({ value: gb, label: `${gb} GB`, marked: gb === typical }))}
            small
          />
        )}
      </div>

      <PartField
        label="Processor"
        icon={<Cpu size={15} />}
        value={cpu}
        onChange={setCpu}
        suggestions={CPU_SUGGESTIONS}
        match={matchCpu}
        placeholder="e.g. Ryzen 5 7600, i7-13700H"
        hint={detected?.threads ? `Your browser sees ${detected.threads} threads` : undefined}
      />

      <Choices
        label="Memory (RAM)"
        hint={detected?.memoryGb === 8 ? "Your browser reports at least 8 GB" : undefined}
        value={ram ?? undefined}
        onChange={(value) => setRam(value ?? null)}
        options={RAM_OPTIONS.map((gb) => ({ value: gb, label: `${gb} GB` }))}
        required
      />

      <Choices
        label="What you want"
        value={goal ? GOALS.findIndex((preset) => sameGoal(preset.goal, goal)) : undefined}
        onChange={(index) => setGoal(index === undefined ? undefined : GOALS[index]?.goal)}
        options={GOALS.map((preset, index) => ({ value: index, label: preset.label }))}
      />

      <div className="rounded-2xl border border-line">
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((value) => !value)}
          className="press flex min-h-12 w-full items-center gap-3 px-4 text-left"
        >
          <span className="flex-1">
            <span className="block text-[15px] font-semibold text-text">More about your PC</span>
            <span className="block text-[12px] text-muted">
              {[display ? `${RES_LABEL[display.resolution]}${display.refreshHz ? ` · ${display.refreshHz} Hz` : ""}` : null, os ? OS_LABEL[os] : null, storage ? STORAGE_LABEL[storage] : null]
                .filter(Boolean)
                .join(" · ") || "Screen, storage and system"}
            </span>
          </span>
          <ChevronDown size={17} aria-hidden className={cn("text-faint transition-transform", more && "rotate-180")} />
        </button>
        {more && (
          <div className="space-y-5 border-t border-line px-4 pb-5 pt-4">
            <Choices
              label="Screen"
              value={display?.resolution}
              onChange={(resolution) => setDisplay(resolution ? { ...display, resolution } : undefined)}
              options={(["720p", "1080p", "1440p", "4k"] as const).map((value) => ({ value, label: RES_LABEL[value as PcResolution] }))}
              small
            />
            {display && (
              <Choices
                label="Refresh rate"
                value={display.refreshHz}
                onChange={(refreshHz) => setDisplay({ resolution: display.resolution, ...(refreshHz ? { refreshHz } : {}) })}
                options={[60, 75, 120, 144, 165, 240].map((hz) => ({ value: hz, label: `${hz} Hz` }))}
                small
              />
            )}
            <Choices
              label="Game drive"
              value={storage}
              onChange={setStorage}
              options={(["nvme", "sata-ssd", "hdd"] as const).map((value) => ({ value, label: STORAGE_LABEL[value] }))}
              small
            />
            <Choices
              label="Free space"
              value={free}
              onChange={setFree}
              options={FREE_OPTIONS.map((gb) => ({ value: gb, label: gb >= 1000 ? "1 TB+" : `${gb} GB` }))}
              small
            />
            <Choices
              label="System"
              value={os}
              onChange={setOs}
              options={(["windows", "macos", "linux", "steamos"] as const).map((value) => ({ value, label: OS_LABEL[value] }))}
              small
            />
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        {specs && (
          <button
            type="button"
            onClick={() => {
              setSpecs(null);
              haptic("light");
              onDone();
            }}
            className="press inline-flex min-h-12 items-center justify-center rounded-full px-5 text-[15px] font-semibold text-flare fine:hover:bg-flare/10"
          >
            Forget my PC
          </button>
        )}
        <button
          type="submit"
          disabled={!canSave}
          className="press inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand px-6 text-[15px] font-semibold text-white transition-opacity disabled:opacity-45"
        >
          <Check size={16} /> Save
        </button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function DetectedCard({ detected, onUse, onDismiss }: { detected: DetectedPc; onUse: () => void; onDismiss: () => void }) {
  const rows = [
    detected.gpu ? { label: "Graphics", value: detected.gpu.name } : detected.gpuText ? { label: "Graphics", value: `${detected.gpuText} (not recognised)` } : null,
    detected.formFactor ? { label: "Kind", value: FORM_LABEL[detected.formFactor] } : null,
    detected.display
      ? { label: "Screen", value: `${detected.display.width} × ${detected.display.height}${detected.display.refreshHz ? ` · ${detected.display.refreshHz} Hz` : ""}` }
      : null,
    detected.os ? { label: "System", value: OS_LABEL[detected.os] } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);

  return (
    <section aria-labelledby="pc-detected" className="rounded-2xl border border-brand/30 bg-brand/[0.07] p-4">
      <div className="flex items-start gap-3">
        <ScanSearch size={18} aria-hidden className="mt-0.5 shrink-0 text-brand-soft" />
        <div className="min-w-0 flex-1">
          <h3 id="pc-detected" className="text-[15px] font-semibold text-text">We detected this. Is it right?</h3>
          <dl className="mt-2 space-y-1">
            {rows.map((row) => (
              <div key={row.label} className="flex gap-2 text-[13px]">
                <dt className="w-16 shrink-0 text-faint">{row.label}</dt>
                <dd className="min-w-0 break-words font-medium text-text">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[12px] text-muted">Browsers only give hints — a laptop may report its built-in graphics.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onUse} className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand px-4 text-[14px] font-semibold text-white">
              <Check size={15} aria-hidden /> Use these
            </button>
            <button type="button" onClick={onDismiss} className="press inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold text-text fine:hover:bg-fg/[0.06]">
              <X size={15} aria-hidden /> Not right
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A single-choice chip group. Tapping the chosen chip again clears an optional choice. */
function Choices<T extends string | number>({
  label,
  hint,
  value,
  onChange,
  options,
  required = false,
  small = false,
  className,
}: {
  label: string;
  hint?: string;
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode; marked?: boolean }>;
  required?: boolean;
  small?: boolean;
  className?: string;
}) {
  return (
    <fieldset className={className}>
      <legend className="flex w-full items-baseline justify-between gap-3 text-[13px] font-semibold text-text">
        {label}
        {hint && <span className="text-[12px] font-normal text-muted">{hint}</span>}
      </legend>
      <div role="radiogroup" aria-label={label} className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => {
                haptic("selection");
                onChange(checked && !required ? undefined : option.value);
              }}
              className={cn(
                "press inline-flex items-center gap-1.5 rounded-full border px-3.5 font-semibold tabular-nums transition-colors",
                small ? "min-h-10 text-[13px] coarse:min-h-11" : "min-h-11 text-[14px]",
                checked
                  ? "border-transparent bg-brand text-white"
                  : option.marked
                    ? "border-dashed border-brand/60 bg-fg/[0.04] text-text"
                    : "border-line bg-fg/[0.04] text-text fine:hover:border-line-strong",
              )}
            >
              {option.icon && <span aria-hidden>{option.icon}</span>}
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Words, lowercased: "RTX 3060" finds "NVIDIA GeForce RTX 3060" whatever the order. */
function suggest(list: string[], query: string): string[] {
  const words = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return [];
  return list
    .filter((item) => {
      const hay = item.toLowerCase().replace(/-/g, " ");
      return words.every((word) => hay.includes(word));
    })
    .slice(0, 6);
}

function PartField({
  label,
  icon,
  value,
  onChange,
  suggestions,
  match,
  placeholder,
  hint,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  match: (text: string) => HardwareMatch | null;
  placeholder: string;
  hint?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const options = focused ? suggest(suggestions, value).filter((option) => option !== value) : [];
  const recognised = value.trim() ? match(value) : null;

  const choose = (option: string) => {
    haptic("selection");
    onChange(option);
    setHighlight(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (options.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => (current + delta + options.length) % options.length);
    } else if (event.key === "Enter" && highlight >= 0) {
      event.preventDefault();
      choose(options[highlight]);
    } else if (event.key === "Escape") {
      setFocused(false);
    }
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <span aria-hidden className="text-faint">{icon}</span>
          {label}
        </label>
        {hint && <span className="text-[12px] text-muted">{hint}</span>}
      </div>
      <input
        id={id}
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setHighlight(-1);
        }}
        onFocus={() => setFocused(true)}
        // Close a beat later: removing the list on blur shifts everything
        // below it, so the tap that caused the blur would land on whatever
        // slid under the finger instead of what was aimed at.
        onBlur={() => window.setTimeout(() => setFocused(false), 180)}
        onKeyDown={onKeyDown}
        className="mt-2 block min-h-12 w-full rounded-xl border border-line bg-fg/[0.04] px-4 text-[16px] text-text placeholder:text-faint focus:border-line-strong focus:outline-none"
      />
      {/* In flow rather than floating: inside a scrolling sheet a dropdown would be clipped. */}
      <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className={cn(options.length > 0 && "mt-1.5 overflow-hidden rounded-xl border border-line")}>
        {options.map((option, index) => (
          <li
            key={option}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === highlight}
            // Keep focus in the input so the list doesn't close before the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
            className={cn("flex min-h-11 cursor-pointer items-center px-4 text-[14px] text-text", index === highlight ? "bg-fg/[0.08]" : "fine:hover:bg-fg/[0.05]")}
          >
            {option}
          </li>
        ))}
      </ul>
      <p className={cn("mt-1.5 min-h-[18px] text-[12px]", recognised ? "text-mint" : "text-faint")} aria-live="polite">
        {value.trim()
          ? recognised
            ? `Recognised: ${recognised.name}`
            : options.length > 0
              ? "Pick yours from the list for the best match."
              : "Not recognised — we’ll compare what we can."
          : null}
      </p>
    </div>
  );
}
