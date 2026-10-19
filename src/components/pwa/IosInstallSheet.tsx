"use client";

/**
 * Add-to-Home-Screen instructions for iPhone and iPad.
 *
 * iOS has no install API — a page can't trigger the dialog — so the honest
 * thing is to show the three taps it takes. Safari on iOS 26 tucks Share
 * behind the "•••" button in the compact toolbar, hence the aside in step 1.
 */

import { Share, SquarePlus, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";

export function IosInstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add Arnav Games to your Home Screen"
      description="It opens full screen like an app, and your library stays available offline."
    >
      <ol className="mt-2 space-y-2.5">
        <Step n={1} icon={<Share size={18} aria-hidden />}>
          Tap <strong className="font-semibold text-text">Share</strong> in Safari&rsquo;s toolbar.
          <span className="mt-0.5 block text-[13px] text-faint">
            On iOS 26, tap <span aria-label="More">•••</span> first if you don&rsquo;t see it.
          </span>
        </Step>
        <Step n={2} icon={<SquarePlus size={18} aria-hidden />}>
          Scroll down and choose <strong className="font-semibold text-text">Add to Home Screen</strong>.
        </Step>
        <Step n={3} icon={<Smartphone size={18} aria-hidden />}>
          Leave <strong className="font-semibold text-text">Open as Web App</strong> on, then tap{" "}
          <strong className="font-semibold text-text">Add</strong>.
        </Step>
      </ol>
      <Button variant="secondary" fullWidth className="mt-5" onClick={onClose}>
        Got it
      </Button>
    </Sheet>
  );
}

function Step({ n, icon, children }: { n: number; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3.5 rounded-2xl border border-line bg-fg/[0.03] px-4 py-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand-soft">
        {icon}
      </span>
      <p className="min-w-0 flex-1 pt-1.5 text-[15px] leading-snug text-muted">
        <span className="sr-only">Step {n}: </span>
        {children}
      </p>
    </li>
  );
}
