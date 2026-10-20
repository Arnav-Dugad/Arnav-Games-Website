"use client";

/**
 * "Import from Steam": paste a profile, review what we found, add it.
 *
 *  1. Ask the server whether import is switched on (`GET /api/steam/import`
 *     — it needs a Steam Web API key). If not, say it's coming, warmly.
 *  2. The reader pastes a profile link / custom URL name / SteamID64; the
 *     server reads the owned games (most played first) and matches the first
 *     page to our catalogue, and this sheet pages through the rest, one small
 *     request at a time.
 *  3. Every matched game gets a proposed status from its hours (see
 *     `inferImportStatus`) that the reader can change or skip, row by row or
 *     in bulk. Nothing is written until they confirm.
 *  4. The browser writes the rows to the reader's own library (owned on
 *     Steam, statuses only ever moving forward) and their Steam hours into
 *     their personal playtime, never lowering a total they already have.
 *
 * Apps the catalogue doesn't know (tools, soundtracks, demos, delisted
 * games) are counted and left out rather than guessed at.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, ExternalLink, Loader2, Lock, Search } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { GameCover } from "@/components/game/GameCover";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { importLibraryGames } from "@/lib/firebase/db";
import { haptic } from "@/lib/haptics";
import { importPlaytime } from "@/lib/personal/store";
import {
  CHOICE_LABEL,
  MATCH_PAGE,
  inferImportStatus,
  parseSteamProfile,
  statusForChoice,
  type ImportChoice,
  type SteamAccount,
  type SteamImportResponse,
  type SteamMatch,
  type SteamOwnedGame,
} from "@/lib/personal/steam-import";
import { cn } from "@/lib/utils/cn";

type Phase =
  | { kind: "checking" }
  | { kind: "unconfigured" }
  | { kind: "input"; error?: { reason: string; message: string } }
  | { kind: "fetching" }
  | { kind: "matching" }
  | { kind: "review" }
  | { kind: "importing"; step: string }
  | { kind: "done"; added: number; updated: number; hours: number };

interface Row {
  game: SteamOwnedGame;
  match: SteamMatch;
  choice: ImportChoice;
  inLibrary: boolean;
}

type Filter = "all" | "played" | "unplayed" | "library";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "played", label: "Played" },
  { key: "unplayed", label: "Never played" },
  { key: "library", label: "Already in library" },
];
const SHOWN_STEP = 60;
const CHOICES: ImportChoice[] = ["backlog", "playing", "finished", "shelved", "skip"];
const LAST_PLAYED = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

const hoursLabel = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} h`);

let configuredAnswer: boolean | null = null;

export function SteamImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Import from Steam" description="Your Steam games, hours and progress, in your library.">
      {open && <SteamImport onClose={onClose} />}
    </Sheet>
  );
}

function SteamImport({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { entries } = useWatchlist();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>(configuredAnswer === null ? { kind: "checking" } : configuredAnswer ? { kind: "input" } : { kind: "unconfigured" });
  const [profile, setProfile] = useState("");
  const [account, setAccount] = useState<SteamAccount | null>(null);
  const [owned, setOwned] = useState<SteamOwnedGame[]>([]);
  const [matches, setMatches] = useState<Map<number, SteamMatch>>(new Map());
  const [processed, setProcessed] = useState(0);
  const [choices, setChoices] = useState<Map<number, ImportChoice>>(new Map());
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(SHOWN_STEP);
  const cancelled = useRef(false);

  useEffect(() => {
    if (phase.kind !== "checking") return;
    let active = true;
    fetch("/api/steam/import")
      .then((response) => (response.ok ? (response.json() as Promise<{ configured?: boolean }>) : { configured: false }))
      .catch(() => ({ configured: false }))
      .then(({ configured }) => {
        configuredAnswer = Boolean(configured);
        if (active) setPhase(configured ? { kind: "input" } : { kind: "unconfigured" });
      });
    return () => {
      active = false;
    };
  }, [phase.kind]);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const libraryIds = useMemo(() => new Set(entries.map((entry) => entry.gameId)), [entries]);

  const rows = useMemo<Row[]>(() => {
    const seen = new Set<number>();
    const out: Row[] = [];
    for (const game of owned) {
      const match = matches.get(game.appid);
      // Two Steam apps can map to one catalogue game (a game and its
      // remaster's old listing): the most played one represents it.
      if (!match || seen.has(match.id)) continue;
      seen.add(match.id);
      const proposed = inferImportStatus({ minutes: game.minutes, lastPlayed: game.lastPlayed, timeToBeat: match.hours });
      out.push({ game, match, choice: choices.get(match.id) ?? proposed, inLibrary: libraryIds.has(match.id) });
    }
    return out;
  }, [owned, matches, choices, libraryIds]);

  const included = rows.filter((row) => row.choice !== "skip");
  const unmatched = processed - matches.size;
  const filtered = rows.filter((row) =>
    filter === "all" ? true : filter === "played" ? row.game.minutes > 0 : filter === "unplayed" ? row.game.minutes === 0 : row.inLibrary,
  );

  const post = async (body: unknown): Promise<SteamImportResponse> => {
    if (!user) return { ok: false, reason: "signed-out", message: "Sign in again to import your Steam library." };
    const response = await fetch("/api/steam/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(body),
    });
    return (await response.json().catch(() => ({ ok: false, reason: "steam-down", message: "Something went wrong. Try again." }))) as SteamImportResponse;
  };

  const start = async () => {
    const ref = parseSteamProfile(profile);
    if (!ref) {
      setPhase({ kind: "input", error: { reason: "bad-input", message: "That doesn't look like a Steam profile. Paste your profile link, custom URL name or SteamID64." } });
      return;
    }
    haptic("selection");
    setPhase({ kind: "fetching" });
    try {
      const first = await post({ profile });
      if (!first.ok) {
        setPhase(first.reason === "not-configured" ? { kind: "unconfigured" } : { kind: "input", error: first });
        return;
      }
      if (!("games" in first)) throw new Error("unexpected");
      const map = new Map(first.matches.map((match) => [match.appid, match]));
      setAccount(first.account);
      setOwned(first.games);
      setMatches(map);
      setProcessed(first.matched.length);
      setPhase({ kind: "matching" });

      // The rest, one page at a time, in the order of most played.
      let done = first.matched.length;
      for (let offset = done; offset < first.games.length; offset += MATCH_PAGE) {
        if (cancelled.current) return;
        const page = first.games.slice(offset, offset + MATCH_PAGE).map((game) => game.appid);
        let answer = await post({ appids: page });
        if (!answer.ok && answer.reason !== "signed-out") answer = await post({ appids: page });
        if (!answer.ok) break;
        for (const match of answer.matches) map.set(match.appid, match);
        done += page.length;
        setMatches(new Map(map));
        setProcessed(done);
      }
      if (!cancelled.current) setPhase({ kind: "review" });
    } catch {
      setPhase({ kind: "input", error: { reason: "steam-down", message: "Something went wrong reaching Steam. Try again in a minute." } });
    }
  };

  const setChoice = (ids: number[], choice: ImportChoice) => {
    setChoices((previous) => {
      const next = new Map(previous);
      for (const id of ids) next.set(id, choice);
      return next;
    });
  };

  const commit = async () => {
    if (!user || included.length === 0) return;
    haptic("selection");
    try {
      setPhase({ kind: "importing", step: `Adding ${included.length.toLocaleString("en")} games…` });
      const writes = await importLibraryGames(
        user.uid,
        included.map((row) => ({
          match: row.match,
          status: statusForChoice(row.choice) ?? "none",
          lastPlayed: row.game.lastPlayed > 0 ? row.game.lastPlayed * 1000 : null,
        })),
        entries,
      );
      setPhase({ kind: "importing", step: "Adding your hours…" });
      const hours: Record<number, number> = {};
      for (const row of included) if (row.game.minutes >= 6) hours[row.match.id] = row.game.minutes / 60;
      const hourWrites = await importPlaytime(user.uid, hours);
      const added = included.filter((row) => !row.inLibrary).length;
      haptic("success");
      setPhase({
        kind: "done",
        added,
        updated: Math.max(0, writes - added),
        hours: hourWrites ? Math.round(Object.values(hours).reduce((sum, value) => sum + value, 0)) : 0,
      });
    } catch (error) {
      haptic("warning");
      toast(error instanceof Error && /permission/i.test(error.message) ? "Your library refused the import. Try again later." : "The import stopped partway. Run it again — nothing is duplicated.", "error");
      setPhase({ kind: "review" });
    }
  };

  /* -------------------------------------------------------------------- */

  if (phase.kind === "checking") {
    return <div className="grid min-h-48 place-items-center"><Loader2 size={22} className="animate-spin text-faint" aria-label="Checking" /></div>;
  }

  if (phase.kind === "unconfigured") {
    return (
      <div className="space-y-5 pb-2 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[1.25rem] bg-[#171a21] text-white shadow-lg">
          <BrandIcon name="steam" size={30} title={null} />
        </span>
        <div>
          <h3 className="font-display text-[22px] font-bold tracking-[-0.02em]">Steam import is coming soon</h3>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted">
            Soon you&apos;ll paste your Steam profile and bring every game across — owned on Steam, your hours, and a sensible status for each, all reviewed by you before anything changes.
          </p>
        </div>
        <ul className="mx-auto max-w-sm space-y-2 text-left text-[14px] text-muted">
          {["Hours played go into your stats", "Recently played games land in Playing", "Nothing is added until you confirm"].map((line) => (
            <li key={line} className="flex items-center gap-2.5"><CheckCircle2 size={16} className="shrink-0 text-mint" aria-hidden />{line}</li>
          ))}
        </ul>
        <button type="button" onClick={onClose} className="press min-h-12 w-full rounded-full bg-fg/[0.08] text-[15px] font-semibold">Got it</button>
      </div>
    );
  }

  if (phase.kind === "input" || phase.kind === "fetching") {
    const error = phase.kind === "input" ? phase.error : undefined;
    const busy = phase.kind === "fetching";
    return (
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void start();
        }}
      >
        <div>
          <label htmlFor="steam-profile" className="text-[13px] font-semibold text-text">Your Steam profile</label>
          <div className="relative mt-2">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
            <input
              id="steam-profile"
              value={profile}
              onChange={(event) => setProfile(event.target.value)}
              placeholder="steamcommunity.com/id/yourname"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby="steam-profile-help"
              className="block h-12 w-full rounded-xl border border-line bg-fg/[0.04] pl-11 pr-4 text-[16px] text-text placeholder:text-faint focus:border-line-strong focus:outline-none disabled:opacity-60"
            />
          </div>
          <p id="steam-profile-help" className="mt-2 text-[12px] leading-relaxed text-faint">
            Your profile link, custom URL name or 17-digit SteamID. In Steam: your name → Profile, then copy the address.
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-2xl border border-flare/25 bg-flare/[0.06] p-4 text-[14px] leading-relaxed">
            <p className="flex items-start gap-2 font-semibold text-text">
              {error.reason === "private" || error.reason === "empty" ? <Lock size={16} className="mt-0.5 shrink-0 text-flare" aria-hidden /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-flare" aria-hidden />}
              {error.message}
            </p>
            {(error.reason === "private" || error.reason === "empty") && (
              <ol className="mt-2.5 list-decimal space-y-1 pl-5 text-muted">
                <li>Open <a href="https://steamcommunity.com/my/edit/settings" target="_blank" rel="noopener noreferrer" className="font-medium text-brand-soft hover:underline">Steam privacy settings <ExternalLink size={11} className="inline" aria-hidden /></a></li>
                <li>Set <span className="font-semibold text-text">My profile</span> and <span className="font-semibold text-text">Game details</span> to Public</li>
                <li>Untick “Always keep my total playtime private” so we can see your hours</li>
                <li>Come back and try again — you can make it private again afterwards</li>
              </ol>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !profile.trim()}
          className="press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brand px-6 text-[15px] font-semibold text-white transition-opacity disabled:opacity-45"
        >
          {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Reading your Steam library…</> : <>Find my games <ArrowRight size={16} aria-hidden /></>}
        </button>
        <p className="text-center text-[12px] leading-relaxed text-faint">
          We only read your public game list and hours. Nothing is added until you review it.
        </p>
      </form>
    );
  }

  if (phase.kind === "matching") {
    const share = owned.length ? processed / owned.length : 0;
    return (
      <div className="space-y-5 py-4" aria-live="polite">
        <AccountLine account={account} owned={owned.length} />
        <div>
          <p className="text-[15px] font-semibold">Matching your games…</p>
          <p className="mt-1 text-[13px] text-muted">{processed.toLocaleString("en")} of {owned.length.toLocaleString("en")} checked · {matches.size.toLocaleString("en")} found</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-fg/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Matching progress">
            <div className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out" style={{ width: `${Math.max(4, share * 100)}%` }} />
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            cancelled.current = true;
            setPhase({ kind: "review" });
          }}
          className="press min-h-11 w-full rounded-full bg-fg/[0.06] text-[14px] font-semibold text-muted"
        >
          Review what&apos;s matched so far
        </button>
      </div>
    );
  }

  if (phase.kind === "importing") {
    return (
      <div className="grid min-h-48 place-items-center text-center" aria-live="polite">
        <div>
          <Loader2 size={24} className="mx-auto animate-spin text-brand-soft" aria-hidden />
          <p className="mt-3 text-[15px] font-semibold">{phase.step}</p>
          <p className="mt-1 text-[13px] text-muted">Keep this open for a moment.</p>
        </div>
      </div>
    );
  }

  if (phase.kind === "done") {
    return (
      <div className="space-y-5 py-2 text-center">
        <CheckCircle2 size={44} className="mx-auto text-mint" aria-hidden />
        <div>
          <h3 className="font-display text-[22px] font-bold">Your Steam library is in</h3>
          <p className="mt-2 text-[15px] text-muted">
            {phase.added.toLocaleString("en")} new {phase.added === 1 ? "game" : "games"}
            {phase.updated > 0 && <>, {phase.updated.toLocaleString("en")} updated</>}
            {phase.hours > 0 && <>, {phase.hours.toLocaleString("en")} hours of play</>}.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href="/stats" onClick={onClose} className="press inline-flex min-h-12 items-center justify-center rounded-full bg-fg/[0.08] text-[15px] font-semibold">See your stats</Link>
          <button type="button" onClick={onClose} className="press min-h-12 rounded-full bg-brand text-[15px] font-semibold text-white">Done</button>
        </div>
      </div>
    );
  }

  // Review ------------------------------------------------------------------
  const totalHours = Math.round(included.reduce((sum, row) => sum + row.game.minutes, 0) / 60);
  return (
    <div className="flex flex-col gap-4">
      <AccountLine account={account} owned={owned.length} />
      <p className="text-[13px] leading-relaxed text-muted">
        We matched <span className="font-semibold text-text">{rows.length.toLocaleString("en")}</span> of your games.
        {unmatched > 0 && <> {unmatched.toLocaleString("en")} more (usually tools, soundtracks, demos or delisted games) aren&apos;t in our catalogue and are left out.</>}
        {processed < owned.length && <> {(owned.length - processed).toLocaleString("en")} weren&apos;t checked.</>}
        {" "}Each has a suggested status from its hours — change any of them.
      </p>

      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={filter === item.key}
            onClick={() => {
              setFilter(item.key);
              setShown(SHOWN_STEP);
            }}
            className={cn("press min-h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold coarse:min-h-11", filter === item.key ? "bg-fg/[0.16] text-text" : "bg-fg/[0.06] text-muted")}
          >
            {item.label}
          </button>
        ))}
      </div>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span>Set these {filtered.length.toLocaleString("en")} to</span>
          {(["backlog", "skip"] as const).map((choice) => (
            <button key={choice} type="button" onClick={() => setChoice(filtered.map((row) => row.match.id), choice)} className="press min-h-9 rounded-full border border-line px-3 font-semibold text-text coarse:min-h-11">
              {CHOICE_LABEL[choice]}
            </button>
          ))}
          <button type="button" onClick={() => setChoices((previous) => { const next = new Map(previous); for (const row of filtered) next.delete(row.match.id); return next; })} className="press min-h-9 rounded-full px-3 font-semibold text-brand-soft coarse:min-h-11">
            Suggested
          </button>
        </div>
      )}

      <ul className="divide-y divide-line">
        {filtered.slice(0, shown).map((row) => (
          <li key={row.match.id} className={cn("flex items-center gap-3 py-2.5", row.choice === "skip" && "opacity-50")}>
            <span className="relative h-14 w-[42px] shrink-0 overflow-hidden rounded-lg bg-fg/[0.06]">
              <GameCover name={row.match.name} slug={row.match.slug} image={row.match.image} imageFallback={row.match.imageFallback} width={84} sizes="42px" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{row.match.name}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                <span className="inline-flex items-center gap-1"><Clock3 size={11} aria-hidden />{row.game.minutes ? hoursLabel(row.game.minutes) : "Never played"}</span>
                {row.game.lastPlayed > 0 && <span>· {LAST_PLAYED.format(row.game.lastPlayed * 1000)}</span>}
                {row.inLibrary && <span className="text-mint">· In your library</span>}
              </p>
            </div>
            <label className="sr-only" htmlFor={`steam-choice-${row.match.id}`}>Status for {row.match.name}</label>
            <select
              id={`steam-choice-${row.match.id}`}
              value={row.choice}
              onChange={(event) => setChoice([row.match.id], event.target.value as ImportChoice)}
              className="h-10 shrink-0 rounded-full border border-line bg-fg/[0.04] px-3 text-[13px] font-semibold text-text focus:border-line-strong focus:outline-none coarse:h-11"
            >
              {CHOICES.map((choice) => <option key={choice} value={choice}>{CHOICE_LABEL[choice]}</option>)}
            </select>
          </li>
        ))}
      </ul>
      {filtered.length > shown && (
        <button type="button" onClick={() => setShown((value) => value + SHOWN_STEP)} className="press min-h-11 rounded-full bg-fg/[0.06] text-[14px] font-semibold text-muted">
          Show {Math.min(SHOWN_STEP, filtered.length - shown)} more
        </button>
      )}
      {filtered.length === 0 && <p className="py-6 text-center text-[14px] text-muted">Nothing in this view.</p>}

      <div className="sticky bottom-0 -mx-1 bg-gradient-to-t from-panel via-panel/95 to-transparent px-1 pb-1 pt-4">
        <button
          type="button"
          onClick={() => void commit()}
          disabled={included.length === 0}
          className="press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brand px-6 text-[15px] font-semibold text-white shadow-lg transition-opacity disabled:opacity-45"
        >
          Add {included.length.toLocaleString("en")} {included.length === 1 ? "game" : "games"}
          {totalHours > 0 && <span className="font-normal opacity-80">· {totalHours.toLocaleString("en")} h</span>}
        </button>
        <p className="mt-2 text-center text-[11px] text-faint">Shelved games keep their hours with no status. Statuses already in your library only move forward.</p>
      </div>
    </div>
  );
}

function AccountLine({ account, owned }: { account: SteamAccount | null; owned: number }) {
  if (!account) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-fg/[0.04] p-3">
      {account.avatar ? (
        // A Steam CDN avatar: plain img, nothing to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={account.avatar} alt="" width={40} height={40} className="h-10 w-10 rounded-xl" />
      ) : (
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#171a21] text-white"><BrandIcon name="steam" size={20} title={null} /></span>
      )}
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold">{account.name ?? "Your Steam account"}</p>
        <p className="text-[12px] text-muted">{owned.toLocaleString("en")} games on Steam</p>
      </div>
    </div>
  );
}
