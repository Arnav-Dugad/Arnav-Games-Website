"use client";

/** Records the exact launcher, console, mobile store, or cloud service used. */

import { useState } from "react";
import { Check, ChevronDown, Monitor } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { useToast } from "@/components/ui/Toast";
import { PLAYING_LOCATIONS, playingLocation } from "@/lib/games/stores-catalog";
import { cn } from "@/lib/utils/cn";

export function PlatformPicker({
  gameId,
  gameName,
  value,
  className,
}: {
  gameId: number;
  gameName: string;
  value: string | null;
  className?: string;
}) {
  const { setPlatform } = useWatchlist();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = value ? playingLocation(value) : null;
  const groups = [...new Set(PLAYING_LOCATIONS.map((location) => location.group))];

  const choose = async (platform: string | null) => {
    setOpen(false);
    setBusy(true);
    try {
      await setPlatform(gameId, platform);
      toast(platform ? "Play location updated" : "Play location cleared", "success");
    } catch {
      toast("Couldn't save that play location.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={busy}
        aria-expanded={open}
        aria-label={`Where ${gameName} is played`}
        className={cn(
          "inline-flex min-h-9 max-w-[min(16rem,65vw)] items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
          selected
            ? "border-brand/40 bg-brand/12 text-text"
            : "border-line bg-fg/[0.04] text-faint hover:text-muted",
          busy && "opacity-60",
        )}
      >
        {selected ? (
          <>
            <Glyph icon={selected.icon} />
            <span className="truncate">{selected.name}</span>
          </>
        ) : (
          "Set play location"
        )}
        <ChevronDown size={12} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul className="material material-menu absolute left-0 top-[calc(100%+6px)] z-30 max-h-[min(24rem,65vh)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-xl p-1">
            {groups.map((group, groupIndex) => (
              <li key={group} className={cn(groupIndex > 0 && "mt-1 border-t border-line pt-1")}>
                <p className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.07em] text-faint">{group}</p>
                <ul>
                  {PLAYING_LOCATIONS.filter((location) => location.group === group).map((location) => (
                    <li key={location.slug}>
                      <button
                        type="button"
                        onClick={() => choose(location.slug)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition-colors hover:bg-fg/[0.08] hover:text-text"
                      >
                        <Glyph icon={location.icon} />
                        <span className="min-w-0 flex-1 truncate">{location.name}</span>
                        {selected?.slug === location.slug && <Check size={13} className="text-brand-soft" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {selected && (
              <li className="mt-1 border-t border-line pt-1">
                <button
                  type="button"
                  onClick={() => choose(null)}
                  className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] text-faint transition-colors hover:bg-fg/[0.08] hover:text-text"
                >
                  Clear play location
                </button>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function Glyph({ icon }: { icon: string | null }) {
  if (icon) return <BrandIcon name={icon} size={13} title={null} tinted />;
  return <Monitor size={13} aria-hidden />;
}
