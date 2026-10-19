/**
 * Generates the installable-app artwork from the brand mark.
 *
 *   npx tsx scripts/generate-pwa-assets.ts                 # icons + splash images
 *   npx tsx scripts/generate-pwa-assets.ts --screenshots http://localhost:4000
 *                                                          # also capture manifest screenshots
 *
 * Writes (all committed; nothing here runs at build or request time):
 *   public/icons/icon-{192,512}.png          purpose "any"   — rounded tile with a margin
 *   public/icons/maskable-{192,512}.png      purpose "maskable" — full bleed, glyph inside the 80% safe circle
 *   public/icons/monochrome-512.png          purpose "monochrome" — white glyph on transparent (themed icons)
 *   public/icons/shortcut-*.png              manifest shortcut icons
 *   public/splash/apple-splash-*.png         iOS startup images (see src/components/pwa/splash-screens.ts)
 *   src/app/apple-icon.png                   180×180 home-screen icon for iOS (iOS rounds it itself)
 *   src/app/favicon.ico                      16/32/48 for browsers and tools that only read .ico
 *   public/screenshots/*.jpg                 with --screenshots: richer install UI on Android/desktop
 *
 * Why a headless browser rather than an image library: the mark is SVG, and
 * Chromium rasterises SVG (gradients, anti-aliasing) exactly as the browser
 * draws the live favicon, with no new dependency — playwright-core is already
 * a devDependency. Set PWA_BROWSER to a Chromium-family executable if the
 * auto-detected one isn't installed.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright-core";
import {
  APP_BACKGROUND,
  MARK_GLYPH_PATH,
  MARK_GRADIENT_FROM,
  MARK_GRADIENT_TO,
  MARK_TILE_RADIUS,
  SPLASH_MARK_SIZE,
} from "../src/components/pwa/brand-mark";
import { splashImages } from "../src/components/pwa/splash-screens";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (...parts: string[]) => {
  const file = join(ROOT, ...parts);
  mkdirSync(dirname(file), { recursive: true });
  return file;
};

// ---------------------------------------------------------------------------
// SVG builders
// ---------------------------------------------------------------------------

interface MarkOptions {
  /** Canvas size in px. */
  size: number;
  /** Tile edge as a fraction of the canvas (1 = full bleed). */
  tile?: number;
  /** Rounded tile corners (false for maskable / apple, which the OS masks). */
  rounded?: boolean;
  /** Glyph scale relative to its native size inside the tile. */
  glyph?: number;
  /** White glyph only, transparent everywhere else. */
  mono?: boolean;
}

function markSvg({ size, tile = 1, rounded = true, glyph = 1, mono = false }: MarkOptions): string {
  const tilePx = size * tile;
  const offset = (size - tilePx) / 2;
  const scale = tilePx / 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${MARK_GRADIENT_FROM}"/>
      <stop offset="1" stop-color="${MARK_GRADIENT_TO}"/>
    </linearGradient>
  </defs>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    ${mono ? "" : `<rect width="64" height="64" rx="${rounded ? MARK_TILE_RADIUS : 0}" fill="url(#g)"/>`}
    <g transform="translate(32 32) scale(${glyph}) translate(-32 -32)">
      <path d="${MARK_GLYPH_PATH}" fill="#fff"/>
    </g>
  </g>
</svg>`;
}

/** Black launch screen with the tile centred at SPLASH_MARK_SIZE CSS px. */
function splashSvg(width: number, height: number, ratio: number): string {
  const tilePx = SPLASH_MARK_SIZE * ratio;
  const x = (width - tilePx) / 2;
  const y = (height - tilePx) / 2;
  const scale = tilePx / 64;
  // Deliberately flat: a soft halo here would dither into ~300 KB per file.
  // The in-app splash (LaunchSplash) starts from exactly this frame and blooms
  // its halo in as part of the animation, so the handover stays seamless.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${MARK_GRADIENT_FROM}"/>
      <stop offset="1" stop-color="${MARK_GRADIENT_TO}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="${APP_BACKGROUND}"/>
  <g transform="translate(${x} ${y}) scale(${scale})">
    <rect width="64" height="64" rx="${MARK_TILE_RADIUS}" fill="url(#g)"/>
    <path d="${MARK_GLYPH_PATH}" fill="#fff"/>
  </g>
</svg>`;
}

type IconNode = [string, Record<string, string>][];

async function lucideNode(name: string): Promise<IconNode> {
  // Deep file import: lucide's package exports don't expose per-icon modules,
  // but each one carries its raw `__iconNode`, which is all we need.
  const file = join(ROOT, "node_modules/lucide-react/dist/esm/icons", `${name}.mjs`);
  const mod = (await import(pathToFileURL(file).href)) as { __iconNode: IconNode };
  return mod.__iconNode;
}

/** Shortcut icon: full-bleed gradient (Android masks it to a circle) + white Lucide glyph. */
function shortcutSvg(size: number, node: IconNode): string {
  const glyphPx = size * 0.46;
  const offset = (size - glyphPx) / 2;
  const children = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${MARK_GRADIENT_FROM}"/>
      <stop offset="1" stop-color="${MARK_GRADIENT_TO}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <svg x="${offset}" y="${offset}" width="${glyphPx}" height="${glyphPx}" viewBox="0 0 24 24" fill="none"
       stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>
</svg>`;
}

// ---------------------------------------------------------------------------
// Rasterising
// ---------------------------------------------------------------------------

function findBrowser(): string | undefined {
  const candidates = [
    process.env.PWA_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p): p is string => Boolean(p && existsSync(p)));
}

async function rasterise(browser: Browser, svg: string, width: number, height: number, transparent: boolean) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
  );
  const png = await page.screenshot({
    type: "png",
    omitBackground: transparent,
    clip: { x: 0, y: 0, width, height },
  });
  await page.close();
  return png;
}

/** Packs PNG frames into an .ico (PNG-in-ICO is supported by every current browser and Windows). */
function ico(frames: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + frames.length * 16;
  for (const { size, png } of frames) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

// ---------------------------------------------------------------------------
// Screenshots (optional)
// ---------------------------------------------------------------------------

async function captureScreenshots(browser: Browser, baseUrl: string) {
  const shots = [
    { name: "home-narrow", path: "/", viewport: { width: 390, height: 844 }, scale: 2, mobile: true },
    { name: "upcoming-narrow", path: "/upcoming", viewport: { width: 390, height: 844 }, scale: 2, mobile: true },
    { name: "home-wide", path: "/", viewport: { width: 1440, height: 900 }, scale: 1, mobile: false },
    { name: "upcoming-wide", path: "/upcoming", viewport: { width: 1440, height: 900 }, scale: 1, mobile: false },
  ];
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: shot.viewport,
      deviceScaleFactor: shot.scale,
      isMobile: shot.mobile,
      hasTouch: shot.mobile,
      colorScheme: "dark",
      // Final, settled frames — not reveals caught half-way.
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(new URL(shot.path, baseUrl).href, { waitUntil: "load", timeout: 120_000 });
    // Hide the Next.js dev indicator if this is a dev server.
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.waitForTimeout(3500);
    const file = out("public", "screenshots", `${shot.name}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 82 });
    console.log("screenshot", file);
    await context.close();
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const executablePath = findBrowser();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const write = (file: string, data: Buffer) => {
      writeFileSync(file, data);
      console.log("wrote", file.replace(ROOT, "."), `${(data.length / 1024).toFixed(1)} KB`);
    };

    for (const size of [192, 512]) {
      write(out("public/icons", `icon-${size}.png`), await rasterise(browser, markSvg({ size, tile: 0.9 }), size, size, true));
      // Glyph at 0.8× keeps its corners inside the maskable safe circle (radius 40%).
      write(
        out("public/icons", `maskable-${size}.png`),
        await rasterise(browser, markSvg({ size, rounded: false, glyph: 0.8 }), size, size, false),
      );
    }
    write(
      out("public/icons", "monochrome-512.png"),
      await rasterise(browser, markSvg({ size: 512, mono: true, glyph: 0.8 }), 512, 512, true),
    );

    // iOS draws its own rounded mask and fills transparency with black, so full bleed.
    write(out("src/app", "apple-icon.png"), await rasterise(browser, markSvg({ size: 180, rounded: false }), 180, 180, false));

    const frames = [];
    for (const size of [16, 32, 48]) {
      frames.push({ size, png: await rasterise(browser, markSvg({ size }), size, size, true) });
    }
    write(out("src/app", "favicon.ico"), ico(frames));

    const shortcuts: [string, string][] = [
      ["today", "sunrise"],
      ["upcoming", "calendar-clock"],
      ["library", "library-big"],
      ["search", "search"],
      ["stats", "chart-column"],
    ];
    for (const [name, icon] of shortcuts) {
      const node = await lucideNode(icon);
      write(out("public/icons", `shortcut-${name}.png`), await rasterise(browser, shortcutSvg(192, node), 192, 192, false));
    }

    for (const image of splashImages()) {
      write(
        out("public", image.url.slice(1)),
        await rasterise(
          browser,
          splashSvg(image.pixelWidth, image.pixelHeight, image.ratio),
          image.pixelWidth,
          image.pixelHeight,
          false,
        ),
      );
    }

    const shotsFlag = process.argv.indexOf("--screenshots");
    if (shotsFlag !== -1) {
      const base = process.argv[shotsFlag + 1] ?? "http://localhost:3000";
      await captureScreenshots(browser, base);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
