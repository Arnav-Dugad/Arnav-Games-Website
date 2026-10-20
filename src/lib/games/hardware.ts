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
 *     "Intel I5 4690", "AMD r5 3600", WebGL's "ANGLE (NVIDIA, NVIDIA GeForce
 *     RTX 4060 Laptop GPU …)") to a model family and a performance score.
 *  3. `evaluateHardware` compares the reader's PC with both tiers and — when
 *     it knows their screen and goal — estimates how each resolution and
 *     settings level should go, with plain reasons (VRAM, storage, laptop
 *     power, operating system).
 *
 * The scores are ESTIMATES, documented as such wherever they surface:
 *
 *  - GPU score ≈ 3DMark Time Spy graphics score ÷ 100 for current-ish cards
 *    (GTX 1060 ≈ 40, RTX 3060 ≈ 87); pre-DX12 cards and integrated graphics
 *    are placed by relative rasterisation performance on the same scale.
 *  - Laptop GPUs have their own table at a typical, mid-to-high power limit
 *    (an RTX 4060 Laptop GPU at ~100 W ≈ 105). The same name spans a 2–3×
 *    range across laptops, which the verdict says out loud. Max-Q parts take
 *    85% of the laptop figure; a laptop part with no figure of its own takes
 *    80% of its desktop twin.
 *  - CPU score ≈ PassMark CPU Mark ÷ 1000 for a representative desktop part
 *    of the family (i5-8400 ≈ 9, Ryzen 5 3600 ≈ 18). Laptop suffixes scale
 *    it (U ≈ 55%, H ≈ 80%, HX ≈ 95%). Intel Core i is modelled per tier ×
 *    generation and Ryzen per tier × series, so an unlisted model in a known
 *    family still gets a fair figure. Newer names (Core Ultra, Core 5/7,
 *    Ryzen AI, handheld Z-series, Apple M) have their own small tables.
 *
 * They only need to rank parts plausibly — "is mine at least as fast as the
 * slowest card this publisher says is enough" — not benchmark them.
 */

import type {
  HardwareOutlook,
  HardwarePart,
  HardwareVerdict,
  PcGoal,
  PcQuality,
  PcRequirementTier,
  PcRequirements,
  PcResolution,
  UserPcSpecs,
} from "./types";

export interface HardwareMatch {
  /** Canonical display name, e.g. "NVIDIA GeForce RTX 3060 Ti". */
  name: string;
  /** Relative performance estimate (see the module comment for units). */
  score: number;
  /** A laptop (power-limited) part. Absent for desktop parts. */
  laptop?: true;
}

/* ---------------------------------------------------------------------------
 * GPU tables — keys are canonical lowercase model ids.
 * ------------------------------------------------------------------------ */

const NVIDIA: Record<string, number> = {
  "geforce 8600": 2, "geforce 8800": 4, "geforce 9600": 3, "geforce 9800": 5,
  "gt 710": 2, "gt 730": 4,
  "gtx 460": 7, "gtx 550 ti": 6, "gtx 560": 8, "gtx 560 ti": 9, "gtx 570": 11, "gtx 580": 12,
  "gtx 650": 6, "gtx 650 ti": 9, "gtx 660": 12, "gtx 660 ti": 15, "gtx 670": 18, "gtx 680": 20,
  "gtx 750": 12, "gtx 750 ti": 14, "gtx 760": 17, "gtx 770": 21, "gtx 780": 24, "gtx 780 ti": 30,
  "gtx 950": 23, "gtx 960": 26, "gtx 970": 36, "gtx 980": 45, "gtx 980 ti": 56, "gtx titan x": 56,
  "gt 1030": 11, "gtx 1050": 18, "gtx 1050 ti": 24, "gtx 1060": 40, "gtx 1070": 58, "gtx 1070 ti": 67,
  "gtx 1080": 73, "gtx 1080 ti": 95, "titan xp": 98, "titan v": 130, "titan rtx": 140,
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

/**
 * NVIDIA laptop GPUs at a typical power limit. Keyed like the desktop table
 * and used when the name says Laptop/Mobile/Max-Q — or when the reader told
 * us their PC is a laptop, since older drivers report "GeForce GTX 1060"
 * on laptops with no suffix at all.
 */
const NVIDIA_LAPTOP: Record<string, number> = {
  "gtx 1050": 17, "gtx 1050 ti": 22, "gtx 1060": 32, "gtx 1070": 48, "gtx 1080": 60,
  "gtx 1650": 32, "gtx 1650 ti": 36, "gtx 1660 ti": 55,
  "rtx 2050": 30, "rtx 2060": 60, "rtx 2070": 72, "rtx 2070 super": 78, "rtx 2080": 85, "rtx 2080 super": 92,
  "rtx 3050": 48, "rtx 3050 ti": 55, "rtx 3060": 85, "rtx 3070": 105, "rtx 3070 ti": 115, "rtx 3080": 120,
  "rtx 3080 ti": 135,
  "rtx 4050": 88, "rtx 4060": 105, "rtx 4070": 120, "rtx 4080": 175, "rtx 4090": 205,
  "rtx 5050": 95, "rtx 5060": 120, "rtx 5070": 135, "rtx 5070 ti": 170, "rtx 5080": 210, "rtx 5090": 250,
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
  "rx 5300": 40, "rx 5500": 45, "rx 5500 xt": 49, "rx 5600 xt": 75, "rx 5700": 82, "rx 5700 xt": 91,
  "rx 6300": 30, "rx 6400": 38, "rx 6500 xt": 45, "rx 6600": 79, "rx 6600 xt": 92, "rx 6650 xt": 97, "rx 6700": 105,
  "rx 6700 xt": 117, "rx 6750 xt": 123, "rx 6800": 155, "rx 6800 xt": 180, "rx 6900 xt": 200, "rx 6950 xt": 215,
  "rx 7600": 107, "rx 7600 xt": 112, "rx 7700 xt": 166, "rx 7800 xt": 196, "rx 7900 gre": 215,
  "rx 7900 xt": 265, "rx 7900 xtx": 295,
  "rx 9060": 120, "rx 9060 xt": 150, "rx 9070": 245, "rx 9070 gre": 220, "rx 9070 xt": 290,
  // Integrated (APU) graphics. 8050S/8060S are Strix Halo's large iGPUs.
  "vega 8": 9, "vega 11": 11, "radeon 610m": 6, "radeon 660m": 17, "radeon 680m": 24, "radeon 740m": 14,
  "radeon 760m": 22, "radeon 780m": 27, "radeon 880m": 30, "radeon 890m": 35,
  "radeon 8050s": 80, "radeon 8060s": 100,
};

/** AMD's laptop parts carry their own M/S suffix, so they never collide with desktop keys. */
const AMD_LAPTOP: Record<string, number> = {
  "rx 5500m": 40, "rx 5600m": 55, "rx 5700m": 65,
  "rx 6500m": 40, "rx 6550m": 44, "rx 6600m": 85, "rx 6650m": 90, "rx 6700m": 100, "rx 6800m": 120,
  "rx 6850m xt": 130, "rx 6600s": 70, "rx 6700s": 76, "rx 6800s": 86,
  "rx 7600s": 80, "rx 7700s": 92, "rx 7600m": 85, "rx 7600m xt": 95, "rx 7800m": 140, "rx 7900m": 175,
};

const INTEL: Record<string, number> = {
  "intel hd 2500": 1.5, "intel hd 3000": 1.5, "intel hd 4000": 3, "intel hd 4400": 3.5, "intel hd 4600": 4,
  "intel hd 5000": 4, "intel hd 520": 4, "intel hd 530": 4, "intel hd 620": 5, "intel hd 630": 5,
  "intel uhd 600": 2.5, "intel uhd 620": 5, "intel uhd 630": 5, "intel uhd 730": 6, "intel uhd 750": 7, "intel uhd 770": 7,
  "intel iris plus": 8, "intel iris xe": 13, "intel arc graphics": 32, "intel arc 130v": 34, "intel arc 140v": 40,
  "intel arc 140t": 38,
  "arc a310": 30, "arc a380": 37, "arc a580": 85, "arc a750": 105, "arc a770": 115, "arc b570": 125, "arc b580": 140,
};

const INTEL_LAPTOP: Record<string, number> = {
  "arc a350m": 24, "arc a370m": 32, "arc a550m": 50, "arc a570m": 58, "arc a730m": 75, "arc a770m": 90,
};

const OTHER_GPU: Record<string, number> = {
  "steam deck": 16, "rog ally z1": 14, "rog ally z1 extreme": 25, "rog ally z2 extreme": 33,
  "apple m1": 20, "apple m1 pro": 45, "apple m1 max": 80, "apple m1 ultra": 140,
  "apple m2": 25, "apple m2 pro": 55, "apple m2 max": 95, "apple m2 ultra": 170,
  "apple m3": 30, "apple m3 pro": 60, "apple m3 max": 120, "apple m3 ultra": 200,
  "apple m4": 35, "apple m4 pro": 75, "apple m4 max": 140,
  "apple m5": 45,
  "adreno x1": 18,
};

const LAPTOP_ONLY: Record<string, number> = { ...AMD_LAPTOP, ...INTEL_LAPTOP };
const GPU_SCORES: Record<string, number> = { ...NVIDIA, ...AMD, ...INTEL, ...OTHER_GPU, ...LAPTOP_ONLY };

/**
 * Typical video memory per card (its common configuration), used only to
 * *suggest* a figure once a card is recognised — the reader confirms it.
 */
const VRAM: Record<string, number> = {
  "gtx 960": 2, "gtx 970": 4, "gtx 980": 4, "gtx 980 ti": 6, "gtx 1050": 2, "gtx 1050 ti": 4, "gtx 1060": 6,
  "gtx 1070": 8, "gtx 1070 ti": 8, "gtx 1080": 8, "gtx 1080 ti": 11, "gtx 1650": 4, "gtx 1650 super": 4,
  "gtx 1660": 6, "gtx 1660 super": 6, "gtx 1660 ti": 6, "rtx 2060": 6, "rtx 2060 super": 8, "rtx 2070": 8,
  "rtx 2070 super": 8, "rtx 2080": 8, "rtx 2080 super": 8, "rtx 2080 ti": 11, "rtx 3050": 8, "rtx 3060": 12,
  "rtx 3060 ti": 8, "rtx 3070": 8, "rtx 3070 ti": 8, "rtx 3080": 10, "rtx 3080 ti": 12, "rtx 3090": 24,
  "rtx 3090 ti": 24, "rtx 4060": 8, "rtx 4060 ti": 8, "rtx 4070": 12, "rtx 4070 super": 12, "rtx 4070 ti": 12,
  "rtx 4070 ti super": 16, "rtx 4080": 16, "rtx 4080 super": 16, "rtx 4090": 24, "rtx 5050": 8, "rtx 5060": 8,
  "rtx 5060 ti": 16, "rtx 5070": 12, "rtx 5070 ti": 16, "rtx 5080": 16, "rtx 5090": 32,
  "rx 470": 4, "rx 480": 8, "rx 570": 4, "rx 580": 8, "rx 590": 8, "rx vega 56": 8, "rx vega 64": 8,
  "rx 5500 xt": 8, "rx 5600 xt": 6, "rx 5700": 8, "rx 5700 xt": 8, "rx 6500 xt": 4, "rx 6600": 8,
  "rx 6600 xt": 8, "rx 6650 xt": 8, "rx 6700 xt": 12, "rx 6750 xt": 12, "rx 6800": 16, "rx 6800 xt": 16,
  "rx 6900 xt": 16, "rx 6950 xt": 16, "rx 7600": 8, "rx 7600 xt": 16, "rx 7700 xt": 12, "rx 7800 xt": 16,
  "rx 7900 gre": 16, "rx 7900 xt": 20, "rx 7900 xtx": 24, "rx 9060 xt": 16, "rx 9070": 16, "rx 9070 xt": 16,
  "arc a380": 6, "arc a580": 8, "arc a750": 8, "arc a770": 16, "arc b570": 10, "arc b580": 12,
  "rx 6600m": 8, "rx 6700m": 10, "rx 6800m": 12, "rx 7600m": 8, "rx 7600m xt": 8, "rx 7700s": 8,
  "arc a370m": 4, "arc a730m": 12, "arc a770m": 16,
};

/** Laptop VRAM differs from the desktop card of the same name (RTX 3060: 12 GB desktop, 6 GB laptop). */
const VRAM_LAPTOP: Record<string, number> = {
  "gtx 1650": 4, "gtx 1660 ti": 6, "rtx 2060": 6, "rtx 2070": 8, "rtx 2080": 8, "rtx 3050": 4, "rtx 3050 ti": 4,
  "rtx 3060": 6, "rtx 3070": 8, "rtx 3070 ti": 8, "rtx 3080": 8, "rtx 3080 ti": 16, "rtx 4050": 6, "rtx 4060": 8,
  "rtx 4070": 8, "rtx 4080": 12, "rtx 4090": 16, "rtx 5050": 8, "rtx 5060": 8, "rtx 5070": 8, "rtx 5070 ti": 12,
  "rtx 5080": 16, "rtx 5090": 24,
};

/** Vendor-prefixed display name for a canonical key. */
function gpuDisplayName(key: string): string {
  const words = key
    .split(" ")
    .map((w) => {
      if (w === "ti") return "Ti";
      if (w === "super") return "SUPER";
      if (w === "geforce") return "GeForce";
      if (w === "rog") return "ROG";
      if (/^(gtx|rtx|gt|mx|rx|hd|uhd|xt|xtx|gre|vii|xp|z1|z2)$/.test(w) || /^[a-z]\d/.test(w) || /^\d+[a-z]+$/.test(w)) return w.toUpperCase();
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
  if (key in NVIDIA || key in NVIDIA_LAPTOP) return /^(geforce|titan)/.test(key) ? `NVIDIA ${words}` : `NVIDIA GeForce ${words}`;
  if (key in AMD || key in AMD_LAPTOP) return key.startsWith("radeon") ? `AMD ${words}` : `AMD Radeon ${words}`;
  if (key.startsWith("arc ")) return `Intel ${words}`;
  if (key.startsWith("apple m")) return words.replace(/\bM(\d)/, "M$1");
  if (key === "adreno x1") return "Qualcomm Adreno X1";
  if (key.startsWith("rog ally")) return `ASUS ${words}`;
  return words;
}

/** Every known GPU, strongest first, for an autocomplete. Laptop rows say so. */
export const GPU_SUGGESTIONS: string[] = [
  ...Object.entries(GPU_SCORES).map(([key, score]) => [gpuDisplayName(key), score] as const),
  ...Object.entries(NVIDIA_LAPTOP).map(([key, score]) => [`${gpuDisplayName(key)} Laptop GPU`, score] as const),
]
  .sort((a, b) => b[1] - a[1])
  .map(([name]) => name);

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
  // Steam Deck reports its APU as "AMD Custom GPU 0405" (LCD) / "0932" (OLED).
  if (/steam\s?deck|custom gpu 0(?:405|932)|van\s?gogh|sephiroth/.test(f)) keys.push("steam deck");
  const z = f.match(/\bz([12])\s?(extreme)?\b/);
  if (z && /ryzen|ally|legion|\bz[12]\s?extreme/.test(f)) keys.push(`rog ally z${z[1]}${z[2] ? " extreme" : ""}`);
  const apple = f.match(/\b(?:apple\s*)?m([1-5])\s?(pro|max|ultra)?\b/);
  if (apple && (/apple/.test(f) || /^m[1-5]\b/.test(f))) keys.push(`apple m${apple[1]}${apple[2] ? ` ${apple[2]}` : ""}`);
  if (/adreno\s?x1/.test(f)) keys.push("adreno x1");

  const arc = f.match(/\barc\s?([ab])\s?(\d{3})\s?(m)?\b/);
  if (arc) keys.push(...(arc[3] ? [`arc ${arc[1]}${arc[2]}m`] : []), `arc ${arc[1]}${arc[2]}`);
  const arcV = f.match(/\barc\s?(1[34]0)\s?([vt])\b/);
  if (arcV) keys.push(`intel arc ${arcV[1]}${arcV[2]}`);
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
  const halo = f.match(/\bradeon\s?(80[456]0)s\b/);
  if (halo) keys.push(`radeon ${halo[1]}s`);
  // Laptop Radeons: "RX 6800M", "RX 7600M XT", "RX 6700S".
  const rxMobile = f.match(/\brx\s?(\d{4})\s?([ms])\s?(xt)?\b/);
  if (rxMobile) keys.push(`rx ${rxMobile[1]}${rxMobile[2]}${rxMobile[3] ? " xt" : ""}`, `rx ${rxMobile[1]}${rxMobile[2]}`);
  const rx = f.match(/\brx\s?(\d{3,4})\s?(xtx|xt|gre)?\b/);
  if (rx) keys.push(`rx ${rx[1]}${rx[2] ? ` ${rx[2]}` : ""}`, `rx ${rx[1]}`);
  const r79 = f.match(/\br([79])\s?(\d{3})\s?(x)?\b/);
  if (r79) keys.push(`r${r79[1]} ${r79[2]}${r79[3] ?? ""}`, `r${r79[1]} ${r79[2]}`);
  const fury = f.match(/\br9\s?(fury\s?x|fury|nano)\b/);
  if (fury) keys.push(`r9 ${fury[1].replace(/\s/g, " ")}`);

  const titan = f.match(/\btitan\s?(xp|v|rtx)\b/);
  if (titan) keys.push(`titan ${titan[1]}`);
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
const isMobileGpu = (fragment: string) => /\b(laptop|mobile|max-?q|notebook)\b|\d{3,4}\s?m\b/.test(fragment);
/** Parts that are never discrete laptop chips (integrated, handheld, Apple). */
const NOT_DISCRETE = /^(radeon \d|intel|vega|apple|steam|adreno|rog|hd |r[79] )/;

/**
 * Every GPU named in `text`, in order (requirement lines often list two or
 * three). `laptop` says the reader's PC is a laptop, so a bare "RTX 3060"
 * means the laptop chip.
 */
export function matchGpus(text: string, options: { laptop?: boolean } = {}): HardwareMatch[] {
  const out: HardwareMatch[] = [];
  for (const fragment of fragments(text)) {
    const key = gpuKeys(fragment).find((candidate) => candidate in GPU_SCORES || candidate in NVIDIA_LAPTOP);
    if (!key) continue;
    let match: HardwareMatch;
    if (key in LAPTOP_ONLY) {
      match = { name: gpuDisplayName(key), score: LAPTOP_ONLY[key], laptop: true };
    } else if (!NOT_DISCRETE.test(key) && (isMobileGpu(fragment) || options.laptop || !(key in GPU_SCORES))) {
      const base = NVIDIA_LAPTOP[key] ?? GPU_SCORES[key] * 0.8;
      const score = /max-?q/.test(fragment) ? base * 0.85 : base;
      match = { name: `${gpuDisplayName(key)} Laptop`, score: round1(score), laptop: true };
    } else {
      match = { name: gpuDisplayName(key), score: GPU_SCORES[key] };
    }
    if (!out.some((m) => m.name === match.name)) out.push(match);
  }
  return out;
}

export function matchGpu(text: string, options: { laptop?: boolean } = {}): HardwareMatch | null {
  return matchGpus(text, options)[0] ?? null;
}

/** The usual video memory for the card in `text` (a suggestion to confirm), or null. */
export function typicalVram(text: string, options: { laptop?: boolean } = {}): number | null {
  for (const fragment of fragments(text)) {
    const key = gpuKeys(fragment).find((candidate) => candidate in GPU_SCORES || candidate in NVIDIA_LAPTOP);
    if (!key) continue;
    const laptop = !(key in LAPTOP_ONLY) && (isMobileGpu(fragment) || options.laptop);
    return (laptop ? VRAM_LAPTOP[key] : undefined) ?? VRAM[key] ?? null;
  }
  return null;
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

/**
 * Core Ultra by series and kind. Series 1 (Meteor Lake) is laptop-only;
 * series 2 spans desktop (K/F/none), HX, H, U and V (Lunar Lake).
 */
const CORE_ULTRA: Record<string, Record<number, number>> = {
  "1h": { 5: 22, 7: 25, 9: 28 },
  "1u": { 5: 15, 7: 16, 9: 17 },
  "2": { 5: 40, 7: 55, 9: 64 },
  "2hx": { 5: 38, 7: 48, 9: 52 },
  "2h": { 5: 25, 7: 28, 9: 30 },
  "2u": { 5: 15, 7: 17, 9: 18 },
  "2v": { 5: 17, 7: 20, 9: 21 },
};

/** Intel's non-Ultra "Core 5 120U" / "Core 7 240H" (Series 1/2 rebrands of Raptor Lake). */
const CORE_PLAIN: Record<string, Record<number, number>> = {
  u: { 3: 9, 5: 14, 7: 16 },
  h: { 5: 24, 7: 27 },
};

const RYZEN_AI: Record<string, number> = {
  "ai 5": 22, "ai 7": 27, "ai 9": 33, "ai 9 hx": 35, "ai max": 36, "ai max+": 55,
};

const OTHER_CPU: Record<string, [string, number]> = {
  "steam deck": ["Steam Deck APU", 7],
  "z1": ["AMD Ryzen Z1", 15], "z1 extreme": ["AMD Ryzen Z1 Extreme", 25], "z2": ["AMD Ryzen Z2", 22],
  "z2 extreme": ["AMD Ryzen Z2 Extreme", 27],
  "m1": ["Apple M1", 14.5], "m1 pro": ["Apple M1 Pro", 22], "m1 max": ["Apple M1 Max", 23], "m1 ultra": ["Apple M1 Ultra", 42],
  "m2": ["Apple M2", 15.5], "m2 pro": ["Apple M2 Pro", 25], "m2 max": ["Apple M2 Max", 26], "m2 ultra": ["Apple M2 Ultra", 48],
  "m3": ["Apple M3", 19], "m3 pro": ["Apple M3 Pro", 26], "m3 max": ["Apple M3 Max", 38], "m3 ultra": ["Apple M3 Ultra", 60],
  "m4": ["Apple M4", 24], "m4 pro": ["Apple M4 Pro", 37], "m4 max": ["Apple M4 Max", 45],
  "m5": ["Apple M5", 28],
  "snapdragon x elite": ["Snapdragon X Elite", 22], "snapdragon x plus": ["Snapdragon X Plus", 18],
};

const FX: Record<number, number> = { 4: 3.5, 6: 4.5, 8: 6, 9: 6.5 };
/** Xeon E3-12xx by version (v2…v6), and E5-26xx — common in second-hand builds. */
const XEON_E3: Record<number, number> = { 1: 5.5, 2: 6, 3: 7, 5: 8, 6: 8.5 };
const XEON_E5: Record<number, number> = { 1: 10, 2: 13, 3: 17, 4: 19 };

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

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

const cpu = (name: string, score: number, laptop = false): HardwareMatch =>
  laptop ? { name, score: round1(score), laptop: true } : { name, score: round1(score) };

function matchCpuFragment(f: string): HardwareMatch | null {
  if (/steam\s?deck/.test(f)) return cpu(...OTHER_CPU["steam deck"]);
  const snap = f.match(/snapdragon\s?x\s?(elite|plus)/);
  if (snap) return cpu(...OTHER_CPU[`snapdragon x ${snap[1]}`], true);
  const apple = f.match(/\b(?:apple\s*)?m([1-5])\s?(pro|max|ultra)?\b/);
  if (apple && (/apple/.test(f) || /^m[1-5]\b/.test(f))) {
    const entry = OTHER_CPU[`m${apple[1]}${apple[2] ? ` ${apple[2]}` : ""}`];
    if (entry) return cpu(...entry);
  }
  const handheld = f.match(/\bz([12])\s?(extreme)?\b/);
  if (handheld && /ryzen|ally|legion|extreme/.test(f)) {
    const entry = OTHER_CPU[`z${handheld[1]}${handheld[2] ? " extreme" : ""}`];
    if (entry) return cpu(...entry, true);
  }

  // Ryzen AI: "Ryzen AI 9 HX 370", "Ryzen AI 7 350", "Ryzen AI Max+ 395".
  const ai = f.match(/\bryzen\s?ai\s?(max\s?\+?|[579])\s?(hx\s?)?(\d{3})\b/);
  if (ai) {
    const tier = ai[1].replace(/\s/g, "");
    const key = tier.startsWith("max") ? `ai ${tier}` : `ai ${tier}${ai[2] ? " hx" : ""}`;
    const score = RYZEN_AI[key] ?? RYZEN_AI[`ai ${tier}`] ?? null;
    if (score !== null) {
      const label = tier.startsWith("max") ? (tier.includes("+") ? "Max+" : "Max") : `${tier}${ai[2] ? " HX" : ""}`;
      return cpu(`AMD Ryzen AI ${label} ${ai[3]}`, score, true);
    }
  }

  const ultra = f.match(/\bultra\s?([579])\s?(\d{3})([a-z]{0,2})\b/);
  if (ultra) {
    const tier = Number(ultra[1]);
    const series = ultra[2][0] === "1" ? "1" : "2";
    const suffix = (ultra[3] ?? "").toLowerCase();
    const kind = /^hx/.test(suffix) ? "hx" : /^h/.test(suffix) ? "h" : /^u/.test(suffix) ? "u" : /^v/.test(suffix) ? "v" : "";
    const table = CORE_ULTRA[`${series}${series === "1" ? kind || "h" : kind}`] ?? CORE_ULTRA[series === "1" ? "1h" : "2"];
    const base = table[tier] ?? nearest(table, tier) ?? 20;
    const desktop = series === "2" && kind === "";
    // Desktop non-K parts (245, 265F) run a little below the K figures.
    const score = desktop && !suffix.startsWith("k") ? base * 0.88 : base;
    return cpu(`Intel Core Ultra ${tier} ${ultra[2]}${suffix.toUpperCase()}`, score, !desktop);
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
    const factor = mobileFactor(suffix);
    let score = base * factor;
    if (/^k/.test(suffix)) score *= gen >= 12 && tier === 5 ? 1.35 : gen >= 12 ? 1.12 : 1.08;
    return cpu(`Intel Core i${tier}-${digits}${suffix.toUpperCase()}`, score, factor < 1);
  }

  // "Intel Core 7 150U", "Core 5 220H" — no "i", no "Ultra".
  const plain = f.match(/\bcore\s([357])\s(\d{3})([uh])\b/);
  if (plain) {
    const base = CORE_PLAIN[plain[3]][Number(plain[1])];
    if (base) return cpu(`Intel Core ${plain[1]} ${plain[2]}${plain[3].toUpperCase()}`, base, true);
  }

  const ryzen = f.match(/\b(?:ryzen\s?|r)([3579])\s?(?:pro\s?)?(\d{4})([a-z0-9]{0,4})\b/);
  if (ryzen && (/ryzen/.test(f) || /\br[3579]\s?\d{4}/.test(f))) {
    const tier = Number(ryzen[1]);
    const series = Number(ryzen[2][0]);
    const suffix = ryzen[3] ?? "";
    const base = nearest(RYZEN[tier], series);
    if (base === null) return null;
    const factor = mobileFactor(suffix);
    return cpu(`AMD Ryzen ${tier} ${ryzen[2]}${suffix.toUpperCase()}`, base * factor, factor < 1);
  }

  const e3 = f.match(/\bxeon\s?e3[\s-]?12\d\d\s?(?:l\s?)?(?:v(\d))?/);
  if (e3) return cpu(`Intel Xeon E3${e3[1] ? ` v${e3[1]}` : ""}`, XEON_E3[Number(e3[1] ?? 1)] ?? 7);
  const e5 = f.match(/\bxeon\s?e5[\s-]?2\d{3}\s?(?:v(\d))?/);
  if (e5) return cpu(`Intel Xeon E5${e5[1] ? ` v${e5[1]}` : ""}`, XEON_E5[Number(e5[1] ?? 1)] ?? 13);

  const fx = f.match(/\bfx[\s-]?(\d)(\d{3})\b/);
  if (fx && FX[Number(fx[1])]) return cpu(`AMD FX-${fx[1]}${fx[2]}`, FX[Number(fx[1])]);
  if (/phenom\s?ii\s?x4/.test(f)) return cpu("AMD Phenom II X4", 2.8);
  if (/phenom\s?ii\s?x6/.test(f)) return cpu("AMD Phenom II X6", 3.8);
  if (/athlon\s?(?:silver\s?)?3000g/.test(f)) return cpu("AMD Athlon 3000G", 4.5);
  if (/core\s?2\s?quad/.test(f)) return cpu("Intel Core 2 Quad", 2.4);
  if (/core\s?2\s?duo/.test(f)) return cpu("Intel Core 2 Duo", 1.2);
  if (/pentium\s?gold/.test(f)) return cpu("Intel Pentium Gold", 4);
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
  "Intel Core Ultra 9 285K", "Intel Core Ultra 7 265K", "Intel Core Ultra 5 245K", "Intel Core Ultra 5 225F",
  "Intel Core Ultra 9 275HX", "Intel Core Ultra 7 255H", "Intel Core Ultra 7 258V", "Intel Core Ultra 5 226V",
  "Intel Core Ultra 9 185H", "Intel Core Ultra 7 155H", "Intel Core Ultra 5 125H", "Intel Core Ultra 7 155U",
  "Intel Core 7 150U", "Intel Core 5 120U", "Intel Core 7 240H",
  "Intel Core i9-14900K", "Intel Core i7-14700K", "Intel Core i5-14600K", "Intel Core i5-14400F", "Intel Core i9-14900HX",
  "Intel Core i7-14650HX", "Intel Core i9-13900K", "Intel Core i7-13700K", "Intel Core i5-13600K", "Intel Core i5-13400F",
  "Intel Core i9-13980HX", "Intel Core i7-13700H", "Intel Core i7-13620H", "Intel Core i5-13500H", "Intel Core i5-13420H",
  "Intel Core i7-1355U", "Intel Core i5-1335U",
  "Intel Core i9-12900K", "Intel Core i7-12700K", "Intel Core i5-12600K", "Intel Core i5-12400F", "Intel Core i3-12100F",
  "Intel Core i9-12900H", "Intel Core i7-12700H", "Intel Core i5-12500H", "Intel Core i5-12450H", "Intel Core i5-1235U",
  "Intel Core i7-11700K", "Intel Core i5-11400F", "Intel Core i7-11800H", "Intel Core i5-11400H", "Intel Core i7-1165G7",
  "Intel Core i5-1135G7",
  "Intel Core i9-10900K", "Intel Core i7-10700K", "Intel Core i5-10400F", "Intel Core i3-10100F", "Intel Core i7-10750H",
  "Intel Core i5-10300H", "Intel Core i5-10210U",
  "Intel Core i9-9900K", "Intel Core i7-9700K", "Intel Core i5-9600K", "Intel Core i5-9400F", "Intel Core i7-9750H",
  "Intel Core i5-9300H", "Intel Core i7-8700K", "Intel Core i5-8400", "Intel Core i3-8100", "Intel Core i7-8750H",
  "Intel Core i5-8250U", "Intel Core i7-7700K", "Intel Core i5-7400", "Intel Core i7-7700HQ", "Intel Core i7-6700K",
  "Intel Core i5-6600K", "Intel Core i7-6700HQ",
  "Intel Core i7-4790K", "Intel Core i5-4690K", "Intel Core i5-4460", "Intel Core i7-3770K", "Intel Core i5-3470",
  "Intel Core i7-2600K", "Intel Core i5-2500K", "Intel Xeon E3-1230 v3",
  "AMD Ryzen 9 9950X3D", "AMD Ryzen 9 9950X", "AMD Ryzen 9 9900X", "AMD Ryzen 7 9800X3D", "AMD Ryzen 7 9700X", "AMD Ryzen 5 9600X",
  "AMD Ryzen AI Max+ 395", "AMD Ryzen AI 9 HX 370", "AMD Ryzen AI 9 365", "AMD Ryzen AI 7 350", "AMD Ryzen AI 5 340",
  "AMD Ryzen 9 8945HS", "AMD Ryzen 7 8845HS", "AMD Ryzen 7 8700G", "AMD Ryzen 5 8600G", "AMD Ryzen 5 8645HS",
  "AMD Ryzen 9 7950X3D", "AMD Ryzen 9 7950X", "AMD Ryzen 9 7900X", "AMD Ryzen 7 7800X3D", "AMD Ryzen 7 7700X", "AMD Ryzen 5 7600X",
  "AMD Ryzen 5 7600", "AMD Ryzen 9 7945HX", "AMD Ryzen 9 7940HS", "AMD Ryzen 7 7840HS", "AMD Ryzen 7 7735HS",
  "AMD Ryzen 5 7640HS", "AMD Ryzen 5 7535HS", "AMD Ryzen 7 7730U", "AMD Ryzen 5 7520U",
  "AMD Ryzen 9 6900HX", "AMD Ryzen 7 6800H", "AMD Ryzen 5 6600H",
  "AMD Ryzen 9 5950X", "AMD Ryzen 9 5900X", "AMD Ryzen 7 5800X3D", "AMD Ryzen 7 5800X", "AMD Ryzen 7 5700X",
  "AMD Ryzen 5 5600X", "AMD Ryzen 5 5600", "AMD Ryzen 5 5500", "AMD Ryzen 7 5700G", "AMD Ryzen 5 5600G",
  "AMD Ryzen 9 5900HX", "AMD Ryzen 7 5800H", "AMD Ryzen 5 5600H", "AMD Ryzen 7 5700U", "AMD Ryzen 5 5500U",
  "AMD Ryzen 9 4900HS", "AMD Ryzen 7 4800H", "AMD Ryzen 5 4600H", "AMD Ryzen 7 4700U", "AMD Ryzen 5 4500U",
  "AMD Ryzen 9 3900X", "AMD Ryzen 7 3700X", "AMD Ryzen 5 3600", "AMD Ryzen 3 3300X", "AMD Ryzen 3 3100", "AMD Ryzen 5 3550H",
  "AMD Ryzen 7 2700X", "AMD Ryzen 5 2600", "AMD Ryzen 5 2400G", "AMD Ryzen 7 1700", "AMD Ryzen 5 1600", "AMD Ryzen 3 1200",
  "AMD FX-8350", "AMD FX-6300",
  "AMD Ryzen Z2 Extreme", "AMD Ryzen Z1 Extreme", "AMD Ryzen Z1", "Steam Deck APU",
  "Apple M5", "Apple M4 Max", "Apple M4 Pro", "Apple M4", "Apple M3 Max", "Apple M3 Pro", "Apple M3", "Apple M2 Pro", "Apple M2",
  "Apple M1 Pro", "Apple M1", "Snapdragon X Elite", "Snapdragon X Plus",
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
function comparePart(part: "CPU" | "GPU", yours: HardwareMatch | null, yoursText: string, needed: string | null): Part {
  const easiest = needed ? easiestOf(part, needed) : null;
  return {
    part,
    yours: yours?.name ?? (yoursText.trim() || "Not set"),
    needed: easiest?.name ?? needed,
    ok: yours && easiest ? yours.score >= easiest.score : null,
  };
}

function easiestOf(part: "CPU" | "GPU", needed: string): HardwareMatch | null {
  const options = part === "GPU" ? matchGpus(needed) : matchCpus(needed);
  return options.length ? options.reduce((low, m) => (m.score < low.score ? m : low)) : null;
}

interface Yours {
  cpu: HardwareMatch | null;
  gpu: HardwareMatch | null;
}

function compareTier(specs: UserPcSpecs, yours: Yours, tier: PcRequirementTier): { parts: Part[]; met: boolean | null } {
  const ramOk = tier.ramGb !== null && specs.ramGb > 0 ? specs.ramGb >= tier.ramGb : null;
  const parts: Part[] = [
    comparePart("CPU", yours.cpu, specs.cpu ?? "", tier.cpu),
    comparePart("GPU", yours.gpu, specs.gpu ?? "", tier.gpu),
    {
      part: "RAM",
      yours: specs.ramGb > 0 ? `${specs.ramGb} GB` : "Not set",
      needed: tier.ramGb !== null ? `${tier.ramGb} GB` : null,
      ok: ramOk,
    },
  ];
  // Video memory only when both sides are known: a guess never fails a game.
  if (tier.vramGb && specs.vramGb) {
    parts.push({ part: "VRAM", yours: `${specs.vramGb} GB`, needed: `${tier.vramGb} GB`, ok: specs.vramGb >= tier.vramGb });
  }
  if (parts.some((p) => p.ok === false)) return { parts, met: false };
  // Passing on RAM alone says nothing about whether the game runs.
  const comparable = parts.filter((p) => (p.part === "CPU" || p.part === "GPU") && p.ok !== null).length;
  return { parts, met: comparable > 0 ? true : null };
}

const shortfall = (parts: Part[]) => parts.filter((p) => p.ok === false).map((p) => p.part);

function listParts(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/* --- Resolution and settings outlook ------------------------------------- */

/*
 * How much GPU a resolution / frame rate / preset asks for, relative to the
 * publisher's *recommended* tier, which in practice targets 1080p, High,
 * ~60 fps. Resolution costs grow slower than pixel count (1440p is 1.78× the
 * pixels of 1080p but ~1.7× the work; 4K 4× the pixels, ~3.4×), and presets
 * from Low to Max span roughly 2.5×. Upscaling (DLSS/FSR) narrows all of this
 * and is mentioned where it matters rather than assumed.
 */
const RES_COST: Record<PcResolution, number> = { "720p": 0.55, "1080p": 1, "1440p": 1.7, "4k": 3.4 };
const FPS_COST: Record<PcGoal["fps"], number> = { 30: 0.55, 60: 1, 120: 1.9 };
const QUALITY_COST: Record<PcQuality, number> = { low: 0.55, medium: 0.75, high: 1, max: 1.35 };
export const RES_LABEL: Record<PcResolution, string> = { "720p": "720p", "1080p": "1080p", "1440p": "1440p", "4k": "4K" };
export const QUALITY_LABEL: Record<PcQuality, string> = { low: "Low", medium: "Medium", high: "High", max: "Max" };
/** Minimum specs are usually 720p–1080p Low at ~30 fps: ≈ 45% of recommended. */
const MIN_TO_REC = 2.2;

const goalCost = (goal: PcGoal) => RES_COST[goal.resolution] * FPS_COST[goal.fps] * QUALITY_COST[goal.quality];
const sameGoal = (a: PcGoal, b: PcGoal) => a.resolution === b.resolution && a.fps === b.fps && a.quality === b.quality;
const goalLabel = (goal: PcGoal) => `${RES_LABEL[goal.resolution]} ${QUALITY_LABEL[goal.quality]}`;

function level(ratio: number): HardwareOutlook["level"] {
  if (ratio >= 1.15) return "great";
  if (ratio >= 0.9) return "ok";
  if (ratio >= 0.6) return "lower";
  return "no";
}

const PHRASE: Record<HardwareOutlook["level"], string> = {
  great: "runs well",
  ok: "should hold up",
  lower: "is a stretch",
  no: "is out of reach",
};

/** The rows worth showing for this reader, cheapest first. */
function ladder(specs: UserPcSpecs): PcGoal[] {
  let rows: PcGoal[];
  if (specs.formFactor === "handheld") {
    rows = [
      { resolution: "720p", fps: 30, quality: "medium" },
      { resolution: "720p", fps: 60, quality: "high" },
      { resolution: "1080p", fps: 60, quality: "medium" },
    ];
  } else if (specs.display && specs.display.resolution !== "720p") {
    // A known screen: compare presets at its own resolution (and its refresh, if high).
    const resolution = specs.display.resolution;
    rows = (["medium", "high", "max"] as const).map((quality) => ({ resolution, fps: 60 as const, quality }));
    if ((specs.display.refreshHz ?? 60) >= 120) rows.push({ resolution, fps: 120, quality: "high" });
  } else {
    rows = (["1080p", "1440p", "4k"] as const).map((resolution) => ({ resolution, fps: 60 as const, quality: "high" as const }));
  }
  if (specs.goal && !rows.some((row) => sameGoal(row, specs.goal!))) rows.push(specs.goal);
  return rows.sort((a, b) => goalCost(a) - goalCost(b));
}

/** Cheaper settings to suggest when nothing on the ladder runs well. */
const FALLBACKS: PcGoal[] = [
  { resolution: "1080p", fps: 60, quality: "medium" },
  { resolution: "1080p", fps: 60, quality: "low" },
  { resolution: "720p", fps: 60, quality: "low" },
  { resolution: "720p", fps: 30, quality: "low" },
];

function headlineFrom(rows: HardwareOutlook[], judge: (goal: PcGoal) => HardwareOutlook["level"]): string | undefined {
  if (rows.length === 0) return undefined;
  const lastGreat = rows.map((row) => row.level).lastIndexOf("great");
  if (lastGreat === -1) {
    const first = rows[0];
    // Say what *would* work rather than only what won't.
    const cheaper = FALLBACKS.filter((goal) => goalLabel(goal) !== first.label).find((goal) => ["great", "ok"].includes(judge(goal)));
    const tail = cheaper ? `; ${goalLabel(cheaper)}${cheaper.fps !== first.fps ? ` · ${cheaper.fps} fps` : ""} ${PHRASE[judge(cheaper)]}` : "";
    return `${first.label} ${PHRASE[first.level]}${tail}.`;
  }
  const next = rows.slice(lastGreat + 1).find((row) => row.level !== "great");
  const best = rows[lastGreat];
  if (!next) return `Runs well, even at ${best.label}${best.fps > 60 ? ` · ${best.fps} fps` : ""}.`;
  return `Runs well at ${best.label}; ${next.label}${next.fps !== best.fps ? ` · ${next.fps} fps` : ""} ${PHRASE[next.level]}.`;
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
 *
 * On top of the kind: an `outlook` per resolution/preset (from the GPU's
 * headroom over the recommended card), a `headline` built from it, and
 * `reasons` — the caveats that change what the reader should expect.
 */
export function evaluateHardware(specs: UserPcSpecs, req: PcRequirements | null | undefined): HardwareVerdict {
  const unknown = (parts: Part[] = [], summary = "We couldn't compare your PC with this game's requirements.") => ({
    kind: "unknown" as const,
    parts,
    summary,
  });
  if (!req || (!req.minimum && !req.recommended)) return unknown([], "This game doesn't list PC requirements on Steam.");

  const yours: Yours = {
    cpu: matchCpu(specs.cpu ?? ""),
    gpu: matchGpu(specs.gpu ?? "", { laptop: specs.formFactor === "laptop" }),
  };
  const rec = req.recommended ? compareTier(specs, yours, req.recommended) : null;
  const min = req.minimum ? compareTier(specs, yours, req.minimum) : null;

  let verdict: HardwareVerdict;
  if (rec?.met === true) {
    verdict = { kind: "great", parts: rec.parts, summary: "Your PC meets the recommended specs." };
  } else if (min?.met === true) {
    const short = rec ? shortfall(rec.parts) : [];
    verdict = {
      kind: "ok",
      parts: rec && short.length ? rec.parts : min.parts,
      summary: short.length
        ? `Meets the minimum specs; your ${listParts(short)} ${short.length > 1 ? "are" : "is"} below recommended.`
        : "Meets the minimum specs.",
    };
  } else if (min?.met === false) {
    const short = shortfall(min.parts);
    verdict = {
      kind: "below",
      parts: min.parts,
      summary: `Your ${listParts(short)} ${short.length > 1 ? "fall" : "falls"} short of the minimum specs.`,
    };
  } else {
    // No usable minimum tier: failing the recommended one says nothing about running at all.
    return unknown((min ?? rec)?.parts ?? []);
  }

  const storage = storagePart(specs, req);
  if (storage) verdict.parts = [...verdict.parts, storage];

  // The outlook needs a GPU on both sides.
  const recGpu = req.recommended?.gpu ? easiestOf("GPU", req.recommended.gpu) : null;
  const minGpu = req.minimum?.gpu ? easiestOf("GPU", req.minimum.gpu) : null;
  const baseline = recGpu ? recGpu.score : minGpu ? minGpu.score * MIN_TO_REC : null;
  const reasons: string[] = [];
  if (yours.gpu && baseline && verdict.kind !== "below") {
    const gpuScore = yours.gpu.score;
    const judge = (goal: PcGoal) => level(gpuScore / (baseline * goalCost(goal)));
    const outlook = ladder(specs).map((goal): HardwareOutlook => {
      return {
        label: goalLabel(goal),
        fps: goal.fps,
        level: judge(goal),
        ...(specs.goal && sameGoal(goal, specs.goal) ? { goal: true as const } : {}),
      };
    });
    verdict.outlook = outlook;
    verdict.headline = headlineFrom(outlook, judge);
    const goalRow = outlook.find((row) => row.goal);
    if (goalRow && goalRow.level !== "great") {
      reasons.push(
        goalRow.level === "ok"
          ? `Your goal (${goalRow.label}, ${goalRow.fps} fps) is within reach, with little headroom — upscaling (DLSS/FSR) helps.`
          : `Your goal (${goalRow.label}, ${goalRow.fps} fps) asks more than your graphics card has — lower the preset or use upscaling.`,
      );
    }
  }
  reasons.push(...caveats(specs, yours, req));
  if (reasons.length) verdict.reasons = reasons.slice(0, 4);
  return verdict;
}

/** Free space and drive type, when the reader told us and the game says. */
function storagePart(specs: UserPcSpecs, req: PcRequirements): Part | null {
  const tier = req.recommended ?? req.minimum;
  const needGb = req.minimum?.storageGb ?? req.recommended?.storageGb ?? null;
  const ssd = /\bssd\b/i.test(`${req.minimum?.raw ?? ""} ${req.recommended?.raw ?? ""}`);
  if (!tier || (!needGb && !ssd) || (specs.freeStorageGb === undefined && !specs.storage)) return null;
  const spaceOk = needGb && specs.freeStorageGb !== undefined ? specs.freeStorageGb >= needGb : null;
  const driveOk = ssd && specs.storage ? specs.storage !== "hdd" : null;
  return {
    part: "Storage" as HardwarePart,
    yours: [specs.storage ? STORAGE_LABEL[specs.storage] : null, specs.freeStorageGb !== undefined ? `${specs.freeStorageGb} GB free` : null]
      .filter(Boolean)
      .join(" · "),
    needed: [needGb ? `${needGb} GB` : null, ssd ? "SSD" : null].filter(Boolean).join(" · "),
    ok: spaceOk === false || driveOk === false ? false : spaceOk ?? driveOk,
  };
}

export const STORAGE_LABEL: Record<NonNullable<UserPcSpecs["storage"]>, string> = {
  nvme: "NVMe SSD",
  "sata-ssd": "SATA SSD",
  hdd: "Hard drive",
};

/** What changes the picture beyond "fast enough", most important first. */
function caveats(specs: UserPcSpecs, yours: Yours, req: PcRequirements): string[] {
  const out: string[] = [];
  const rec = req.recommended;
  const min = req.minimum;

  // Video memory: the recommended figure, or resolution pressure at 4K.
  const vramNeed = rec?.vramGb ?? null;
  if (specs.vramGb && vramNeed && specs.vramGb < vramNeed && (!min?.vramGb || specs.vramGb >= min.vramGb)) {
    out.push(`${specs.vramGb} GB of video memory is below the ${vramNeed} GB recommended — keep textures at Medium.`);
  } else if (specs.vramGb && specs.vramGb <= 8 && (specs.goal?.resolution === "4k" || specs.display?.resolution === "4k")) {
    out.push(`${specs.vramGb} GB of video memory is tight at 4K; textures may need to come down.`);
  }

  // A processor below recommended, or one that will cap a high-refresh goal.
  const recCpu = rec?.cpu ? easiestOf("CPU", rec.cpu) : null;
  if (yours.cpu && recCpu) {
    if (yours.cpu.score < recCpu.score) out.push("Your processor is below recommended — expect dips in busy scenes.");
    else if (specs.goal?.fps === 120 && yours.cpu.score < recCpu.score * 1.6) out.push("At 120 fps your processor, not your graphics card, will likely set the limit.");
  }

  const need = min?.storageGb ?? rec?.storageGb ?? null;
  if (need && specs.freeStorageGb !== undefined && specs.freeStorageGb < need) {
    out.push(`Needs ${need} GB of space; you have ${specs.freeStorageGb} GB free.`);
  }
  if (specs.storage === "hdd" && /\bssd\b/i.test(`${min?.raw ?? ""} ${rec?.raw ?? ""}`)) {
    out.push("This game asks for an SSD — from a hard drive expect long loads and stutter.");
  }

  if (specs.formFactor === "laptop" || yours.gpu?.laptop) {
    out.push("Laptop graphics vary a lot with power limits: plug in and use the performance mode for these results.");
  }
  if (specs.os === "macos") out.push("These are Windows requirements. On a Mac, check the store for a macOS version or use cloud play.");
  else if (specs.os === "linux" || specs.os === "steamos") out.push("On Linux this runs through Proton — check the Linux rating below.");
  return out;
}
