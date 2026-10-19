"use client";

/**
 * "My PC": the reader's graphics card, processor and memory, entered once and
 * kept on this device (see `usePcSpecs`). Used by "Will it run?" on game
 * pages and the compare table; Settings reuses this sheet as-is.
 *
 * The part fields are free text with suggestions, not closed pickers: people
 * know their card as "3060" or "RX 580", and `matchGpu`/`matchCpu` understand
 * those. Under each field a line says what we recognised, so a typo is caught
 * here rather than producing a confusing verdict later. The graphics card can
 * be read from the browser (WebGL's renderer string) — offered, never
 * assumed, since a laptop may report its integrated chip. Memory can't be
 * read honestly (browsers cap `deviceMemory` at 8 GB), so it's a choice.
 */

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Check, Cpu, MonitorCog, ScanSearch } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { CPU_SUGGESTIONS, GPU_SUGGESTIONS, matchCpu, matchGpu, type HardwareMatch } from "@/lib/games/hardware";
import { haptic } from "@/lib/haptics";
import { usePcSpecs } from "@/lib/preferences/pc";
import { cn } from "@/lib/utils/cn";

const RAM_OPTIONS = [4, 8, 12, 16, 24, 32, 64];

export function MyPcSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="My PC" description="Saved on this device only. Used to check whether games will run.">
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
  const canSave = Boolean((gpu.trim() || cpu.trim()) && ram);

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave || !ram) return;
        setSpecs({ gpu: gpu.trim(), cpu: cpu.trim(), ramGb: ram });
        haptic("success");
        onDone();
      }}
    >
      <PartField
        label="Graphics card"
        icon={<MonitorCog size={15} />}
        value={gpu}
        onChange={setGpu}
        suggestions={GPU_SUGGESTIONS}
        match={matchGpu}
        placeholder="e.g. RTX 3060, RX 580"
        detect
      />
      <PartField
        label="Processor"
        icon={<Cpu size={15} />}
        value={cpu}
        onChange={setCpu}
        suggestions={CPU_SUGGESTIONS}
        match={matchCpu}
        placeholder="e.g. Ryzen 5 3600, i5-12400F"
      />

      <fieldset>
        <legend className="text-[13px] font-semibold text-text">Memory (RAM)</legend>
        <div role="radiogroup" aria-label="Memory" className="mt-2 flex flex-wrap gap-2">
          {RAM_OPTIONS.map((gb) => (
            <button
              key={gb}
              type="button"
              role="radio"
              aria-checked={ram === gb}
              onClick={() => {
                haptic("selection");
                setRam(gb);
              }}
              className={cn(
                "press min-h-11 min-w-[3.75rem] rounded-full border px-3.5 text-[14px] font-semibold tabular-nums transition-colors",
                ram === gb ? "border-transparent bg-brand text-white" : "border-line bg-fg/[0.04] text-text fine:hover:border-line-strong",
              )}
            >
              {gb} GB
            </button>
          ))}
        </div>
      </fieldset>

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

/** Words, lowercased: "RTX 3060" finds "NVIDIA GeForce RTX 3060" whatever the order. */
function suggest(list: string[], query: string): string[] {
  const words = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return [];
  return list.filter((item) => {
    const hay = item.toLowerCase().replace(/-/g, " ");
    return words.every((word) => hay.includes(word));
  }).slice(0, 6);
}

/** The browser's own GPU name, when WebGL will tell us. */
function detectGpu(): string | null {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 …)" → the card's name.
    const inner = /ANGLE \([^,]*,\s*([^,(]+)/.exec(raw)?.[1] ?? raw;
    return matchGpu(inner)?.name ?? null;
  } catch {
    return null;
  }
}

function PartField({
  label,
  icon,
  value,
  onChange,
  suggestions,
  match,
  placeholder,
  detect = false,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  match: (text: string) => HardwareMatch | null;
  placeholder: string;
  detect?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [detectable, setDetectable] = useState(false);
  const options = focused ? suggest(suggestions, value).filter((option) => option !== value) : [];
  const recognised = value.trim() ? match(value) : null;

  // WebGL is checked after mount (and only offered when it would answer).
  useEffect(() => {
    if (!detect) return;
    const frame = requestAnimationFrame(() => setDetectable(Boolean(detectGpu())));
    return () => cancelAnimationFrame(frame);
  }, [detect]);

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
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <span aria-hidden className="text-faint">{icon}</span>
          {label}
        </label>
        {detect && detectable && (
          <button
            type="button"
            onClick={() => {
              const found = detectGpu();
              if (found) choose(found);
            }}
            className="press inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold text-brand-soft fine:hover:bg-fg/[0.06] coarse:min-h-11"
          >
            <ScanSearch size={14} /> Detect
          </button>
        )}
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
        onBlur={() => setFocused(false)}
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
            className={cn(
              "flex min-h-11 cursor-pointer items-center px-4 text-[14px] text-text",
              index === highlight ? "bg-fg/[0.08]" : "fine:hover:bg-fg/[0.05]",
            )}
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
