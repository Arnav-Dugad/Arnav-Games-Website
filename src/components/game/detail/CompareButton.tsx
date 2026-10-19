"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Columns3 } from "lucide-react";
import { GamePickerSheet, type PickedGame } from "@/components/compare/GamePickerSheet";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";

/**
 * Opens the compare picker for this game; picking a second game goes
 * straight to `/compare?games=this,that` — one decision, no setup screen.
 */
export function CompareButton({
  slug,
  name,
  suggestions,
  variant = "pill",
  className,
}: {
  slug: string;
  name: string;
  suggestions: PickedGame[];
  variant?: "pill" | "icon";
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Mounted on first open, then kept so the sheet can animate out.
  const [mounted, setMounted] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          haptic("selection");
          setMounted(true);
          setOpen(true);
        }}
        aria-label={variant === "icon" ? `Compare ${name} with another game` : undefined}
        title={variant === "icon" ? "Compare" : undefined}
        className={cn(
          variant === "icon"
            ? "press grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-fg/[0.035] text-muted transition-colors fine:hover:border-line-strong fine:hover:text-text"
            : "press inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-fg/15 bg-fg/[0.08] px-4 text-[14px] font-semibold text-text backdrop-blur-xl transition-colors fine:hover:bg-fg/[0.14]",
          className,
        )}
      >
        <Columns3 size={variant === "icon" ? 15 : 16} />
        {variant === "pill" && "Compare"}
      </button>
      {/* Portalled: in the hero the button sits inside transformed, clipped
          ancestors (parallax, reveal), which would trap a fixed-position sheet. */}
      {mounted && createPortal(
        <GamePickerSheet
          open={open}
          onClose={() => setOpen(false)}
          exclude={[slug]}
          suggestions={suggestions}
          title={`Compare ${name} with…`}
          onPick={(game) => {
            setOpen(false);
            router.push(`/compare?games=${encodeURIComponent(slug)},${encodeURIComponent(game.slug)}`);
          }}
        />,
        document.body,
      )}
    </>
  );
}
