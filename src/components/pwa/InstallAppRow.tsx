"use client";

/**
 * Permanent "Install app" row for Settings.
 *
 * Unlike the engagement prompt this is always available, and it is honest
 * about each platform: a one-tap install where the browser offers one, the
 * Add-to-Home-Screen steps on iPhone/iPad, the menu path elsewhere, and a
 * quiet confirmation when already running as the installed app.
 *
 * Styled as a grouped-list cell to sit among Settings' other rows.
 */

import { Check, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AppMark } from "./AppMark";
import { IosInstallSheet } from "./IosInstallSheet";
import { promptInstall, useInstallPlatform, useInstallPrompt, useRunningInstalled } from "./install-store";

export function InstallAppRow() {
  const deferred = useInstallPrompt();
  const installed = useRunningInstalled();
  const platform = useInstallPlatform();
  const [iosSheet, setIosSheet] = useState(false);

  let hint: string;
  let action: React.ReactNode = null;

  if (installed) {
    hint = "You're using the installed app.";
    action = (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-mint">
        <Check size={15} aria-hidden /> Installed
      </span>
    );
  } else if (deferred) {
    hint = "Opens in its own window, with your library available offline.";
    action = (
      <Button size="sm" icon={<Download size={14} aria-hidden />} onClick={() => void promptInstall()}>
        Install
      </Button>
    );
  } else if (platform === "ios") {
    hint = "Add it to your Home Screen to open it full screen, with your library offline.";
    action = (
      <Button size="sm" variant="secondary" onClick={() => setIosSheet(true)}>
        Show me how
      </Button>
    );
  } else if (platform === "mac-safari") {
    hint = "In Safari, choose File → Add to Dock.";
  } else {
    hint = "Use your browser's menu and choose Install app (Chrome, Edge) — or it may already be installed.";
  }

  return (
    <>
      <div className="flex w-full items-center gap-4 rounded-2xl border border-line bg-fg/[0.03] px-4 py-3.5">
        <AppMark className="h-10 w-10" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Install app</span>
          <span className="mt-0.5 block text-xs text-muted">{hint}</span>
        </span>
        {action}
      </div>
      <IosInstallSheet open={iosSheet} onClose={() => setIosSheet(false)} />
    </>
  );
}
