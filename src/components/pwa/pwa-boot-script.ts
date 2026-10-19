/**
 * The PWA boot script, inlined in <head> by the root layout. No React, no
 * client imports — like THEME_BOOT_SCRIPT, it must run before first paint.
 *
 * It does two things that can't wait for hydration:
 *
 * 1. Decides whether to show the launch splash. The splash markup is always in
 *    the server HTML but hidden; this sets `data-launch` on <html> to reveal it
 *    only for a cold start of the *installed* app. Deciding in React instead
 *    would paint the page first and then flash the splash over it.
 * 2. Captures `beforeinstallprompt`. Chromium can fire it before React has
 *    mounted anything, and a missed event can't be replayed.
 */

import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";

/** Window event fired whenever the captured install prompt appears or is used up. */
export const INSTALL_PROMPT_EVENT = "arnav-games:install-prompt";
/** sessionStorage flag: the splash already ran in this app session. */
export const LAUNCHED_KEY = `${STORAGE_PREFIX}launched`;
/** Mirrors PreferencesProvider's in-app "Reduce motion" switch. */
const MOTION_KEY = `${STORAGE_PREFIX}reduce-motion`;
/** How long the splash owns the screen; must cover LaunchSplash's CSS timeline. */
export const SPLASH_DURATION_MS = 1200;

/**
 * Display modes that only exist once the app is installed. `navigator.standalone`
 * is iOS Safari's older home-screen flag.
 */
const INSTALLED_QUERY =
  "(display-mode: standalone), (display-mode: fullscreen), (display-mode: window-controls-overlay), (display-mode: minimal-ui)";

/**
 * @param allowForce Dev builds accept `?pwa-splash=1` to preview the splash in a
 *   normal tab (Playwright can't emulate display-mode). Production builds pass
 *   false, which leaves the check out of the shipped script entirely.
 */
export function pwaBootScript(allowForce: boolean): string {
  const force = allowForce ? `/[?&]pwa-splash=1(&|$)/.test(location.search)` : "false";
  return `(function(){
var w=window,d=document.documentElement;
try{
w.addEventListener("beforeinstallprompt",function(e){e.preventDefault();w.__agInstallPrompt=e;w.dispatchEvent(new Event(${JSON.stringify(INSTALL_PROMPT_EVENT)}));});
w.addEventListener("appinstalled",function(){w.__agInstallPrompt=null;w.dispatchEvent(new Event(${JSON.stringify(INSTALL_PROMPT_EVENT)}));});
}catch(e){}
try{
var force=${force};
var installed=w.matchMedia(${JSON.stringify(INSTALLED_QUERY)}).matches||w.navigator.standalone===true;
if(!force){
if(!installed)return;
if(sessionStorage.getItem(${JSON.stringify(LAUNCHED_KEY)}))return;
}
sessionStorage.setItem(${JSON.stringify(LAUNCHED_KEY)},"1");
if(w.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
if(localStorage.getItem(${JSON.stringify(MOTION_KEY)})==="true")return;
d.setAttribute("data-launch","");
setTimeout(function(){d.removeAttribute("data-launch");},${SPLASH_DURATION_MS + 100});
}catch(e){}
})();`.replace(/\n/g, "");
}

/** Pure form of the splash decision, for unit tests and documentation. */
export function shouldShowSplash(input: {
  installed: boolean;
  alreadyLaunched: boolean;
  osReducedMotion: boolean;
  appReducedMotion: boolean;
  forced: boolean;
}): boolean {
  if (!input.forced && (!input.installed || input.alreadyLaunched)) return false;
  return !input.osReducedMotion && !input.appReducedMotion;
}
