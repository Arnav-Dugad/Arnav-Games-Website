/**
 * "Will it run?" — pure and client-safe (no network, no Next imports), so
 * the comparison can run on the reader's device against specs they keep
 * locally, and `scripts/check-providers.ts` can pin the rules down.
 *
 * Three parts:
 *
 *  1. `parsePcRequirements` turns Steam's `pc_requirements` HTML into
 *     comparable fields, keeping the original text in `raw`.
 *  2. `matchGpu` / `matchCpu` map free text ("NVIDIA GEFORCE GTX 1060 3 GB",
 *     "Intel I5 4690", "AMD r5 3600") to a model family and a performance
 *     score.
 *  3. `evaluateHardware` compares the reader's PC with both tiers.
 *
 * The scores are ESTIMATES, documented as such wherever they surface:
 *
 *  - GPU score ≈ 3DMark Time Spy graphics score ÷ 100 for current-ish cards
 *    (GTX 1060 ≈ 40, RTX 3060 ≈ 87); pre-DX12 cards and integrated graphics
 *    are placed by relative rasterisation performance on the same scale.
 *  - CPU score ≈ PassMark CPU Mark ÷ 1000 for a representative desktop part
 *    of the family (i5-8400 ≈ 9, Ryzen 5 3600 ≈ 18); mobile suffixes scale it
 *    down. Intel Core i is modelled per tier × generation and Ryzen per tier ×
 *    series, so an unlisted model in a known family still gets a fair figure.
 *
 * They only need to rank parts plausibly — "is mine at least as fast as the
 * slowest card this publisher says is enough" — not benchmark them.
 */

import type { HardwareVerdict, PcRequirementTier, PcRequirements, UserPcSpecs } from "./types";

export interface HardwareMatch {
  /** Canonical display name, e.g. "NVIDIA GeForce RTX 3060 Ti". */
  name: string;
  /** Relative performance estimate (see the module comment for units). */
  score: number;
}

/* ---------------------------------------------------------------------------
 * GPU table — keys are canonical lowercase model ids.
 * ------------------------------------------------------------------------ */

const NVIDIA: Record<string, number> = {
  "geforce 8600": 2, "geforce 8800": 4, "geforce 9600": 3, "geforce 9800": 5,
  "gtx 460": 7, "gtx 550 ti": 6, "gtx 560": 8, "gtx 560 ti": 9, "gtx 570": 11, "gtx 580": 12,
  "gtx 650": 6, "gtx 650 ti": 9, "gtx 660": 12, "gtx 660 ti": 15, "gtx 670": 18, "gtx 680": 20,
  "gtx 750": 12, "gtx 750 ti": 14, "gtx 760": 17, "gtx 770": 21, "gtx 780": 24, "gtx 780 ti": 30,
  "gtx 950": 23, "gtx 960": 26, "gtx 970": 36, "gtx 980": 45, "gtx 980 ti": 56, "gtx titan x": 56,
  "gt 1030": 11, "gtx 1050": 18, "gtx 1050 ti": 24, "gtx 1060": 40, "gtx 1070": 58, "gtx 1070 ti": 67,
  "gtx 1080": 73, "gtx 1080 ti": 95,
  "gtx 1630": 18, "gtx 1650": 35, "gtx 1650 super": 50, "gtx 1660": 54, "gtx 1660 super": 60, "gtx 1660 ti": 63,
  "rtx 2050": 35, "rtx 2060": 76, "rtx 2060 super": 88, "rtx 2070": 90, "rtx 2070 super": 100, "rtx 2080": 110,
  "rtx 2080 super": 116, "rtx 2080 ti": 137,
  "rtx 3050": 62, "rtx 3060": 87, "rtx 3060 ti": 116, "rtx 3070": 135, "rtx 3070 ti": 145, "rtx 3080": 175,
  "rtx 3080 ti": 190, "rtx 3090": 195, "rtx 3090 ti": 215,
  "rtx 4050": 85, "rtx 4060": 106, "rtx 4060 ti": 135, "rtx 4070": 178, "rtx 4070 super": 205, "rtx 4070 ti": 225,
  "rtx 4070 ti super": 240, "rtx 4080": 280, "rtx 4080 super": 285, "rtx 4090": 360,
  "rtx 5050": 95, "rtx 5060": 130, "rtx 5060 ti": 150, "rtx 5070": 220, "rtx 5070 ti": 285, "rtx 5080": 325,
  "rtx 5090": 480,
  "mx 150": 9, "mx 250": 9, "mx 350": 10, "mx 450": 18, "mx 550": 20,
};

const AMD: Record<string, number> = {
  "hd 2600": 1.5, "hd 3650": 2, "hd 3850": 3, "hd 4670": 3, "hd 4850": 5, "hd 4870": 6,
  "hd 5670": 4, "hd 5770": 6, "hd 5850": 8, "hd 5870": 9,
  "hd 6670": 5, "hd 6770": 6, "hd 6850": 9, "hd 6870": 10, "hd 6950": 11, "hd 6970": 12,
  "hd 7750": 8, "hd 7770": 10, "hd 7790": 12, "hd 7850": 15, "hd 7870": 18, "hd 7950": 23, "hd 7970": 27,
  "r7 250": 6, "r7 260": 11, "r7 260x": 12, "r7 265": 15, "r7 370": 16,
  "r9 270": 18, "r9 270x": 19, "r9 280": 23, "r9 280x": 27, "r9 285": 24, "r9 290": 34, "r9 290x": 36,
  "r9 380": 25, "r9 380x": 27, "r9 390": 37, "r9 390x": 39, "r9 fury": 46, "r9 fury x": 49, "r9 nano": 44,
  "rx 460": 19, "rx 470": 37, "rx 480": 41, "rx 550": 13, "rx 560": 21, "rx 570": 39, "rx 580": 43, "rx 590": 47,
  "rx vega 56": 57, "rx vega 64": 64, "radeon vii": 87,
  "rx 5300": 40, "rx 5500 xt": 49, "rx 5600 xt": 75, "rx 5700": 82, "rx 5700 xt": 91,
  "rx 6400": 38, "rx 6500 xt": 45, "rx 6600": 79, "rx 6600 xt": 92, "rx 6650 xt": 97, "rx 6700": 105,
  "rx 6700 xt": 117, "rx 6750 xt": 123, "rx 6800": 155, "rx 6800 xt": 180, "rx 6900 xt": 200, "rx 6950 xt": 215,
  "rx 7600": 107, "rx 7600 xt": 112, "rx 7700 xt": 166, "rx 7800 xt": 196, "rx 7900 gre": 215,
  "rx 7900 xt": 265, "rx 7900 xtx": 295,
  "rx 9060 xt": 150, "rx 9070": 245, "rx 9070 xt": 290,
  // Integrated (APU) graphics.
  "vega 8": 9, "vega 11": 11, "radeon 610m": 6, "radeon 660m": 17, "radeon 680m": 24, "radeon 760m": 22,
  "radeon 780m": 27, "radeon 880m": 30, "radeon 890m": 35,
};

const INTEL: Record<string, number> = {
  "intel hd 2500": 1.5, "intel hd 3000": 1.5, "intel hd 4000": 3, "intel hd 4400": 3.5, "intel hd 4600": 4,
  "intel hd 5000": 4, "intel hd 520": 4, "intel hd 530": 4, "intel hd 620": 5, "intel hd 630": 5,
  "intel uhd 620": 5, "intel uhd 630": 5, "intel uhd 730": 6, "intel uhd 750": 7, "intel uhd 770": 7,
  "intel iris plus": 8, "intel iris xe": 13, "intel arc graphics": 32, "intel arc 130v": 34, "intel arc 140v": 40,
  "arc a310": 30, "arc a380": 37, "arc a580": 85, "arc a750": 105, "arc a770": 115, "arc b570": 125, "arc b580": 140,
};

const OTHER_GPU: Record<string, number> = {
  "steam deck": 16,
  "apple m1": 20, "apple m1 pro": 45, "apple m1 max": 80, "apple m1 ultra": 140,
  "apple m2": 25, "apple m2 pro": 55, "apple m2 max": 95, "apple m2 ultra": 170,
  "apple m3": 30, "apple m3 pro": 60, "apple m3 max": 120,
  "apple m4": 35, "apple m4 pro": 75, "apple m4 max": 140,
  "adreno x1": 18,
};

const GPU_SCORES: Record<string, number> = { ...NVIDIA, ...AMD, ...INTEL, ...OTHER_GPU };

/** Vendor-prefixed display name for a canonical key. */
function gpuDisplayName(key: string): string {
  const words = key
    .split(" ")
    .map((w) => {
      if (w === "ti") return "Ti";
      if (w === "super") return "SUPER";
      if (w === "geforce") return "GeForce";
      if (/^(gtx|rtx|gt|mx|rx|hd|uhd|xt|xtx|gre|vii)$/.test(w) || /^[a-z]\d/.test(w) || /^\d+[a-z]+$/.test(w)) return w.toUpperCase();
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
  if (key in NVIDIA) return key.startsWith("geforce") ? `NVIDIA ${words}` : `NVIDIA GeForce ${words}`;
  if (key in AMD) return key.startsWith("radeon") ? `AMD ${words}` : `AMD Radeon ${words}`;
  if (key.startsWith("arc ")) return `Intel ${words}`;
  if (key.startsWith("apple m")) return words.replace(/\bM(\d)/, "M$1");
  if (key === "adreno x1") return "Qualcomm Adreno X1";
  return words;
}

/** Every known GPU, strongest first, for an autocomplete. */
export const GPU_SUGGESTIONS: string[] = Object.entries(GPU_SCORES)
  .sort((a, b) => b[1] - a[1])
  .map(([key]) => gpuDisplayName(key));

/* ---------------------------------------------------------------------------
 * GPU matching
 * ------------------------------------------------------------------------ */

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[®™©]/g, " ")
    .replace(/\(r\)|\(tm\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Splits a requirement line into alternatives ("A or B", "A / B", "A, B").
 * A bare model number inherits the previous fragment's family prefix, so
 * "GeForce 8600/9600GT" and "Radeon HD2600/3600" read as two cards each.
 */
function fragments(text: string): string[] {
  const parts = norm(text)
    .split(/\s*(?:\bor\b|\/|,|;|\||\band\b|\bequivalent\b)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const out: string[] = [];
  let prefix = "";
  for (const part of parts) {
    if (/^\d/.test(part) && prefix) out.push(`${prefix} ${part}`);
    else out.push(part);
    const lead = part.match(/^(.*?)(?=\s*\d)/)?.[1]?.trim();
    if (lead && /[a-z]/.test(lead)) prefix = lead;
  }
  return out;
}

/** Candidate canonical keys for one fragment, best first. */
function gpuKeys(fragment: string): string[] {
  const f = fragment.replace(/(\d)\s*(gb|mb)\b.*/, "$1"); // drop "3 GB", "(4GB+ of VRAM)"
  const keys: string[] = [];
  if (/steam\s?deck/.test(f)) keys.push("steam deck");
  const apple = f.match(/\b(?:apple\s*)?m([1-4])\s?(pro|max|ultra)?\b/);
  if (apple && (/apple/.test(f) || /^m[1-4]\b/.test(f))) keys.push(`apple m${apple[1]}${apple[2] ? ` ${apple[2]}` : ""}`);
  if (/adreno\s?x1/.test(f)) keys.push("adreno x1");

  const arc = f.match(/\barc\s?([ab])\s?(\d{3})/);
  if (arc) keys.push(`arc ${arc[1]}${arc[2]}`);
  const arcV = f.match(/\barc\s?(1[34]0)\s?v\b/);
  if (arcV) keys.push(`intel arc ${arcV[1]}v`);
  if (/\biris\s?xe\b/.test(f)) keys.push("intel iris xe");
  else if (/\biris\b/.test(f)) keys.push("intel iris plus");
  const hd = f.match(/\b(u?hd)\s?(?:graphics\s?)?(\d{3,4})\b/);
  if (hd) {
    const n = hd[2];
    if (hd[1] === "uhd" || /intel/.test(f) || n.length === 3) {
      keys.push(`intel ${hd[1]} ${n}`, `intel uhd ${n}`, `intel hd ${n}`);
    } else {
      keys.push(`hd ${n}`, `intel hd ${n}`);
    }
  }
  if (/\barc\b/.test(f) && /intel/.test(f) && !arc && !arcV) keys.push("intel arc graphics");

  if (/radeon\s?vii\b/.test(f)) keys.push("radeon vii");
  const vegaRx = f.match(/\b(?:rx\s?)?vega\s?(56|64)\b/);
  if (vegaRx) keys.push(`rx vega ${vegaRx[1]}`);
  const vegaApu = f.match(/\bvega\s?(\d{1,2})\b/);
  if (vegaApu && Number(vegaApu[1]) <= 11) keys.push(`vega ${vegaApu[1]}`);
  const apu = f.match(/\bradeon\s?(\d{3})m\b/);
  if (apu) keys.push(`radeon ${apu[1]}m`);
  const rx = f.match(/\brx\s?(\d{3,4})\s?(xtx|xt|gre)?\b/);
  if (rx) keys.push(`rx ${rx[1]}${rx[2] ? ` ${rx[2]}` : ""}`, `rx ${rx[1]}`);
  const r79 = f.match(/\br([79])\s?(\d{3})\s?(x)?\b/);
  if (r79) keys.push(`r${r79[1]} ${r79[2]}${r79[3] ?? ""}`, `r${r79[1]} ${r79[2]}`);
  const fury = f.match(/\br9\s?(fury\s?x|fury|nano)\b/);
  if (fury) keys.push(`r9 ${fury[1].replace(/\s/g, " ")}`);

  // NVIDIA: explicit family prefix, or a bare number after "nvidia"/"geforce".
  // "9600GT", "1060M": split the trailing letters off the model number.
  const nv = f
    .replace(/(\d{3,4})(gts?|gtx|m)\b/g, "$1 $2")
    .match(/\b(rtx|gtx|gts|gt|mx)?\s?(\d{3,4})\s?(ti\s?super|super|ti)?\b/);
  if (nv && (nv[1] || /nvidia|geforce/.test(f))) {
    const suffix = nv[3] ? ` ${nv[3].replace(/\s+/g, " ")}` : "";
    const families = nv[1] ? [nv[1] === "gts" ? "gtx" : nv[1]] : ["rtx", "gtx", "gt", "mx", "geforce"];
    for (const family of families) keys.push(`${family} ${nv[2]}${suffix}`);
    for (const family of families) keys.push(`${family} ${nv[2]}`);
    // GeForce 9600 GT and friends are keyed by the bare series.
    keys.push(`geforce ${nv[2]}`);
  }
  return keys;
}

/** Laptop parts share names with desktop ones but run well below them. */
const isMobileGpu = (fragment: string) => /\b(laptop|mobile|max-?q)\b|\d{3,4}\s?m\b/.test(fragment);

/** Every GPU named in `text`, in order (requirement lines often list two or three). */
export function matchGpus(text: string): HardwareMatch[] {
  const out: HardwareMatch[] = [];
  for (const fragment of fragments(text)) {
    const key = gpuKeys(fragment).find((candidate) => candidate in GPU_SCORES);
    if (!key) continue;
    const mobile = isMobileGpu(fragment) && !/^(radeon \d|intel|vega|apple|steam|adreno)/.test(key);
    const name = gpuDisplayName(key) + (mobile ? " Laptop" : "");
    if (out.some((m) => m.name === name)) continue;
    out.push({ name, score: Math.round(GPU_SCORES[key] * (mobile ? 0.8 : 1) * 10) / 10 });
  }
  return out;
}

export function matchGpu(text: string): HardwareMatch | null {
  return matchGpus(text)[0] ?? null;
}

/* ---------------------------------------------------------------------------
 * CPU
 * ------------------------------------------------------------------------ */

/** Intel Core i3/i5/i7/i9 by generation (desktop non-K part). */
const INTEL_CORE: Record<number, Record<number, number>> = {
  3: { 1: 1.6, 2: 2.0, 3: 2.3, 4: 2.6, 6: 3.6, 7: 4.0, 8: 6.1, 9: 6.6, 10: 8.7, 12: 14, 13: 14.5, 14: 15 },
  5: { 1: 2.6, 2: 4.0, 3: 4.6, 4: 5.2, 5: 5.5, 6: 5.7, 7: 6.4, 8: 9.2, 9: 9.5, 10: 12.2, 11: 17, 12: 19.5, 13: 25, 14: 26 },
  7: { 1: 2.9, 2: 5.2, 3: 6.3, 4: 7.0, 5: 7.5, 6: 8.0, 7: 8.9, 8: 12.5, 9: 14, 10: 17, 11: 20.5, 12: 30, 13: 42, 14: 47 },
  9: { 9: 17, 10: 21, 11: 22, 12: 40, 13: 55, 14: 58 },
};

/** Ryzen 3/5/7/9 by series (first digit of the model). */
const RYZEN: Record<number, Record<number, number>> = {
  3: { 1: 6.3, 2: 6.8, 3: 11.7, 4: 10, 5: 15, 7: 20, 8: 20, 9: 22 },
  5: { 1: 11.5, 2: 13.3, 3: 17.8, 4: 16, 5: 21, 7: 28.5, 8: 27, 9: 30 },
  7: { 1: 14.7, 2: 17.5, 3: 22.5, 4: 19, 5: 27, 7: 35, 8: 31, 9: 37 },
  9: { 3: 31, 5: 42, 7: 57, 9: 60 },
};

const CORE_ULTRA_DESKTOP: Record<number, number> = { 5: 40, 7: 55, 9: 64 };
const CORE_ULTRA_MOBILE: Record<number, number> = { 5: 22, 7: 27, 9: 30 };

const OTHER_CPU: Record<string, [string, number]> = {
  "steam deck": ["Steam Deck APU", 7],
  "m1": ["Apple M1", 14.5], "m1 pro": ["Apple M1 Pro", 22], "m1 max": ["Apple M1 Max", 23], "m1 ultra": ["Apple M1 Ultra", 42],
  "m2": ["Apple M2", 15.5], "m2 pro": ["Apple M2 Pro", 25], "m2 max": ["Apple M2 Max", 26], "m2 ultra": ["Apple M2 Ultra", 48],
  "m3": ["Apple M3", 19], "m3 pro": ["Apple M3 Pro", 26], "m3 max": ["Apple M3 Max", 38],
  "m4": ["Apple M4", 24], "m4 pro": ["Apple M4 Pro", 37], "m4 max": ["Apple M4 Max", 45],
  "snapdragon x elite": ["Snapdragon X Elite", 22], "snapdragon x plus": ["Snapdragon X Plus", 18],
};

const FX: Record<number, number> = { 4: 3.5, 6: 4.5, 8: 6, 9: 6.5 };

/** The value for `key`, or the nearest lower (then higher) one in a sparse table. */
function nearest(table: Record<number, number>, key: number): number | null {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (keys.length === 0) return null;
  const lower = keys.filter((k) => k <= key).pop();
  return table[lower ?? keys[0]];
}

/** Laptop suffix multipliers: U/Y/G parts are power-limited, H near desktop, HX at it. */
function mobileFactor(suffix: string): number {
  const s = suffix.toLowerCase();
  if (/^hx/.test(s)) return 0.95;
  if (/^h/.test(s)) return 0.8;
  if (/^p/.test(s)) return 0.7;
  if (/^(u|y|g\d)/.test(s)) return 0.55;
  return 1;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function matchCpuFragment(f: string): HardwareMatch | null {
  if (/steam\s?deck/.test(f)) return { name: OTHER_CPU["steam deck"][0], score: OTHER_CPU["steam deck"][1] };
  const snap = f.match(/snapdragon\s?x\s?(elite|plus)/);
  if (snap) {
    const [name, score] = OTHER_CPU[`snapdragon x ${snap[1]}`];
    return { name, score };
  }
  const apple = f.match(/\b(?:apple\s*)?m([1-4])\s?(pro|max|ultra)?\b/);
  if (apple && (/apple/.test(f) || /^m[1-4]\b/.test(f))) {
    const entry = OTHER_CPU[`m${apple[1]}${apple[2] ? ` ${apple[2]}` : ""}`];
    if (entry) return { name: entry[0], score: entry[1] };
  }

  const ultra = f.match(/\bultra\s?([579])\s?(\d{3})([a-z]{0,2})\b/);
  if (ultra) {
    const tier = Number(ultra[1]);
    const suffix = ultra[3] ?? "";
    const mobile = /^[hupv]/.test(suffix) || ultra[2].startsWith("1");
    const base = mobile ? CORE_ULTRA_MOBILE[tier] : CORE_ULTRA_DESKTOP[tier];
    const score = base * (mobile ? (/^[uv]/.test(suffix) ? 0.75 : 1) : suffix.startsWith("k") ? 1.07 : 1);
    return { name: `Intel Core Ultra ${tier} ${ultra[2]}${suffix.toUpperCase()}`, score: round1(score) };
  }

  // The suffix must touch the number: "i5 750 or higher" has no suffix "or".
  const core = f.match(/\bi([3579])[\s-]?(\d{3,5})([a-z]{0,2}\d?)\b/);
  if (core) {
    const tier = Number(core[1]);
    const digits = core[2];
    const suffix = core[3] ?? "";
    // 3 digits = 1st gen (i5-750); 4 = gen 2–9, or 10–14 for laptop parts
    // that start with "1" (i5-1135G7); 5 = gen 10–14 (i5-12400).
    const gen =
      digits.length === 3 ? 1 : digits.length === 5 || digits.startsWith("1") ? Number(digits.slice(0, 2)) : Number(digits[0]);
    const base = nearest(INTEL_CORE[tier], Math.min(gen, 14));
    if (base === null) return null;
    let score = base * mobileFactor(suffix);
    if (/^k/.test(suffix)) score *= gen >= 12 && tier === 5 ? 1.35 : gen >= 12 ? 1.12 : 1.08;
    return { name: `Intel Core i${tier}-${digits}${suffix.toUpperCase()}`, score: round1(score) };
  }

  const ryzen = f.match(/\b(?:ryzen\s?|r)([3579])\s?(?:pro\s?)?(\d{4})([a-z0-9]{0,4})\b/);
  if (ryzen && (/ryzen/.test(f) || /\br[3579]\s?\d{4}/.test(f))) {
    const tier = Number(ryzen[1]);
    const series = Number(ryzen[2][0]);
    const suffix = ryzen[3] ?? "";
    const base = nearest(RYZEN[tier], series);
    if (base === null) return null;
    const score = base * mobileFactor(suffix);
    return { name: `AMD Ryzen ${tier} ${ryzen[2]}${suffix.toUpperCase()}`, score: round1(score) };
  }

  const fx = f.match(/\bfx[\s-]?(\d)(\d{3})\b/);
  if (fx && FX[Number(fx[1])]) return { name: `AMD FX-${fx[1]}${fx[2]}`, score: FX[Number(fx[1])] };
  if (/phenom\s?ii\s?x4/.test(f)) return { name: "AMD Phenom II X4", score: 2.8 };
  if (/phenom\s?ii\s?x6/.test(f)) return { name: "AMD Phenom II X6", score: 3.8 };
  return null;
}

/** Every CPU named in `text`, in order. */
export function matchCpus(text: string): HardwareMatch[] {
  const out: HardwareMatch[] = [];
  for (const fragment of fragments(text)) {
    const match = matchCpuFragment(fragment);
    if (match && !out.some((m) => m.name === match.name)) out.push(match);
  }
  return out;
}

export function matchCpu(text: string): HardwareMatch | null {
  return matchCpus(text)[0] ?? null;
}

/** Common CPUs, newest first, for an autocomplete. Free text outside the list still matches. */
export const CPU_SUGGESTIONS: string[] = [
  "Intel Core Ultra 9 285K", "Intel Core Ultra 7 265K", "Intel Core Ultra 5 245K",
  "Intel Core i9-14900K", "Intel Core i7-14700K", "Intel Core i5-14600K", "Intel Core i5-14400F",
  "Intel Core i9-13900K", "Intel Core i7-13700K", "Intel Core i5-13600K", "Intel Core i5-13400F", "Intel Core i7-13700H",
  "Intel Core i9-12900K", "Intel Core i7-12700K", "Intel Core i5-12600K", "Intel Core i5-12400F", "Intel Core i3-12100F",
  "Intel Core i7-12700H", "Intel Core i5-1235U",
  "Intel Core i7-11700K", "Intel Core i5-11400F", "Intel Core i7-1165G7", "Intel Core i5-1135G7",
  "Intel Core i9-10900K", "Intel Core i7-10700K", "Intel Core i5-10400F", "Intel Core i3-10100F", "Intel Core i7-10750H",
  "Intel Core i9-9900K", "Intel Core i7-9700K", "Intel Core i5-9600K", "Intel Core i5-9400F", "Intel Core i7-9750H",
  "Intel Core i7-8700K", "Intel Core i5-8400", "Intel Core i3-8100", "Intel Core i7-8750H",
  "Intel Core i7-7700K", "Intel Core i5-7400", "Intel Core i7-6700K", "Intel Core i5-6600K",
  "Intel Core i7-4790K", "Intel Core i5-4690K", "Intel Core i5-4460", "Intel Core i7-3770K", "Intel Core i5-3470",
  "Intel Core i7-2600K", "Intel Core i5-2500K",
  "AMD Ryzen 9 9950X", "AMD Ryzen 9 9900X", "AMD Ryzen 7 9800X3D", "AMD Ryzen 7 9700X", "AMD Ryzen 5 9600X",
  "AMD Ryzen 9 7950X", "AMD Ryzen 9 7900X", "AMD Ryzen 7 7800X3D", "AMD Ryzen 7 7700X", "AMD Ryzen 5 7600X", "AMD Ryzen 5 7600",
  "AMD Ryzen 7 8700G", "AMD Ryzen 5 8600G", "AMD Ryzen 7 7840HS", "AMD Ryzen 9 7945HX",
  "AMD Ryzen 9 5950X", "AMD Ryzen 9 5900X", "AMD Ryzen 7 5800X3D", "AMD Ryzen 7 5800X", "AMD Ryzen 7 5700X",
  "AMD Ryzen 5 5600X", "AMD Ryzen 5 5600", "AMD Ryzen 5 5500", "AMD Ryzen 7 5800H", "AMD Ryzen 5 5600H", "AMD Ryzen 7 6800H",
  "AMD Ryzen 9 3900X", "AMD Ryzen 7 3700X", "AMD Ryzen 5 3600", "AMD Ryzen 3 3300X", "AMD Ryzen 3 3100",
  "AMD Ryzen 7 2700X", "AMD Ryzen 5 2600", "AMD Ryzen 7 1700", "AMD Ryzen 5 1600", "AMD Ryzen 3 1200",
  "AMD FX-8350", "AMD FX-6300",
  "Apple M4 Max", "Apple M4 Pro", "Apple M4", "Apple M3 Max", "Apple M3 Pro", "Apple M3", "Apple M2 Pro", "Apple M2",
  "Apple M1 Pro", "Apple M1", "Snapdragon X Elite", "Steam Deck APU",
];

/* ---------------------------------------------------------------------------
 * Steam requirements parsing lives in `pc-requirements.ts` (the server needs
 * only that, not the tables); re-exported here for client code.
 * ------------------------------------------------------------------------ */

export { parsePcRequirements, parseRequirementTier } from "./pc-requirements";

/* ---------------------------------------------------------------------------
 * Verdict
 * ------------------------------------------------------------------------ */

type Part = HardwareVerdict["parts"][number];

/**
 * The reader's part vs a requirement line. A requirement that lists several
 * parts ("GTX 1060 or RX 580") is met by matching the *slowest* of them —
 * the publisher is saying any of them is enough.
 */
function comparePart(
  part: "CPU" | "GPU",
  yours: HardwareMatch | null,
  yoursText: string,
  needed: string | null,
): Part {
  const options = needed ? (part === "GPU" ? matchGpus(needed) : matchCpus(needed)) : [];
  const easiest = options.length ? options.reduce((low, m) => (m.score < low.score ? m : low)) : null;
  return {
    part,
    yours: yours?.name ?? (yoursText.trim() || "Not set"),
    needed: easiest?.name ?? needed,
    ok: yours && easiest ? yours.score >= easiest.score : null,
  };
}

function compareTier(specs: UserPcSpecs, tier: PcRequirementTier): { parts: Part[]; met: boolean | null } {
  const ramOk = tier.ramGb !== null && specs.ramGb > 0 ? specs.ramGb >= tier.ramGb : null;
  const parts: Part[] = [
    comparePart("CPU", matchCpu(specs.cpu ?? ""), specs.cpu ?? "", tier.cpu),
    comparePart("GPU", matchGpu(specs.gpu ?? ""), specs.gpu ?? "", tier.gpu),
    {
      part: "RAM",
      yours: specs.ramGb > 0 ? `${specs.ramGb} GB` : "Not set",
      needed: tier.ramGb !== null ? `${tier.ramGb} GB` : null,
      ok: ramOk,
    },
  ];
  if (parts.some((p) => p.ok === false)) return { parts, met: false };
  // Passing on RAM alone says nothing about whether the game runs.
  const comparable = parts.filter((p) => p.part !== "RAM" && p.ok !== null).length;
  return { parts, met: comparable > 0 ? true : null };
}

const shortfall = (parts: Part[]) => parts.filter((p) => p.ok === false).map((p) => p.part);

function listParts(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The reader's PC vs Steam's requirements:
 *
 *  - great   — meets the recommended tier;
 *  - ok      — meets the minimum but not the recommended;
 *  - below   — falls short of the minimum on some part;
 *  - unknown — not enough could be matched to say (no requirements, an
 *              unrecognised part, or only RAM comparable).
 *
 * A tier is met when no comparable part fails and at least the CPU or GPU
 * could be compared. `parts` describes the tier that decided the verdict.
 */
export function evaluateHardware(specs: UserPcSpecs, req: PcRequirements | null | undefined): HardwareVerdict {
  const unknown = (parts: Part[] = [], summary = "We couldn't compare your PC with this game's requirements.") => ({
    kind: "unknown" as const,
    parts,
    summary,
  });
  if (!req || (!req.minimum && !req.recommended)) return unknown([], "This game doesn't list PC requirements on Steam.");

  const rec = req.recommended ? compareTier(specs, req.recommended) : null;
  const min = req.minimum ? compareTier(specs, req.minimum) : null;

  if (rec?.met === true) {
    return { kind: "great", parts: rec.parts, summary: "Your PC meets the recommended specs." };
  }
  if (min?.met === true) {
    const short = rec ? shortfall(rec.parts) : [];
    return {
      kind: "ok",
      parts: rec && short.length ? rec.parts : min.parts,
      summary: short.length
        ? `Meets the minimum specs; your ${listParts(short)} ${short.length > 1 ? "are" : "is"} below recommended.`
        : "Meets the minimum specs.",
    };
  }
  if (min?.met === false) {
    const short = shortfall(min.parts);
    return {
      kind: "below",
      parts: min.parts,
      summary: `Your ${listParts(short)} ${short.length > 1 ? "fall" : "falls"} short of the minimum specs.`,
    };
  }
  // No usable minimum tier: failing the recommended one says nothing about running at all.
  return unknown((min ?? rec)?.parts ?? []);
}
