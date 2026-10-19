"use client";

/**
 * The "install the app" suggestion.
 *
 * Shown sparingly — at most once per 30 days, and only after the person has
 * shown they come back: a second visit (session), or following/saving a game
 * during this one. Never inside the installed app, never on auth/admin pages,
 * and never when the browser can't actually install (no captured
 * `beforeinstallprompt` on Chromium; iOS gets the Add-to-Home-Screen sheet
 * instead, since it has no install API).
 *
 * The 30-day clock starts when the card is *shown*, whatever the answer, so a
 * dismissal is respected rather than re-asked on the next visit.
 */

import { Download } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";
import { AppMark } from "./AppMark";
import { IosInstallSheet } from "./IosInstallSheet";
import { PwaCard } from "./PwaCard";
import { promptInstall, useInstallPlatform, useInstallPrompt, useRunningInstalled } from "./install-store";

const VISITS_KEY = `${STORAGE_PREFIX}pwa-visits`;
const SESSION_COUNTED_KEY = `${STORAGE_PREFIX}pwa-visit-counted`;
const PROMPTED_AT_KEY = `${STORAGE_PREFIX}pwa-prompted-at`;
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
/** Let the page settle before offering anything. */
const SHOW_DELAY_MS = 3000;
const QUIET_ROUTES = ["/login", "/signup", "/admin", "/offline"];

/** Counts this session once and returns the running total of sessions. */
function recordVisit(): number {
  try {
    let visits = Number(localStorage.getItem(VISITS_KEY) ?? "0") || 0;
    if (!sessionStorage.getItem(SESSION_COUNTED_KEY)) {
      sessionStorage.setItem(SESSION_COUNTED_KEY, "1");
      visits += 1;
      localStorage.setItem(VISITS_KEY, String(visits));
    }
    return visits;
  } catch {
    return 0;
  }
}

function cooledDown(): boolean {
  try {
    const last = Number(localStorage.getItem(PROMPTED_AT_KEY) ?? "0") || 0;
    return Date.now() - last > COOLDOWN_MS;
  } catch {
    // Without storage the cooldown can't be honoured, so don't nag at all.
    return false;
  }
}

function markPrompted() {
  try {
    localStorage.setItem(PROMPTED_AT_KEY, String(Date.now()));
  } catch {
    /* storage unavailable */
  }
}

export function InstallPrompt({ suppressed }: { suppressed: boolean }) {
  const deferred = useInstallPrompt();
  const installed = useRunningInstalled();
  const platform = useInstallPlatform();
  const { entries, loading } = useWatchlist();
  const pathname = usePathname();

  const [engaged, setEngaged] = useState(false);
  const [open, setOpen] = useState(false);
  const [iosSheet, setIosSheet] = useState(false);
  const libraryBaseline = useRef<number | null>(null);

  // Engagement signal 1: a returning visitor.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (recordVisit() >= 2) setEngaged(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Engagement signal 2: followed or saved a game during this visit. (A
  // library arriving because the person signed in mid-visit also grows the
  // count — signing in is engagement too, so that's intended.)
  useEffect(() => {
    if (loading) return;
    if (libraryBaseline.current === null) {
      libraryBaseline.current = entries.length;
      return;
    }
    if (entries.length <= libraryBaseline.current) return;
    const frame = requestAnimationFrame(() => setEngaged(true));
    return () => cancelAnimationFrame(frame);
  }, [entries.length, loading]);

  const canInstall = !installed && (deferred !== null || platform === "ios");
  const quietRoute = QUIET_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const eligible = engaged && canInstall && !suppressed && !quietRoute;

  useEffect(() => {
    if (!eligible || open) return;
    const timer = setTimeout(() => {
      if (!cooledDown()) return;
      markPrompted();
      setOpen(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eligible, open]);

  // Installed (or the prompt was used up elsewhere, e.g. from Settings): close.
  const visible = open && canInstall && !suppressed;

  const install = async () => {
    if (platform === "ios" && !deferred) {
      setOpen(false);
      setIosSheet(true);
      return;
    }
    setOpen(false);
    await promptInstall();
  };

  return (
    <>
      <PwaCard
        open={visible}
        onDismiss={() => setOpen(false)}
        dismissLabel="Not now"
        icon={<AppMark />}
        title="Install Arnav Games"
        body={
          platform === "ios"
            ? "Add it to your Home Screen: it opens full screen, and your library works offline."
            : "Open it like an app, from your home screen or dock — with your library available offline."
        }
        actions={
          <>
            <Button size="sm" icon={<Download size={14} aria-hidden />} onClick={() => void install()}>
              {platform === "ios" ? "Show me how" : "Install"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Not now
            </Button>
          </>
        }
      />
      <IosInstallSheet open={iosSheet} onClose={() => setIosSheet(false)} />
    </>
  );
}
