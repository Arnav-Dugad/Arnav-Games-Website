"use client";

/**
 * The SVG filter behind the "liquid glass" lenses, inlined once for the app.
 *
 * Real glass bends light most at its rim. The displacement map below encodes
 * exactly that: neutral grey (no shift) across the middle of the element,
 * ramping toward full red/green at the edges, so pixels near a lens's border
 * are sampled from slightly further inside — the backdrop appears to curve
 * over the edge like a bead of glass. It is stretched to each element's box
 * (`objectBoundingBox` units), so one filter fits every pill shape.
 *
 * Only Chromium renders `url()` filters inside `backdrop-filter`; Safari and
 * Firefox parse the declaration but drop it, which would leave the lens with
 * no blur at all. So the CSS hook (`.liquid-lens`, see globals.css) is gated
 * behind `data-liquid-glass` on <html>, set here after a capability check.
 * Everywhere else the lenses keep their existing tint and nothing changes.
 */

import { useEffect } from "react";

// Red ramps horizontally, green vertically; 0x80 is "no displacement".
// Screen-blending two single-channel layers adds them without clipping.
const MAP = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200' preserveAspectRatio='none'>" +
    "<linearGradient id='x' x1='0' x2='1' y1='0' y2='0'>" +
    "<stop offset='0' stop-color='#f00'/><stop offset='.2' stop-color='#800000'/>" +
    "<stop offset='.8' stop-color='#800000'/><stop offset='1' stop-color='#000'/></linearGradient>" +
    "<linearGradient id='y' x1='0' x2='0' y1='0' y2='1'>" +
    "<stop offset='0' stop-color='#0f0'/><stop offset='.28' stop-color='#008000'/>" +
    "<stop offset='.72' stop-color='#008000'/><stop offset='1' stop-color='#000'/></linearGradient>" +
    "<rect width='200' height='200' fill='url(#x)'/>" +
    "<rect width='200' height='200' fill='url(#y)' style='mix-blend-mode:screen'/>" +
    "</svg>",
)}`;

function supportsLiquidGlass(): boolean {
  if (typeof CSS === "undefined" || !CSS.supports) return false;
  // `userAgentData` is a Chromium-only API: the cheapest reliable signal for
  // "this engine actually renders SVG filters in backdrop-filter".
  if (!("userAgentData" in navigator)) return false;
  return CSS.supports("backdrop-filter", "url(#liquid-glass) blur(1px)");
}

export function LiquidGlassFilter() {
  useEffect(() => {
    if (!supportsLiquidGlass()) return;
    const root = document.documentElement;
    root.dataset.liquidGlass = "true";
    return () => {
      delete root.dataset.liquidGlass;
    };
  }, []);

  return (
    <svg aria-hidden width="0" height="0" focusable="false" className="pointer-events-none fixed h-0 w-0 overflow-hidden">
      <filter
        id="liquid-glass"
        x="0"
        y="0"
        width="1"
        height="1"
        filterUnits="objectBoundingBox"
        primitiveUnits="objectBoundingBox"
        colorInterpolationFilters="sRGB"
      >
        <feImage href={MAP} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
        {/* Scale is a fraction of the element box: a few pixels of bend on a
            tab-sized lens — present, never wobbly. */}
        <feDisplacementMap in="SourceGraphic" in2="map" scale="0.09" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
