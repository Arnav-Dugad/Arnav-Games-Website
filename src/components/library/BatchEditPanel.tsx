"use client";

import { useMemo, useState } from "react";
import { Bell, Bookmark, Check, Gamepad2, Library, Loader2, Sparkles, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import type { BatchLibraryChange, WatchStatus } from "@/lib/firebase/db";
import { OWNERSHIP_PLATFORMS, PLAYING_LOCATIONS } from "@/lib/games/stores-catalog";

type ActionKind = BatchLibraryChange["kind"];

export function BatchEditPanel({
  gameIds,
  onDone,
  onClose,
}: {
  gameIds: number[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { batchUpdate } = useWatchlist();
  const { toast } = useToast();
  const [kind, setKind] = useState<ActionKind>("status");
  const [value, setValue] = useState("none");
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => optionsFor(kind), [kind]);

  const chooseKind = (next: ActionKind) => {
    setKind(next);
    setValue(optionsFor(next)[0]?.value ?? "");
  };

  const apply = async () => {
    if (gameIds.length === 0) return;
    const change = toChange(kind, value);
    setBusy(true);
    try {
      await batchUpdate(gameIds, change);
      toast(`${gameIds.length} ${gameIds.length === 1 ? "game" : "games"} updated`, "success");
      onDone();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't update those games.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Batch editor" className="sticky top-20 z-40 mb-5 rounded-3xl border border-brand/35 bg-bg-elev/95 p-4 shadow-[0_32px_100px_-38px_rgba(124,92,255,.8)] backdrop-blur-2xl sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand/15 text-brand-soft"><Sparkles size={17} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Batch edit {gameIds.length} selected {gameIds.length === 1 ? "game" : "games"}</p>
          <p className="mt-0.5 text-[11px] text-muted">Only the chosen field changes. Everything else is preserved.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close batch editor" className="grid h-10 w-10 place-items-center rounded-full text-faint hover:bg-fg/[0.08] hover:text-text"><X size={16} /></button>
      </div>

      <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <select value={kind} onChange={(event) => chooseKind(event.target.value as ActionKind)} aria-label="Field to batch edit" className="min-h-12 min-w-0 rounded-xl border border-line bg-panel px-3 text-sm outline-none focus:border-brand">
          <option value="status">Play status</option>
          <option value="ownership-add">Add ownership platform</option>
          <option value="ownership-remove">Remove ownership platform</option>
          <option value="watchlisted">Watchlist</option>
          <option value="following">Release and DLC alerts</option>
          <option value="platform">Play location</option>
          <option value="subscriptions-clear">Subscription history</option>
        </select>
        <select value={value} onChange={(event) => setValue(event.target.value)} disabled={options.length === 0} aria-label="Batch edit value" className="min-h-12 min-w-0 rounded-xl border border-line bg-panel px-3 text-sm outline-none disabled:opacity-50 focus:border-brand">
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button type="button" onClick={apply} disabled={busy || gameIds.length === 0} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-fg px-5 text-sm font-black text-bg transition-transform hover:-translate-y-0.5 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Apply</button>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-faint"><span className="flex items-center gap-1"><Library size={11} /> Multi-platform safe</span><span className="flex items-center gap-1"><Bookmark size={11} /> Saves preserved</span><span className="flex items-center gap-1"><Bell size={11} /> Alerts preserved</span><span className="flex items-center gap-1"><Gamepad2 size={11} /> History preserved</span></div>
    </section>
  );
}

function optionsFor(kind: ActionKind): Array<{ value: string; label: string }> {
  if (kind === "status") return [
    { value: "none", label: "No status" },
    { value: "want", label: "Want to play" },
    { value: "playing", label: "Playing" },
    { value: "played", label: "Played" },
  ];
  if (kind === "ownership-add" || kind === "ownership-remove") return OWNERSHIP_PLATFORMS.map((item) => ({ value: item.slug, label: item.name }));
  if (kind === "watchlisted") return [{ value: "true", label: "Save to watchlist" }, { value: "false", label: "Remove from watchlist" }];
  if (kind === "following") return [{ value: "true", label: "Turn alerts on" }, { value: "false", label: "Turn alerts off" }];
  if (kind === "platform") return [{ value: "", label: "Clear play location" }, ...PLAYING_LOCATIONS.map((item) => ({ value: item.slug, label: item.name }))];
  return [{ value: "clear", label: "Clear subscription history" }];
}

function toChange(kind: ActionKind, value: string): BatchLibraryChange {
  if (kind === "status") return { kind, value: value as WatchStatus };
  if (kind === "ownership-add" || kind === "ownership-remove") return { kind, value };
  if (kind === "watchlisted" || kind === "following") return { kind, value: value === "true" };
  if (kind === "platform") return { kind, value: value || null };
  return { kind: "subscriptions-clear" };
}
