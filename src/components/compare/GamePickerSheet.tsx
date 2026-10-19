"use client";

/**
 * "Pick a game to compare" — a search sheet (bottom sheet on touch, dialog
 * on desktop) used by the game page's Compare button and the compare page's
 * "Add game" column.
 *
 * Before anything is typed it offers suggestions the caller already has
 * (the game's related titles), because "compare with something similar" is
 * the common case and needs zero typing.
 */

import { Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GameCover } from "@/components/game/GameCover";
import { Sheet } from "@/components/ui/Sheet";
import { useDebouncedValue } from "@/hooks";
import { haptic } from "@/lib/haptics";
import type { SearchHit } from "@/lib/games/search";

export interface PickedGame {
  slug: string;
  name: string;
  image: string | null;
  year?: string | null;
}

export function GamePickerSheet({
  open,
  onClose,
  onPick,
  exclude,
  suggestions = [],
  title = "Compare with…",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (game: PickedGame) => void;
  /** Slugs already in the comparison. */
  exclude: string[];
  suggestions?: PickedGame[];
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 220);
  const [results, setResults] = useState<{ q: string; hits: PickedGame[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // After the sheet's own focus management has placed focus on the panel.
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (debounced.length < 2) return;
    const abort = new AbortController();
    fetch(`/api/search?q=${encodeURIComponent(debounced)}`, { signal: abort.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { hits?: SearchHit[] }) => {
        setFailed(false);
        setResults({
          q: debounced,
          hits: (body.hits ?? [])
            .filter((hit) => hit.kind === "game")
            .map((hit) => ({ slug: hit.slug, name: hit.name, image: hit.image, year: hit.released?.slice(0, 4) ?? hit.releaseWindow ?? null })),
        });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        console.warn("[compare picker]", error);
        setFailed(true);
      });
    return () => abort.abort();
  }, [debounced]);

  const searching = debounced.length >= 2;
  const list = searching ? (results?.q === debounced ? results.hits : null) : suggestions;
  const visible = (list ?? []).filter((game) => !exclude.includes(game.slug)).slice(0, 12);

  return (
    <Sheet open={open} onClose={onClose} title={title} description="Up to three games side by side.">
      <label className="relative block">
        <span className="sr-only">Search games</span>
        <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search games"
          autoComplete="off"
          enterKeyHint="search"
          className="h-12 w-full rounded-2xl border border-line bg-fg/[0.05] pl-11 pr-4 text-[16px] text-text outline-none placeholder:text-faint focus:border-line-strong"
        />
      </label>

      <div className="mt-4 min-h-[16rem]">
        {!searching && suggestions.length > 0 && (
          <p className="mb-2 px-1 text-[13px] font-semibold text-muted">Similar games</p>
        )}
        {searching && list === null && !failed ? (
          <p className="flex items-center gap-2 px-1 py-6 text-[14px] text-muted" role="status">
            <Loader2 size={15} className="animate-spin" /> Searching…
          </p>
        ) : failed && searching ? (
          <p className="px-1 py-6 text-[14px] text-muted">Search isn&rsquo;t answering right now. Try again in a moment.</p>
        ) : visible.length === 0 ? (
          <p className="px-1 py-6 text-[14px] text-muted">
            {searching ? `No games match “${debounced}”.` : "Type a game’s name to add it."}
          </p>
        ) : (
          <ul className="-mx-2 space-y-0.5 pb-2">
            {visible.map((game) => (
              <li key={game.slug}>
                <button
                  type="button"
                  onClick={() => {
                    haptic("selection");
                    onPick(game);
                  }}
                  className="press flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors fine:hover:bg-fg/[0.06] focus-visible:bg-fg/[0.06]"
                >
                  <span className="relative h-14 w-[42px] shrink-0 overflow-hidden rounded-lg bg-fg/[0.06]">
                    <GameCover name={game.name} slug={game.slug} image={game.image} width={120} sizes="42px" rounded="rounded-lg" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-text">{game.name}</span>
                    {game.year && <span className="block text-[13px] text-muted">{game.year}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
