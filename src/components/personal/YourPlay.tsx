"use client";

/**
 * "Your play" on a game page: the reader's own hours set against the
 * crowd's time to beat ("You took 62 h · most finish in 46 h"), and their
 * play journal for this game. Signed-in readers only — for everyone else
 * there is nothing personal to show, so the section doesn't render.
 */

import { useState } from "react";
import { Minus, NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import { DetailHeading } from "@/components/game/detail/DetailSection";
import { useToast } from "@/components/ui/Toast";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { haptic } from "@/lib/haptics";
import { deleteJournalEntry, openSessionLog, setPlaytime, usePersonal, type GameRef, type JournalEntry } from "@/lib/personal/store";
import { cn } from "@/lib/utils/cn";
import { MOOD_ICON, MOOD_TONE } from "./SessionSheet";
import { formatHours, journalDate } from "./format";

export default function YourPlay({ game, crowdHours }: { game: GameRef; crowdHours: number | null }) {
  const { uid, ready, journal, playtime } = usePersonal();
  const { statusOf } = useWatchlist();
  if (!uid || !ready) return null;

  const entries = journal.filter((entry) => entry.gameId === game.id);
  const hours = playtime[game.id] ?? 0;
  const status = statusOf(game.id);

  return (
    <section id="your-play" aria-labelledby="your-play-title" className="scroll-mt-36">
      <DetailHeading
        titleId="your-play-title"
        title="Your play"
        aside={
          <button
            type="button"
            onClick={() => openSessionLog(game)}
            className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--game-accent,var(--color-brand))] px-5 text-[14px] font-semibold text-[var(--game-on-accent,#fff)]"
          >
            <NotebookPen size={16} aria-hidden /> Log a session
          </button>
        }
      />
      <div className="mt-6 grid gap-4 sm:mt-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <YourTime uid={uid} gameId={game.id} hours={hours} crowdHours={crowdHours} finished={status === "played"} />
        <Journal uid={uid} entries={entries} />
      </div>
    </section>
  );
}

function YourTime({ uid, gameId, hours, crowdHours, finished }: { uid: string; gameId: number; hours: number; crowdHours: number | null; finished: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(hours);
  const max = Math.max(hours, crowdHours ?? 0, 1);

  const save = async (value: number) => {
    try {
      await setPlaytime(uid, gameId, value);
      haptic("success");
      setEditing(false);
    } catch (error) {
      haptic("warning");
      toast(error instanceof Error ? error.message : "Couldn't save that.", "error");
    }
  };

  return (
    <div className="glass rounded-3xl p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[17px] font-semibold text-text">Your time</h3>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(hours);
              setEditing(true);
            }}
            className="press inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted fine:hover:bg-fg/[0.06] coarse:min-h-11"
          >
            <Pencil size={13} aria-hidden /> {hours ? "Edit" : "Add hours"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-4 flex items-center gap-2">
          <button type="button" aria-label="Fewer hours" onClick={() => setDraft((v) => Math.max(0, v - 1))} className="press grid h-11 w-11 place-items-center rounded-full bg-fg/[0.06]">
            <Minus size={16} />
          </button>
          <label className="sr-only" htmlFor="your-hours">Hours played</label>
          <input
            id="your-hours"
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            value={draft}
            onChange={(event) => setDraft(Math.max(0, Number(event.target.value) || 0))}
            className="h-11 w-24 rounded-xl border border-line bg-fg/[0.04] text-center font-display text-[20px] font-bold tabular-nums text-text focus:border-line-strong focus:outline-none"
          />
          <button type="button" aria-label="More hours" onClick={() => setDraft((v) => v + 1)} className="press grid h-11 w-11 place-items-center rounded-full bg-fg/[0.06]">
            <Plus size={16} />
          </button>
          <button type="button" onClick={() => save(draft)} className="press ml-auto min-h-11 rounded-full bg-brand px-5 text-[14px] font-semibold text-white">
            Save
          </button>
        </div>
      ) : (
        <p className="mt-3 font-display text-[36px] font-bold leading-none tracking-[-0.02em] tabular-nums text-text">
          {hours ? formatHours(hours) : "—"}
        </p>
      )}

      {crowdHours && (hours > 0 || editing) ? (
        <div className="mt-5 space-y-2.5" aria-label="Your time compared with other players">
          <Bar label={finished ? "You took" : "You so far"} hours={editing ? draft : hours} max={max} accent />
          <Bar label="Most finish in" hours={crowdHours} max={max} />
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted">
          {crowdHours ? `Most players finish the story in ${formatHours(crowdHours)}.` : "Log sessions or add your hours to keep count."}
        </p>
      )}
    </div>
  );
}

function Bar({ label, hours, max, accent = false }: { label: string; hours: number; max: number; accent?: boolean }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 text-[14px]">
      <span className="text-muted">{label}</span>
      <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-fg/[0.08]">
        <span
          className={cn("block h-full rounded-full transition-[width] duration-500 ease-out", accent ? "bg-[var(--game-accent,var(--color-brand))]" : "bg-fg/30")}
          style={{ width: `${Math.max(4, (hours / max) * 100)}%` }}
        />
      </span>
      <span className="font-semibold tabular-nums text-text">{formatHours(hours)}</span>
    </div>
  );
}

function Journal({ uid, entries }: { uid: string; entries: JournalEntry[] }) {
  const { toast } = useToast();
  if (entries.length === 0) {
    return (
      <div className="glass flex flex-col justify-center rounded-3xl p-5 sm:p-6">
        <h3 className="text-[17px] font-semibold text-text">Your notes</h3>
        <p className="mt-2 text-[14px] text-muted">After you play, jot down how it went. Your notes stay private.</p>
      </div>
    );
  }
  return (
    <div className="glass rounded-3xl p-5 sm:p-6">
      <h3 className="text-[17px] font-semibold text-text">Your notes</h3>
      <ol className="mt-3 divide-y divide-line">
        {entries.slice(0, 8).map((entry) => {
          const Icon = MOOD_ICON[entry.mood];
          return (
            <li key={entry.id} className="group flex gap-3 py-3">
              <Icon size={20} aria-label={entry.mood} className={cn("mt-0.5 shrink-0", MOOD_TONE[entry.mood])} strokeWidth={1.8} />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-faint">
                  {journalDate(entry.at)}
                  {entry.hours ? ` · ${formatHours(entry.hours)}` : ""}
                </p>
                {entry.note && <p className="mt-0.5 whitespace-pre-line break-words text-[15px] leading-snug text-text">{entry.note}</p>}
              </div>
              <button
                type="button"
                aria-label="Delete this note"
                onClick={async () => {
                  try {
                    await deleteJournalEntry(uid, entry);
                    haptic("light");
                  } catch {
                    toast("Couldn't delete that note.", "error");
                  }
                }}
                className="press grid h-10 w-10 shrink-0 place-items-center rounded-full text-faint opacity-100 transition-opacity fine:opacity-0 fine:group-hover:opacity-100 fine:focus-visible:opacity-100 fine:hover:bg-fg/[0.06] fine:hover:text-flare"
              >
                <Trash2 size={15} />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
