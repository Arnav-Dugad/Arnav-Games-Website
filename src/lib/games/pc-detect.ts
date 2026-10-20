/**
 * What the browser can honestly tell us about the reader's PC, for "We
 * detected… Is this right?" in My PC. Every figure here is approximate and
 * is only ever *offered* — the reader confirms or corrects it; nothing is
 * saved or assumed without them.
 *
 *  - Graphics: WebGL's unmasked renderer string (`WEBGL_debug_renderer_info`)
 *    names the card on most Chromium/Firefox setups. Safari reports a generic
 *    "Apple GPU"; privacy modes may hide it; laptops can report the
 *    integrated chip instead of the discrete one. WebGPU's adapter info is a
 *    fallback that sometimes carries a description.
 *  - Processor: only the thread count (`hardwareConcurrency`) — browsers never
 *    expose the model. It's shown as a hint, not a match.
 *  - Memory: `navigator.deviceMemory` is rounded and capped at 8 GB, so 8
 *    means "8 GB or more".
 *  - Screen: physical pixels from `screen` × devicePixelRatio, mapped to the
 *    nearest gaming resolution; refresh rate measured from a short burst of
 *    animation frames.
 *  - System: UA Client Hints (`getHighEntropyValues`), else the user agent.
 *  - Form factor: a battery that isn't permanently full suggests a laptop;
 *    Steam Deck / handheld APUs are recognised by their GPU.
 */

import { matchGpu } from "./hardware";
import type { PcFormFactor, PcOs, PcResolution } from "./types";

export interface DetectedPc {
  /** The renderer string we read, cleaned up ("NVIDIA GeForce RTX 3060"). */
  gpuText: string | null;
  /** What `matchGpu` recognised in it. */
  gpu: { name: string; laptop: boolean } | null;
  /** Logical processors the browser sees. */
  threads: number | null;
  /** `deviceMemory`: approximate, capped at 8. */
  memoryGb: number | null;
  display: { resolution: PcResolution; width: number; height: number; refreshHz: number | null } | null;
  os: PcOs | null;
  formFactor: PcFormFactor | null;
}

/** "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)" → the card. */
export function cleanRenderer(raw: string): string {
  const angle = /^ANGLE \(([^,]*),\s*(.+?)(?:,\s*[^,]*\))?$/.exec(raw.trim());
  const inner = angle ? angle[2] : raw;
  return inner
    .replace(/ANGLE Metal Renderer:\s*/i, "")
    .replace(/\(0x[0-9a-f]+\)/gi, "")
    .replace(/\b(Direct3D\d*|D3D\d+|vs_\d_\d|ps_\d_\d|OpenGL.*|Vulkan.*|Unspecified Version)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,]+$/, "")
    .trim();
}

function webglRenderer(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return raw || null;
  } catch {
    return null;
  }
}

async function webgpuDescription(): Promise<string | null> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { description?: string; vendor?: string } } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    const description = adapter?.info?.description?.trim();
    return description || null;
  } catch {
    return null;
  }
}

/** The nearest common gaming resolution to a screen's physical pixels. */
function nearestResolution(width: number, height: number): PcResolution {
  const pixels = width * height;
  if (pixels >= 3840 * 2160 * 0.8) return "4k";
  if (pixels >= 2560 * 1440 * 0.8) return "1440p";
  if (pixels >= 1920 * 1080 * 0.75) return "1080p";
  return "720p";
}

/** Median frame interval over ~20 frames → Hz, snapped to common rates. */
function measureRefresh(): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function" || document.hidden) return resolve(null);
    const stamps: number[] = [];
    const step = (time: number) => {
      stamps.push(time);
      if (stamps.length < 21) requestAnimationFrame(step);
      else {
        const gaps = stamps.slice(1).map((t, i) => t - stamps[i]).sort((a, b) => a - b);
        const hz = 1000 / gaps[Math.floor(gaps.length / 2)];
        const common = [30, 48, 60, 75, 90, 100, 120, 144, 165, 175, 200, 240, 360];
        const snapped = common.reduce((best, rate) => (Math.abs(rate - hz) < Math.abs(best - hz) ? rate : best), 60);
        resolve(Math.abs(snapped - hz) / hz < 0.08 ? snapped : null);
      }
    };
    requestAnimationFrame(step);
    // Background tabs throttle frames; give up rather than report nonsense.
    setTimeout(() => resolve(null), 1500);
  });
}

async function detectOs(): Promise<PcOs | null> {
  const ua = navigator.userAgent;
  if (/steam ?deck|steamos/i.test(ua)) return "steamos";
  try {
    const hints = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    const platform = hints?.platform?.toLowerCase() ?? "";
    if (platform.includes("windows")) return "windows";
    if (platform.includes("mac")) return "macos";
    if (platform.includes("linux") || platform.includes("chrome os")) return "linux";
  } catch {
    /* fall through to the user agent */
  }
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/Linux|X11/.test(ua) && !/Android/.test(ua)) return "linux";
  return null;
}

async function batteryHint(): Promise<boolean | null> {
  try {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; dischargingTime: number }> }).getBattery;
    if (!getBattery) return null;
    const battery = await getBattery.call(navigator);
    // Desktops report a permanently full, "charging" battery.
    return battery.level < 1 || !battery.charging || Number.isFinite(battery.dischargingTime);
  } catch {
    return null;
  }
}

export async function detectPc(): Promise<DetectedPc> {
  const renderer = webglRenderer();
  let gpuText = renderer ? cleanRenderer(renderer) : null;
  if (!gpuText || !matchGpu(gpuText)) gpuText = (await webgpuDescription()) ?? gpuText;
  const match = gpuText ? matchGpu(gpuText) : null;

  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(window.screen.width * dpr);
  const height = Math.round(window.screen.height * dpr);
  const [refreshHz, os, onBattery] = await Promise.all([measureRefresh(), detectOs(), batteryHint()]);

  const handheld = match?.name === "Steam Deck" || /ROG Ally/.test(match?.name ?? "");
  const formFactor: PcFormFactor | null = handheld ? "handheld" : match?.laptop || onBattery ? "laptop" : onBattery === false ? "desktop" : null;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  return {
    gpuText,
    gpu: match ? { name: match.name, laptop: Boolean(match.laptop) } : null,
    threads: navigator.hardwareConcurrency || null,
    memoryGb: typeof memory === "number" && memory > 0 ? memory : null,
    display: width > 0 && height > 0 ? { resolution: nearestResolution(Math.max(width, height), Math.min(width, height)), width, height, refreshHz } : null,
    os,
    formFactor,
  };
}
