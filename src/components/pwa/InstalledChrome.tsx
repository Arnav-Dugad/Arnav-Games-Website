/**
 * Chrome that only exists when running as the installed app. Pure CSS gated
 * by display-mode media queries, so in a browser tab it renders nothing
 * visible and changes nothing.
 *
 * 1. Desktop title strip (`window-controls-overlay`, which the manifest asks
 *    for first in `display_override`). In that mode the page draws into the
 *    title bar and the OS window buttons float over its top-right corner. This
 *    strip fills the title-bar area (the `titlebar-area-*` env vars), stays
 *    draggable so the window can still be moved, and the fixed header and the
 *    page flow are pushed below it so the window buttons never cover the
 *    header's search and account controls.
 *
 * 2. iOS status-bar scrim. The layout uses `black-translucent`, so the page
 *    runs edge to edge under the status bar — but iOS then always draws the
 *    clock and battery in white. Over the light theme a soft dark scrim keeps
 *    them legible; in the dark theme it isn't needed. Gated to iOS WebKit
 *    (`-webkit-touch-callout`) and sized to the top safe-area inset, so it
 *    is exactly the status bar and nothing else.
 *
 * Note: the `body > header` rule reaches into the layout's Header from here so
 * the whole feature stays in one place; if Header is restructured, move that
 * offset into Header itself.
 */

import { MARK_GLYPH_PATH, MARK_GRADIENT_FROM, MARK_GRADIENT_TO, MARK_TILE_RADIUS } from "./brand-mark";

const CSS = `
#ag-titlebar,#ag-statusbar-scrim{display:none}
@media (display-mode: window-controls-overlay){
  #ag-titlebar{display:flex;position:fixed;z-index:170;align-items:center;gap:8px;
    left:env(titlebar-area-x,0);top:env(titlebar-area-y,0);
    width:env(titlebar-area-width,100%);height:env(titlebar-area-height,33px);
    padding-left:12px;background:var(--color-bg);color:var(--color-muted);
    font:600 12px/1 var(--font-sans,system-ui,sans-serif);letter-spacing:.01em;
    -webkit-app-region:drag;app-region:drag;-webkit-user-select:none;user-select:none}
  body{padding-top:env(titlebar-area-height,0px)}
  body > header{top:env(titlebar-area-height,0px)}
}
@supports (-webkit-touch-callout: none){
  @media (display-mode: standalone){
    html[data-theme="light"] #ag-statusbar-scrim{display:block;position:fixed;inset:0 0 auto 0;z-index:155;
      height:env(safe-area-inset-top,0px);pointer-events:none;
      background:linear-gradient(to bottom,rgba(0,0,0,.55),rgba(0,0,0,.3))}
  }
}
`;

export function InstalledChrome() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div id="ag-statusbar-scrim" aria-hidden="true" />
      <div id="ag-titlebar" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="14" height="14">
          <defs>
            <linearGradient id="ag-titlebar-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={MARK_GRADIENT_FROM} />
              <stop offset="1" stopColor={MARK_GRADIENT_TO} />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx={MARK_TILE_RADIUS} fill="url(#ag-titlebar-g)" />
          <path d={MARK_GLYPH_PATH} fill="#fff" />
        </svg>
        Arnav Games
      </div>
    </>
  );
}
