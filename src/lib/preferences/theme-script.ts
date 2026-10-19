/**
 * The appearance boot script and its constants, with no React imports, so the
 * root (server) layout can inline it without pulling client hooks into the
 * server graph. The hook that changes the preference lives in `theme.ts`.
 */

import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = `${STORAGE_PREFIX}theme`;
export const THEME_CHANGE_EVENT = "arnav-games:theme-change";

/** Browser chrome colour per theme — matches `--color-bg`. */
const CHROME_COLOR: Record<ResolvedTheme, string> = { dark: "#000000", light: "#f5f5f7" };

/*
 * Kept as a self-contained string because it runs before React, inline in
 * <head>. It also follows OS changes while the preference is "system", so the
 * page flips with the device even when nothing in React is listening.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_KEY)};var m=window.matchMedia("(prefers-color-scheme: light)");var c=${JSON.stringify(CHROME_COLOR)};function a(){var p=localStorage.getItem(k)||"system";var t=p==="system"?(m.matches?"light":"dark"):p;var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;var e=document.querySelector('meta[name="theme-color"]');if(e)e.setAttribute("content",c[t]);}a();m.addEventListener("change",a);window.addEventListener("${THEME_CHANGE_EVENT}",a);}catch(e){}})();`;

