"use client";

/**
 * The "Import from Steam" trigger. The sheet (and its matching logic) is
 * only fetched the first time someone opens it.
 */

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { cn } from "@/lib/utils/cn";

const SteamImportSheet = dynamic(() => import("./SteamImport").then((mod) => mod.SteamImportSheet), { ssr: false });

export function SteamImportButton({
  variant = "pill",
  className,
  children,
}: {
  /** `pill`: a compact control; `primary`: the empty library's main action; `custom`: render `children` as the trigger's content. */
  variant?: "pill" | "primary" | "custom";
  className?: string;
  children?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        className={cn(
          variant === "pill" && "press inline-flex min-h-11 items-center gap-2 rounded-full bg-fg/[0.07] px-4 text-[14px] font-semibold text-text transition-colors fine:hover:bg-fg/[0.12]",
          variant === "primary" && "press inline-flex min-h-12 items-center gap-2 rounded-full bg-[#171a21] px-5 text-[15px] font-semibold text-white shadow-lg transition-transform light:bg-[#171a21]",
          className,
        )}
      >
        {variant === "custom" ? children : (
          <>
            <BrandIcon name="steam" size={16} title={null} />
            Import from Steam
          </>
        )}
      </button>
      {mounted && <SteamImportSheet open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
