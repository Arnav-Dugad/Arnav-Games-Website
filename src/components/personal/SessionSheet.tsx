"use client";

/**
 * "Log a session": how it felt (one tap), a short note, and optionally how
 * long — saved to the reader's play journal. Opened from the game page and
 * from any game's long-press menu (library posters included).
 */

import { useId, useState } from "react";
import { Angry, Check, Frown, Laugh, Meh, Minus, Plus, Smile, type LucideIcon } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { haptic } from "@/lib/haptics";
import { MOODS, MOOD_LABEL, NOTE_MAX, SESSION_MAX_HOURS, addJournalEntry, type GameRef, type Mood } from "@/lib/personal/store";
import { cn } from "@/lib/utils/cn";

export const MOOD_ICON: Record<Mood, LucideIcon> = { great: Laugh, good: Smile, okay: Meh, meh: Frown, frustrated: Angry };
export const MOOD_TONE: Record<Mood, string> = {
  great: "text-mint",
  good: "text-neon",
  okay: "text-gold",
  meh: "text-muted",
  frustrated: "text-flare",
};

export function SessionSheet({ game, open, onClose }: { game: GameRef | null; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Log a session" description={game?.name}>
      {open && game && <SessionForm game={game} onDone={onClose} />}
    </Sheet>
  );
}

function SessionForm({ game, onDone }: { game: GameRef; onDone: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const noteId = useId();
  const [mood, setMood] = useState<Mood | null>(null);
  const [note, setNote] = useState("");
  const [hours, setHours] = useState(0);
  const [saving, setSaving] = useState(false);
  const step = (delta: number) => {
    haptic("selection");
    setHours((value) => Math.min(SESSION_MAX_HOURS, Math.max(0, Math.round((value + delta) * 2) / 2)));
  };

  return (
    <form
      className="space-y-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!user || !mood || saving) return;
        setSaving(true);
        try {
          await addJournalEntry(user.uid, game, { note, mood, hours: hours || null });
          haptic("success");
          toast(hours ? `Logged ${hours} h of ${game.name}` : "Saved to your journal", "success");
          onDone();
        } catch (error) {
          haptic("warning");
          toast(error instanceof Error ? error.message : "Couldn't save that.", "error");
          setSaving(false);
        }
      }}
    >
      <fieldset>
        <legend className="text-[13px] font-semibold text-text">How was it?</legend>
        <div role="radiogroup" aria-label="How was it?" className="mt-2 grid grid-cols-5 gap-2">
          {MOODS.map((value) => {
            const Icon = MOOD_ICON[value];
            const checked = mood === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => {
                  haptic("selection");
                  setMood(value);
                }}
                className={cn(
                  "press flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border transition-colors",
                  checked ? "border-transparent bg-fg/[0.12]" : "border-line bg-fg/[0.03] fine:hover:bg-fg/[0.06]",
                )}
              >
                <Icon size={24} aria-hidden className={cn(checked ? MOOD_TONE[value] : "text-faint")} strokeWidth={1.8} />
                <span className={cn("text-[11px] font-semibold", checked ? "text-text" : "text-muted")}>{MOOD_LABEL[value]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor={noteId} className="text-[13px] font-semibold text-text">
          Note <span className="font-normal text-faint">(optional)</span>
        </label>
        <textarea
          id={noteId}
          value={note}
          maxLength={NOTE_MAX}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Beat the second boss. The swamp is gorgeous."
          className="mt-2 block w-full resize-none rounded-xl border border-line bg-fg/[0.04] px-4 py-3 text-[16px] leading-snug text-text placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className="text-[13px] font-semibold text-text">
          Time played <span className="font-normal text-faint">(optional)</span>
        </span>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Less time" onClick={() => step(-0.5)} disabled={hours <= 0} className="press grid h-11 w-11 place-items-center rounded-full bg-fg/[0.06] text-text disabled:opacity-40">
            <Minus size={16} />
          </button>
          <output aria-live="polite" className="w-16 text-center font-display text-[20px] font-bold tabular-nums">
            {hours ? `${hours} h` : "—"}
          </output>
          <button type="button" aria-label="More time" onClick={() => step(0.5)} className="press grid h-11 w-11 place-items-center rounded-full bg-fg/[0.06] text-text">
            <Plus size={16} />
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={!mood || saving}
        className="press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brand px-6 text-[15px] font-semibold text-white transition-opacity disabled:opacity-45"
      >
        <Check size={16} aria-hidden /> Save
      </button>
    </form>
  );
}
