"use client";

/**
 * The play journal as a timeline: newest session first, each with its game,
 * how it felt and the note. Used on the profile.
 */

import Link from "next/link";
import { useState } from "react";
import { GameCover } from "@/components/game/GameCover";
import { MOOD_LABEL, type JournalEntry } from "@/lib/personal/store";
import { cn } from "@/lib/utils/cn";
import { MOOD_ICON, MOOD_TONE } from "./SessionSheet";
import { formatHours, journalDate } from "./format";

const PAGE = 6;

export function JournalTimeline({ entries, now }: { entries: JournalEntry[]; now: number }) {
  const [shown, setShown] = useState(PAGE);
  return (
    <div>
      <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[23px] before:top-3 before:w-px before:bg-line">
        {entries.slice(0, shown).map((entry) => {
          const Icon = MOOD_ICON[entry.mood];
          return (
            <li key={entry.id} className="relative flex gap-3 rounded-2xl p-1.5 transition-colors fine:hover:bg-fg/[0.03]">
              <Link prefetch={false} href={`/game/${entry.slug}`} aria-hidden tabIndex={-1} className="relative z-[1] h-[64px] w-12 shrink-0 overflow-hidden rounded-[9px] ring-1 ring-inset ring-fg/10">
                <GameCover name={entry.name} slug={entry.slug} image={entry.image} width={120} sizes="48px" />
              </Link>
              <div className="min-w-0 flex-1 py-0.5">
                <p className="flex items-center gap-1.5 text-[12px] text-faint">
                  <Icon size={14} aria-hidden className={cn("shrink-0", MOOD_TONE[entry.mood])} strokeWidth={2} />
                  <span className="sr-only">{MOOD_LABEL[entry.mood]} · </span>
                  {journalDate(entry.at, now)}
                  {entry.hours ? ` · ${formatHours(entry.hours)}` : ""}
                </p>
                <Link prefetch={false} href={`/game/${entry.slug}`} className="mt-0.5 block truncate text-[15px] font-semibold fine:hover:text-brand-soft">
                  {entry.name}
                </Link>
                {entry.note && <p className="mt-0.5 line-clamp-3 whitespace-pre-line break-words text-[14px] leading-snug text-muted">{entry.note}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {entries.length > shown && (
        <button
          type="button"
          onClick={() => setShown((value) => value + PAGE * 2)}
          className="press mt-2 inline-flex min-h-11 items-center rounded-full px-3 text-[15px] font-medium text-brand-soft fine:hover:bg-brand/10"
        >
          Show more
        </button>
      )}
    </div>
  );
}
