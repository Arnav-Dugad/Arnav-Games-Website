/**
 * Steam's `pc_requirements` HTML → comparable fields (`PcRequirements`).
 * Pure and client-safe; kept apart from `hardware.ts` so the server, which
 * only parses, doesn't carry the GPU/CPU tables.
 *
 * Steam renders requirements as `<li><strong>Label:</strong> value</li>`
 * (older pages: `Label: value<br>`). Only what is written is extracted:
 * quantities are read from the text ("12 GB RAM", "512 MB"), never inferred,
 * and the cleaned original is kept in `raw` for display.
 */

import type { PcRequirementTier, PcRequirements } from "./types";

/** Quantities in a requirement line → GB. */
function sizesGb(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(tb|gb|mb|go|mo)\b/gi)) {
    const value = Number(m[1].replace(",", "."));
    const unit = m[2].toLowerCase();
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push(unit === "tb" ? value * 1024 : unit === "mb" || unit === "mo" ? value / 1024 : value);
  }
  return out;
}

const roundGb = (gb: number) => (gb >= 1 ? Math.round(gb * 10) / 10 : Math.round(gb * 100) / 100);

const stripTags = (html: string) =>
  html
    .replace(/<br\s*\/?>|<\/li>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[®™]/g, "");

/** One tier of Steam's `pc_requirements` HTML → comparable fields, or null when empty. */
export function parseRequirementTier(html: string | null | undefined): PcRequirementTier | null {
  if (!html || typeof html !== "string") return null;
  const lines = stripTags(html)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !/^(minimum|recommended)\s*:?$/i.test(line))
    // "Additional Notes:" with nothing after it is template residue.
    .filter((line) => !/^[^:]{1,30}:\s*$/.test(line));
  if (lines.length === 0) return null;

  const fields = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(/^([A-Za-z][A-Za-z /]{1,30}?)\s*\*?:\s*(.+)$/);
    if (m) fields.set(m[1].toLowerCase().trim(), m[2].trim());
  }
  const pick = (...names: string[]) => {
    for (const name of names) {
      const value = fields.get(name);
      if (value) return value;
    }
    return null;
  };

  const cpu = pick("processor", "cpu");
  const gpu = pick("graphics", "video card", "video", "graphics card", "gpu");
  const memory = pick("memory", "ram", "system memory");
  const storage = pick("storage", "hard drive", "hard disk space", "hard disk", "disk space", "hdd");
  const os = pick("os", "operating system", "os version");

  const ram = memory ? sizesGb(memory)[0] : undefined;
  // VRAM: "GTX 1060 3 GB or RX 580 4 GB" — either card qualifies, so the
  // smaller figure is the requirement. Absurd values are model numbers.
  const vram = gpu ? sizesGb(gpu).filter((gb) => gb <= 48) : [];
  const disk = storage ? sizesGb(storage)[0] : undefined;

  return {
    cpu,
    gpu,
    ramGb: ram ? roundGb(ram) : null,
    vramGb: vram.length ? roundGb(Math.min(...vram)) : null,
    storageGb: disk ? Math.round(disk) : null,
    os,
    raw: lines.join("\n").slice(0, 1500),
  };
}

/** Steam's `pc_requirements` (an object, or `[]` when the store page has none). */
export function parsePcRequirements(value: unknown): PcRequirements | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { minimum?: unknown; recommended?: unknown };
  const minimum = parseRequirementTier(typeof record.minimum === "string" ? record.minimum : null);
  const recommended = parseRequirementTier(typeof record.recommended === "string" ? record.recommended : null);
  return minimum || recommended ? { minimum, recommended } : null;
}
