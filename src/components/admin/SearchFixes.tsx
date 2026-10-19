"use client";

/**
 * "Search fixes": searches that found nothing, each with up to three games
 * the autopilot thinks were meant. One tap on a game approves the alias (the
 * game then leads results for that query); Dismiss hides it; Search lets the
 * owner pick any game instead. Every change can be undone inline.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Search as SearchIcon, Sparkles, Undo2, X } from "lucide-react";
import type { AliasCandidate, SearchFix } from "@/lib/analytics/types";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Caveat, Panel, PanelEmpty } from "./ui";
import type { AdminFetch } from "./useAdminFetch";
import { cn } from "@/lib/utils/cn";

interface FixesPayload {
  suggestions: SearchFix[];
  approved: SearchFix[];
  dismissed: number;
}
type CandidateState = AliasCandidate[] | "loading" | "error";
type Change = { alias: string; kind: "approved" | "dismissed"; game?: AliasCandidate };

export function SearchFixes({ adminFetch }: { adminFetch: AdminFetch }) {
  const [data, setData] = useState<FixesPayload | null>(null);
  const [error, setError] = useState(false);
  const [candidates, setCandidates] = useState<Record<string, CandidateState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [lastChange, setLastChange] = useState<Change | null>(null);
  const [searching, setSearching] = useState<string | null>(null);
  const [showApproved, setShowApproved] = useState(false);
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await adminFetch("/api/admin/search-fixes");
      const body = (await response.json()) as FixesPayload & { error?: string };
      if (!response.ok || body.error) throw new Error(body.error);
      setData(body);
      setError(false);
      const stored: Record<string, CandidateState> = {};
      for (const fix of body.suggestions) if (fix.candidates?.length) stored[fix.alias] = fix.candidates;
      setCandidates((prev) => ({ ...stored, ...prev }));
    } catch {
      setError(true);
    }
  }, [adminFetch]);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Propose candidates for rows that have none yet, two at a time — each is
  // an IGDB round-trip, and IGDB allows four requests a second.
  useEffect(() => {
    if (!data) return;
    const queue = data.suggestions
      .filter((fix) => !fix.candidates?.length && !requested.current.has(fix.alias))
      .map((fix) => fix.alias);
    if (queue.length === 0) return;
    queue.forEach((alias) => requested.current.add(alias));
    // Not cancelled when `data` changes (an approval reloads it): queued rows
    // are already marked requested, so abandoning them would leave skeletons.
    const worker = async () => {
      for (let alias = queue.shift(); alias !== undefined && mounted.current; alias = queue.shift()) {
        setCandidates((prev) => ({ ...prev, [alias]: "loading" }));
        try {
          const response = await adminFetch(`/api/admin/search-fixes?candidates=${encodeURIComponent(alias)}`);
          const body = (await response.json()) as { candidates?: AliasCandidate[] };
          if (!response.ok || !body.candidates) throw new Error();
          setCandidates((prev) => ({ ...prev, [alias]: body.candidates! }));
        } catch {
          setCandidates((prev) => ({ ...prev, [alias]: "error" }));
        }
      }
    };
    void Promise.all([worker(), worker()]);
  }, [data, adminFetch]);

  const act = useCallback(
    async (alias: string, action: "approve" | "dismiss" | "restore", game?: AliasCandidate) => {
      setBusy(alias);
      try {
        const response = await adminFetch("/api/admin/search-fixes", {
          method: "POST",
          body: JSON.stringify({ action, alias, game }),
        });
        if (!response.ok) throw new Error();
        setSearching(null);
        setLastChange(action === "restore" ? null : { alias, kind: action === "approve" ? "approved" : "dismissed", game });
        await load();
      } catch {
        setError(true);
      } finally {
        setBusy(null);
      }
    },
    [adminFetch, load],
  );

  return (
    <Panel
      className="lg:col-span-12"
      icon={<Sparkles size={16} />}
      title="Search fixes"
      subtitle="Zero-result searches, with the games they probably meant"
      action={
        data && data.approved.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowApproved((v) => !v)}
            className="press rounded-full px-3 py-1.5 text-[13px] font-semibold text-brand-soft fine:hover:bg-fg/[0.06]"
            aria-expanded={showApproved}
          >
            {showApproved ? "Hide approved" : `Approved (${data.approved.length})`}
          </button>
        ) : undefined
      }
    >
      {lastChange && (
        <div role="status" className="mb-4 flex items-center gap-3 rounded-2xl bg-fg/[0.05] px-4 py-2.5 text-[13px]">
          <Check size={15} className="shrink-0 text-mint" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-muted">
            {lastChange.kind === "approved" ? (
              <>
                <span className="font-semibold text-text">“{lastChange.alias}”</span> now leads with{" "}
                <span className="font-semibold text-text">{lastChange.game?.name}</span> — live within ~5 minutes.
              </>
            ) : (
              <>
                Dismissed <span className="font-semibold text-text">“{lastChange.alias}”</span>.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => void act(lastChange.alias, "restore")}
            className="press inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-semibold text-brand-soft fine:hover:bg-fg/[0.06] coarse:min-h-11"
          >
            <Undo2 size={13} aria-hidden /> Undo
          </button>
        </div>
      )}

      {showApproved && data && (
        <ul className="mb-5 divide-y divide-line rounded-2xl bg-fg/[0.03] px-4">
          {data.approved.map((fix) => (
            <li key={fix.alias} className="flex items-center gap-3 py-2.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">“{fix.alias}”</span>
                <span className="text-faint"> → </span>
                <span className="text-muted">{fix.game?.name}</span>
              </span>
              <button
                type="button"
                disabled={busy === fix.alias}
                onClick={() => void act(fix.alias, "restore")}
                className="press shrink-0 rounded-full px-2.5 py-1 font-semibold text-flare fine:hover:bg-flare/10 disabled:opacity-50 coarse:min-h-11"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && !data ? (
        <PanelEmpty>
          Couldn&rsquo;t load search fixes.{" "}
          <button type="button" className="font-semibold text-brand-soft" onClick={() => void load()}>
            Retry
          </button>
        </PanelEmpty>
      ) : !data ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : data.suggestions.length === 0 ? (
        <PanelEmpty>
          Nothing to fix — no recent search came back empty.
          {data.dismissed > 0 && ` ${data.dismissed} dismissed.`}
        </PanelEmpty>
      ) : (
        <ul className="divide-y divide-line">
          {data.suggestions.map((fix) => (
            <FixRow
              key={fix.alias}
              fix={fix}
              candidates={candidates[fix.alias] ?? "loading"}
              busy={busy === fix.alias}
              searching={searching === fix.alias}
              adminFetch={adminFetch}
              onApprove={(game) => void act(fix.alias, "approve", game)}
              onDismiss={() => void act(fix.alias, "dismiss")}
              onToggleSearch={() => setSearching((current) => (current === fix.alias ? null : fix.alias))}
            />
          ))}
        </ul>
      )}
      <Caveat>
        Suggestions come from the last 90 days of zero-result searches; a query that&rsquo;s only the start of another
        one is folded into it. Approved aliases put their game first in search results, site-wide.
      </Caveat>
    </Panel>
  );
}

function FixRow({
  fix,
  candidates,
  busy,
  searching,
  adminFetch,
  onApprove,
  onDismiss,
  onToggleSearch,
}: {
  fix: SearchFix;
  candidates: CandidateState;
  busy: boolean;
  searching: boolean;
  adminFetch: AdminFetch;
  onApprove: (game: AliasCandidate) => void;
  onDismiss: () => void;
  onToggleSearch: () => void;
}) {
  return (
    <li className={cn("py-4 first:pt-0 last:pb-0 transition-opacity", busy && "pointer-events-none opacity-50")}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-6">
        <div className="flex items-start justify-between gap-3 md:w-56 md:shrink-0 md:flex-col md:justify-start">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold" title={fix.alias}>
              “{fix.alias}”
            </p>
            <p className="mt-0.5 text-[12px] text-faint">
              {fix.hits} search{fix.hits === 1 ? "" : "es"} found nothing
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 md:mt-2">
            <Button size="sm" variant="ghost" icon={<SearchIcon size={14} />} onClick={onToggleSearch} aria-label={`Search a game for “${fix.alias}”`}>
              {searching ? "Close" : "Search"}
            </Button>
            <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onDismiss} aria-label={`Dismiss “${fix.alias}”`}>
              Dismiss
            </Button>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {searching ? (
            <ManualSearch initial={fix.alias} adminFetch={adminFetch} onPick={onApprove} />
          ) : candidates === "loading" ? (
            <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[4.5rem] rounded-2xl" />
              ))}
            </div>
          ) : candidates === "error" || candidates.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-[13px] text-muted">
              {candidates === "error" ? "Couldn't propose games right now." : "No likely games found."} Use Search to
              pick one.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
              {candidates.map((game) => (
                <CandidateButton key={game.id} game={game} onPick={() => onApprove(game)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function CandidateButton({ game, onPick }: { game: AliasCandidate; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={`Approve: show ${game.name} first for this search`}
      className="press group flex min-h-[4.5rem] min-w-0 items-center gap-3 rounded-2xl bg-fg/[0.04] p-2 pr-3 text-left transition-colors fine:hover:bg-fg/[0.08]"
    >
      <Cover src={game.image} />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13px] font-semibold leading-snug">{game.name}</span>
        {game.year && <span className="mt-0.5 block text-[12px] text-faint">{game.year}</span>}
      </span>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/15 text-brand-soft transition-colors fine:group-hover:bg-brand fine:group-hover:text-white">
        <Check size={14} aria-hidden />
        <span className="sr-only">Approve</span>
      </span>
    </button>
  );
}

function Cover({ src }: { src: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- tiny provider-CDN thumbnail in a private dashboard; images are unoptimized site-wide anyway.
    <img src={src} alt="" loading="lazy" className="h-14 w-[42px] shrink-0 rounded-lg bg-fg/[0.06] object-cover" />
  ) : (
    <span aria-hidden className="h-14 w-[42px] shrink-0 rounded-lg bg-fg/[0.06]" />
  );
}

/** Game search for the owner's own pick, through the public search API. */
function ManualSearch({
  initial,
  adminFetch,
  onPick,
}: {
  initial: string;
  adminFetch: AdminFetch;
  onPick: (game: AliasCandidate) => void;
}) {
  const [term, setTerm] = useState(initial);
  const [results, setResults] = useState<AliasCandidate[] | null>(null);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      adminFetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        headers: { "x-admin-search": "1" },
      })
        .then((response) => response.json())
        .then((body: { hits?: { kind: string; id: number; slug: string; name: string; image: string | null; released?: string | null }[] }) => {
          setResults(
            (body.hits ?? [])
              .filter((hit) => hit.kind === "game")
              .slice(0, 6)
              .map((hit) => ({ id: hit.id, slug: hit.slug, name: hit.name, image: hit.image, year: hit.released?.slice(0, 4) ?? null })),
          );
        })
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, adminFetch]);

  return (
    <div>
      <label className="flex items-center gap-2 rounded-2xl bg-fg/[0.05] px-3.5 focus-within:ring-2 focus-within:ring-brand/40">
        <SearchIcon size={15} className="shrink-0 text-faint" aria-hidden />
        <span className="sr-only">Search for a game</span>
        <input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search for the game they meant"
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
      </label>
      {results && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {results.length === 0 ? (
            <p className="text-[13px] text-muted">No games match that.</p>
          ) : (
            results.map((game) => <CandidateButton key={game.id} game={game} onPick={() => onPick(game)} />)
          )}
        </div>
      )}
    </div>
  );
}
