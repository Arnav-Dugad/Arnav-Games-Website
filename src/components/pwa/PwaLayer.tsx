"use client";

/**
 * Everything the installable app adds to the page, mounted once in the root
 * layout (inside Providers, for toasts and the watchlist):
 *
 *  - service worker registration and the "Update available — Reload" card
 *  - the offline / back-online pill
 *  - the engagement-gated install suggestion
 *  - a confirmation toast when the app finishes installing
 *  - installed-only chrome: the desktop title strip and the iOS status-bar scrim
 */

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { InstallPrompt } from "./InstallPrompt";
import { OfflineBanner } from "./OfflineBanner";
import { PwaCard } from "./PwaCard";
import { useServiceWorker } from "./use-service-worker";
import { InstalledChrome } from "./InstalledChrome";

export function PwaLayer() {
  const { updateReady, applyUpdate, dismiss } = useServiceWorker();
  const { toast } = useToast();

  useEffect(() => {
    const onInstalled = () => toast("Arnav Games is installed — find it on your home screen or dock.", "success");
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, [toast]);

  return (
    <>
      <InstalledChrome />
      <OfflineBanner />
      <PwaCard
        open={updateReady}
        onDismiss={dismiss}
        dismissLabel="Later"
        icon={
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand/15 text-brand-soft">
            <RefreshCw size={18} aria-hidden />
          </span>
        }
        title="Update available"
        body="A new version of Arnav Games is ready. Reload to start using it."
        actions={
          <Button size="sm" onClick={applyUpdate}>
            Reload
          </Button>
        }
      />
      {/* One card at a time: an update outranks an install suggestion. */}
      <InstallPrompt suppressed={updateReady} />
    </>
  );
}
