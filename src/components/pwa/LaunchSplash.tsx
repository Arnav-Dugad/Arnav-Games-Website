/**
 * Animated launch splash for the installed app.
 *
 * A server component with no JavaScript of its own: the markup ships in every
 * page's HTML, hidden, and `pwaBootScript` reveals it by setting `data-launch`
 * on <html> before first paint — only on a cold start in standalone mode, and
 * never under reduced motion. Because the timeline is pure CSS it starts on
 * the very first frame, without waiting for hydration, and the overlay ends
 * itself (`forwards` to `visibility: hidden`) even if the boot script's
 * cleanup timer never fires.
 *
 * Frame zero matches the iOS startup image exactly (black canvas, tile centred
 * at SPLASH_MARK_SIZE), so the native still hands over without a jump. Then:
 * a light traces the outline of the "A", a glint crosses the tile, the halo
 * blooms and the wordmark rises; finally the whole layer lifts away and the
 * app crossfades in. Total 1.15 s.
 *
 * `aria-hidden` because it is decoration over content that is already in the
 * DOM and readable; nothing is blocked for assistive technology.
 */

import {
  APP_BACKGROUND,
  MARK_GLYPH_PATH,
  MARK_GRADIENT_FROM,
  MARK_GRADIENT_TO,
  MARK_TILE_RADIUS,
  SPLASH_MARK_SIZE,
} from "./brand-mark";

const CSS = `
#ag-launch{display:none}
html[data-launch] #ag-launch{display:block}
#ag-launch{position:fixed;inset:0;z-index:2147483000;background:${APP_BACKGROUND};pointer-events:none;
  animation:ag-launch-out .3s cubic-bezier(.32,.72,0,1) .85s forwards}
#ag-launch .ag-launch-halo{position:absolute;left:50%;top:50%;width:${SPLASH_MARK_SIZE * 3.2}px;height:${SPLASH_MARK_SIZE * 3.2}px;
  margin:-${SPLASH_MARK_SIZE * 1.6}px 0 0 -${SPLASH_MARK_SIZE * 1.6}px;border-radius:50%;
  background:radial-gradient(closest-side,${MARK_GRADIENT_FROM}55,${MARK_GRADIENT_TO}14 60%,transparent);
  opacity:0;transform:scale(.6);animation:ag-launch-halo .7s cubic-bezier(.16,1,.3,1) .05s forwards}
#ag-launch .ag-launch-mark{position:absolute;left:50%;top:50%;width:${SPLASH_MARK_SIZE}px;height:${SPLASH_MARK_SIZE}px;
  margin:-${SPLASH_MARK_SIZE / 2}px 0 0 -${SPLASH_MARK_SIZE / 2}px;animation:ag-launch-lift .3s cubic-bezier(.32,.72,0,1) .85s forwards}
#ag-launch svg{display:block;width:100%;height:100%;overflow:visible}
#ag-launch .ag-launch-trace{stroke-dasharray:100;stroke-dashoffset:100;opacity:0;
  animation:ag-launch-trace .62s cubic-bezier(.45,0,.2,1) .04s forwards}
#ag-launch .ag-launch-glint{animation:ag-launch-glint .55s cubic-bezier(.45,0,.2,1) .28s forwards}
#ag-launch .ag-launch-word{position:absolute;left:0;right:0;top:calc(50% + ${SPLASH_MARK_SIZE / 2 + 26}px);text-align:center;
  font:700 22px/1.2 var(--font-display,system-ui,sans-serif);letter-spacing:-.01em;color:#f5f5f7;
  opacity:0;transform:translateY(8px);animation:ag-launch-word .45s cubic-bezier(.16,1,.3,1) .22s forwards}
#ag-launch .ag-launch-word span{background:linear-gradient(90deg,#b9adff,#64d2ff);-webkit-background-clip:text;background-clip:text;color:transparent}
@keyframes ag-launch-out{to{opacity:0;visibility:hidden}}
@keyframes ag-launch-lift{to{transform:scale(1.08)}}
@keyframes ag-launch-halo{to{opacity:1;transform:scale(1)}}
@keyframes ag-launch-trace{0%{stroke-dashoffset:100;opacity:0}15%{opacity:.95}80%{opacity:.95}100%{stroke-dashoffset:0;opacity:0}}
@keyframes ag-launch-glint{to{transform:translateX(126px)}}
@keyframes ag-launch-word{to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){html[data-launch] #ag-launch{display:none}}
`;

export function LaunchSplash() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div id="ag-launch" aria-hidden="true">
        <div className="ag-launch-halo" />
        <div className="ag-launch-mark">
          <svg viewBox="0 0 64 64">
            <defs>
              <linearGradient id="ag-launch-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={MARK_GRADIENT_FROM} />
                <stop offset="1" stopColor={MARK_GRADIENT_TO} />
              </linearGradient>
              <linearGradient id="ag-launch-s" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset=".5" stopColor="#fff" stopOpacity=".6" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <clipPath id="ag-launch-c">
                <rect width="64" height="64" rx={MARK_TILE_RADIUS} />
              </clipPath>
            </defs>
            <rect width="64" height="64" rx={MARK_TILE_RADIUS} fill="url(#ag-launch-g)" />
            <path d={MARK_GLYPH_PATH} fill="#fff" />
            {/* The light that runs around the glyph's outline. */}
            <path
              className="ag-launch-trace"
              d={MARK_GLYPH_PATH}
              pathLength={100}
              fill="none"
              stroke="#fff"
              strokeWidth="1.4"
              strokeLinejoin="round"
              style={{ filter: "drop-shadow(0 0 2px #fff)" }}
            />
            <g clipPath="url(#ag-launch-c)">
              <g transform="rotate(20 32 32)">
                <rect className="ag-launch-glint" x="-42" y="-20" width="20" height="104" fill="url(#ag-launch-s)" />
              </g>
            </g>
          </svg>
        </div>
        <div className="ag-launch-word">
          Arnav <span>Games</span>
        </div>
      </div>
    </>
  );
}
