"use client";

/**
 * Backlog roulette: "what should I play next?", answered by a slot machine.
 *
 * The pool is the reader's real backlog — games they own but haven't started
 * or finished, plus anything marked "Want to play" — minus anything that
 * isn't out yet, because you can't start a game that doesn't exist. Options
 * narrow it honestly:
 *
 *  - Mood maps from the genres stored with each record. A game with no genre
 *    data never matches a mood rather than being guessed into one.
 *  - Time uses IGDB's crowd-sourced time-to-beat. If that data isn't
 *    available the control is hidden entirely; a game with no submitted time
 *    is excluded from a length filter instead of being assumed short.
 *  - Platform lists only stores/systems the reader actually owns things on.
 *
 * The reel is a vertical strip of covers driven by one motion value. A spring
 * carries it to the pick — fast launch, long deceleration, a hair of
 * overshoot — and every cover that passes the window fires a selection
 * haptic. Reduced motion skips the reel and fades the pick in.
 */

import Link from "next/link";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  useVelocity,
} from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dices, Gamepad2, Loader2, Play, RotateCcw, Sparkles } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { ScorePill } from "@/components/ui/ScoreRing";
import { useToast } from "@/components/ui/Toast";
import { FacetControl, SegmentedControl, type FacetDef } from "@/components/filters";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { ownershipPlatform } from "@/lib/games/stores-catalog";
import { releaseState } from "@/lib/games/release-state";
import { haptic } from "@/lib/haptics";
import { usePointerFine } from "@/hooks";
import { cn } from "@/lib/utils/cn";
import type { WatchlistEntry } from "@/lib/firebase/db";
import type { TimeToBeat } from "@/lib/games/types";

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

type MoodId = "any" | "chill" | "story" | "action" | "strategy" | "versus";
type LengthId = "any" | "short" | "weekend" | "long";

/**
 * Moods are genre groups, matched against both slug and name so IGDB
 * ("role-playing-rpg") and Steam ("rpg") records land in the same place. A
 * game can satisfy several moods — an action RPG is both "Story" and "Action".
 *
 * There is deliberately no "Co-op" mood: player count isn't a genre, and
 * the stored records carry no game-mode data to answer it truthfully.
 */
const MOODS: { id: Exclude<MoodId, "any">; label: string; title: string; match: RegExp }[] = [
  {
    id: "chill",
    label: "Chill",
    title: "Puzzle, simulation, casual, card & board",
    match: /puzzle|simulat|casual|point-and-click|card|board|music|pinball|quiz|trivia|family|educational/,
  },
  {
    id: "story",
    label: "Story",
    title: "Adventure, RPG, visual novel",
    match: /adventure|role-playing|\brpg\b|visual-novel|visual novel|point-and-click/,
  },
  {
    id: "action",
    label: "Action",
    title: "Shooter, action, platformer, hack & slash, fighting",
    match: /shooter|action|hack-and-slash|hack and slash|beat-em-up|fighting|\bplatform|arcade/,
  },
  {
    id: "strategy",
    label: "Strategy",
    title: "Strategy, tactics, RTS, turn-based, MOBA",
    match: /strateg|tactic|real-time|turn-based|\brts\b|\btbs\b|moba/,
  },
  {
    id: "versus",
    label: "Competitive",
    title: "Fighting, sports, racing, MOBA",
    match: /fighting|sport|racing|moba/,
  },
];

const LENGTHS: { id: Exclude<LengthId, "any">; label: string; title: string; test: (hours: number) => boolean }[] = [
  { id: "short", label: "Under 10h", title: "Short — beaten in under 10 hours", test: (h) => h < 10 },
  { id: "weekend", label: "10–30h", title: "A weekend or two — 10 to 30 hours", test: (h) => h >= 10 && h <= 30 },
  { id: "long", label: "30h+", title: "Long haul — over 30 hours", test: (h) => h > 30 },
];

function moodsOf(entry: WatchlistEntry): Set<MoodId> {
  const text = (entry.genres ?? []).map((genre) => `${genre.slug} ${genre.name}`.toLowerCase()).join(" ");
  const out = new Set<MoodId>();
  if (!text) return out;
  for (const mood of MOODS) if (mood.match.test(text)) out.add(mood.id);
  return out;
}

/** Owned-but-not-started, or explicitly wanted — and actually playable today. */
function isBacklog(entry: WatchlistEntry): boolean {
  if (releaseState(entry) === "upcoming") return false;
  const owned = (entry.ownedOn ?? []).length > 0;
  return entry.status === "want" || (owned && entry.status === "none");
}

/** Main-story hours, preferring IGDB's "normally" figure. */
function hoursFrom(ttb: TimeToBeat | undefined): number | null {
  if (!ttb) return null;
  return ttb.normally ?? ttb.hastily ?? ttb.completely ?? null;
}

/* -------------------------------------------------------------------------- */
/* Time-to-beat lookup                                                        */
/* -------------------------------------------------------------------------- */

interface LengthData {
  /** False when the server can't provide time-to-beat at all. */
  available: boolean;
  hours: Map<number, number>;
}

/**
 * Fetches completion times for the backlog in batches of 100 (the route's
 * cap). Keyed on the id list so a status change elsewhere doesn't refetch.
 */
function useLengthData(ids: number[]): LengthData | null {
  const key = ids.join(",");
  const [state, setState] = useState<{ key: string; data: LengthData } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const all = key.split(",").map(Number);
    void (async () => {
      const hours = new Map<number, number>();
      let available = false;
      for (let offset = 0; offset < all.length; offset += 100) {
        const response = await fetch("/api/library/metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: all.slice(offset, offset + 100), include: ["timeToBeat"] }),
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as {
          timeToBeat?: Record<string, TimeToBeat>;
          timeToBeatAvailable?: boolean;
        };
        if (!payload.timeToBeatAvailable) continue;
        available = true;
        for (const [id, ttb] of Object.entries(payload.timeToBeat ?? {})) {
          const value = hoursFrom(ttb);
          if (value !== null) hours.set(Number(id), value);
        }
      }
      if (!cancelled) setState({ key, data: { available, hours } });
    })().catch(() => {
      if (!cancelled) setState({ key, data: { available: false, hours: new Map() } });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state?.key === key ? state.data : null;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/** Cover box inside the reel, plus the gap between covers. */
const COVER_W = 132;
const COVER_H = 176;
const GAP = 14;
const STEP = COVER_H + GAP;
/** Visible window: the pick plus a sliver of its neighbours. */
const WINDOW_H = COVER_H + 96;
const REST_Y = (WINDOW_H - COVER_H) / 2;

export function BacklogRoulette({
  preview,
}: {
  /**
   * Dev-only sample data for `/library/preview`, which 404s outside
   * `next dev`. Bypasses auth, the network and status writes.
   */
  preview?: { entries: WatchlistEntry[]; hours: Record<number, number> };
} = {}) {
  const { user } = useAuth();
  const live = useWatchlist();
  const entries = preview?.entries ?? live.entries;
  const loading = preview ? false : live.loading;
  const signedIn = preview ? true : Boolean(user);
  const setStatus = preview ? async () => {} : live.setStatus;
  const { toast } = useToast();
  const reduced = useReducedMotion();
  const fine = usePointerFine();

  const [mood, setMood] = useState<MoodId>("any");
  const [length, setLength] = useState<LengthId>("any");
  const [platform, setPlatform] = useState<string | null>(null);

  const backlog = useMemo(() => entries.filter(isBacklog), [entries]);
  const backlogIds = useMemo(
    () => (preview ? [] : backlog.map((entry) => entry.gameId).sort((a, b) => a - b)),
    [backlog, preview],
  );
  const fetchedLengths = useLengthData(backlogIds);
  const previewHours = preview?.hours;
  const lengthData = useMemo<LengthData | null>(
    () =>
      previewHours
        ? { available: true, hours: new Map(Object.entries(previewHours).map(([id, h]) => [Number(id), h])) }
        : fetchedLengths,
    [previewHours, fetchedLengths],
  );

  const knownLengths = lengthData?.available
    ? backlog.filter((entry) => lengthData.hours.has(entry.gameId)).length
    : 0;
  const showLength = knownLengths > 0;

  const moodCounts = useMemo(() => {
    const counts = new Map<MoodId, number>();
    for (const entry of backlog) for (const id of moodsOf(entry)) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, [backlog]);

  const platforms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of backlog) for (const slug of new Set(entry.ownedOn ?? [])) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [backlog]);

  const pool = useMemo(
    () =>
      backlog.filter((entry) => {
        if (mood !== "any" && !moodsOf(entry).has(mood)) return false;
        if (platform && !(entry.ownedOn ?? []).includes(platform)) return false;
        if (showLength && length !== "any") {
          const hours = lengthData?.hours.get(entry.gameId);
          const band = LENGTHS.find((item) => item.id === length);
          if (hours === undefined || !band?.test(hours)) return false;
        }
        return true;
      }),
    [backlog, mood, platform, length, showLength, lengthData],
  );

  /* ---------------------------------------------------------------- reel -- */

  const y = useMotionValue(REST_Y);
  const velocity = useVelocity(y);
  // Motion blur proportional to speed. Desktop only: a blur filter on a
  // moving strip of images is exactly the kind of work phones drop frames on.
  const blur = useTransform(velocity, (v) => (fine ? `blur(${Math.min(Math.abs(v) / 900, 5).toFixed(2)}px)` : "none"));

  const [strip, setStrip] = useState<WatchlistEntry[]>([]);
  const [pick, setPick] = useState<WatchlistEntry | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState<number | null>(null);
  const lastIndex = useRef(0);
  const controls = useRef<ReturnType<typeof animate> | null>(null);

  // Ticks: one selection haptic per cover crossing the centre line.
  useMotionValueEvent(y, "change", (value) => {
    if (!spinning) return;
    const index = Math.round((REST_Y - value) / STEP);
    if (index !== lastIndex.current) {
      lastIndex.current = index;
      haptic("selection");
    }
  });

  useEffect(() => () => controls.current?.stop(), []);

  // Changing the options invalidates a previous answer. Adjusted during
  // render (not in an effect) so a stale pick never paints against new options.
  const optionsKey = `${mood}|${length}|${platform ?? ""}`;
  const [lastOptions, setLastOptions] = useState(optionsKey);
  if (optionsKey !== lastOptions) {
    setLastOptions(optionsKey);
    if (!spinning) setPick(null);
  }

  const spin = useCallback(() => {
    if (pool.length === 0 || spinning) return;
    // Never the same game twice in a row when there's a choice.
    const choices = pool.length > 1 && pick ? pool.filter((entry) => entry.gameId !== pick.gameId) : pool;
    const winner = choices[Math.floor(Math.random() * choices.length)];
    setPick(null);
    setStarted(null);

    if (reduced) {
      setStrip([winner]);
      y.set(REST_Y);
      setPick(winner);
      haptic("success");
      return;
    }

    // Filler: shuffled passes over the pool, enough for a satisfying blur.
    const fillerCount = 22 + Math.floor(Math.random() * 8);
    const filler: WatchlistEntry[] = [];
    while (filler.length < fillerCount) {
      const pass = [...pool].sort(() => Math.random() - 0.5);
      filler.push(...pass);
    }
    const current = strip.length > 0 ? strip[Math.round((REST_Y - y.get()) / STEP)] ?? strip[0] : pool[0];
    const next = [current, ...filler.slice(0, fillerCount), winner];
    setStrip(next);
    y.set(REST_Y);
    lastIndex.current = 0;
    setSpinning(true);
    haptic("light");

    const target = REST_Y - (next.length - 1) * STEP;
    controls.current = animate(y, target, {
      type: "spring",
      // Under-damped just enough (ζ ≈ 0.9) to settle with a few pixels of
      // overshoot — the "clunk" of a reel landing — without ever showing the
      // neighbouring cover as the answer.
      stiffness: 9,
      damping: 5.4,
      mass: 1,
      restDelta: 0.5,
      restSpeed: 4,
      onComplete: () => {
        setSpinning(false);
        setPick(winner);
        haptic("success");
      },
    });
  }, [pool, spinning, pick, reduced, strip, y]);

  const startPlaying = async () => {
    if (!pick) return;
    setStarting(true);
    try {
      await setStatus(pick.gameId, "playing");
      setStarted(pick.gameId);
      haptic("success");
      toast(`${pick.name} is now marked as playing. Have fun.`, "success");
    } catch (error) {
      haptic("warning");
      toast(error instanceof Error ? error.message : "Couldn't update the status.", "error");
    } finally {
      setStarting(false);
    }
  };

  /* -------------------------------------------------------------- states -- */

  // Signed out, loading, or an empty account: the library below already says
  // so, and a second message here would just repeat it.
  if (!signedIn || loading || entries.length === 0) return null;

  if (backlog.length === 0) {
    return (
      <section aria-labelledby="roulette-title" className="glass mb-6 flex items-center gap-4 rounded-3xl p-4 sm:p-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-mint/12 text-mint">
          <Sparkles size={19} />
        </span>
        <div className="min-w-0">
          <h2 id="roulette-title" className="text-[15px] font-semibold">Backlog clear</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">
            Nothing you own is waiting to be started, and nothing released is marked “Want to play”. The roulette
            appears here when there is.
          </p>
        </div>
      </section>
    );
  }

  const platformFacet: FacetDef = {
    id: "roulette-platform",
    label: "Platform",
    mode: "single",
    anyLabel: "Any platform",
    options: platforms.map(([slug, count]) => {
      const meta = ownershipPlatform(slug);
      return {
        value: slug,
        label: meta?.name ?? slug,
        short: meta?.name.replace(/^PC · /, "") ?? slug,
        count,
        icon: meta?.icon ? <BrandIcon name={meta.icon} size={14} title={null} /> : undefined,
      };
    }),
    selected: platform ? [platform] : [],
    onChange: (next) => setPlatform(next[0] ?? null),
  };

  const visibleMoods = MOODS.filter((item) => (moodCounts.get(item.id) ?? 0) > 0);
  const displayStrip = strip.length > 0 ? strip : pool.slice(0, 3);
  const idle = !spinning && !pick;
  const isStarted = pick !== null && started === pick.gameId;

  return (
    <section
      aria-labelledby="roulette-title"
      className="glass relative mb-8 overflow-hidden rounded-3xl p-4 sm:p-6"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-brand/15 blur-3xl"
      />

      <div className="relative flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand/15 text-brand-soft">
          <Dices size={19} />
        </span>
        <div className="min-w-0">
          <h2 id="roulette-title" className="font-display text-xl font-bold tracking-[-0.02em] sm:text-2xl">
            Backlog roulette
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            Can’t choose? Spin from{" "}
            <span className="font-semibold tabular-nums text-text">{pool.length}</span>{" "}
            {pool.length === 1 ? "game" : "games"} you own but haven’t started, or want to play.
          </p>
        </div>
      </div>

      <div className="relative mt-5 grid gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-10">
        {/* Reel */}
        <div className="flex justify-center md:justify-start">
          <div
            className="relative overflow-hidden rounded-[26px] border border-fg/10 bg-bg/60 shadow-[inset_0_2px_12px_#000000a6]"
            style={{ width: COVER_W + 40, height: WINDOW_H }}
            aria-hidden
          >
            <motion.div
              className="absolute left-1/2 top-0 -translate-x-1/2"
              style={{ y, filter: blur, width: COVER_W }}
            >
              {displayStrip.map((entry, index) => (
                <div
                  key={`${entry.gameId}-${index}`}
                  className="relative overflow-hidden rounded-2xl bg-panel shadow-[0_10px_24px_-10px_#000000cc]"
                  style={{ width: COVER_W, height: COVER_H, marginBottom: GAP }}
                >
                  <GameCover
                    name={entry.name}
                    slug={entry.slug}
                    image={entry.image}
                    imageFallback={entry.imageFallback}
                    width={COVER_W * 2}
                    sizes={`${COVER_W}px`}
                  />
                </div>
              ))}
            </motion.div>

            {/* Glass edges: neighbours fade out, the window reads as a slot. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-bg to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-bg to-transparent" />
            <div
              className={cn(
                "pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-[18px] border-2 transition-colors duration-500",
                pick ? "border-brand shadow-[0_0_30px_-4px_rgba(138,114,255,0.8)]" : "border-fg/15",
              )}
              style={{ top: REST_Y - 4, width: COVER_W + 8, height: COVER_H + 8 }}
            />
            {idle && pool.length > 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-bg/45">
                <span className="material-thin grid h-12 w-12 place-items-center rounded-full text-xl font-bold text-white">?</span>
              </div>
            )}
          </div>
        </div>
        {/* Options */}
        <div className="min-w-0">
          <div className="space-y-3.5">
            {visibleMoods.length > 0 && (
              <OptionRow label="Mood">
                <SegmentedControl
                  label="Mood"
                  value={mood}
                  onChange={setMood}
                  fill={false}
                  className="max-w-full sm:w-fit"
                  segments={[
                    { value: "any" as MoodId, label: "Any" },
                    ...visibleMoods.map((item) => ({ value: item.id as MoodId, label: item.label, title: item.title })),
                  ]}
                />
              </OptionRow>
            )}

            {showLength && (
              <OptionRow
                label="Time"
                hint={
                  length !== "any" && knownLengths < backlog.length
                    ? `Only the ${knownLengths} games with a known length can match`
                    : undefined
                }
              >
                <SegmentedControl
                  label="Time available"
                  value={length}
                  onChange={setLength}
                  fill={false}
                  className="max-w-full sm:w-fit"
                  segments={[
                    { value: "any" as LengthId, label: "Any length" },
                    ...LENGTHS.map((item) => ({ value: item.id as LengthId, label: item.label, title: item.title })),
                  ]}
                />
              </OptionRow>
            )}

            {/* The button names itself, so no heading above it. */}
            {platforms.length > 1 && <FacetControl facet={platformFacet} />}
          </div>

          {/* Result */}
          <div className="mt-6 md:min-h-[92px]" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {pick ? (
                <motion.div
                  key={pick.gameId}
                  initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0.25 : 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                  <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-brand-soft">Your next game</p>
                  <div className="mt-1 flex items-start gap-2">
                    <Link
                      href={`/game/${pick.slug}`}
                      className="min-w-0 font-display text-2xl font-bold leading-tight tracking-[-0.02em] hover:text-brand-soft"
                    >
                      {pick.name}
                    </Link>
                    <ScorePill score={pick.metacritic} className="mt-1.5 shrink-0" />
                  </div>
                  <PickFacts entry={pick} hours={lengthData?.hours.get(pick.gameId) ?? null} />
                </motion.div>
              ) : pool.length === 0 ? (
                <motion.p key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-muted">
                  Nothing in your backlog matches those options.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMood("any");
                      setLength("any");
                      setPlatform(null);
                    }}
                    className="font-medium text-brand-soft underline underline-offset-2"
                  >
                    Reset options
                  </button>
                </motion.p>
              ) : (
                <motion.p key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-muted">
                  {spinning ? "Spinning…" : "Set the mood, then spin."}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-4 flex flex-wrap gap-2.5">
            {pick ? (
              <>
                <button
                  type="button"
                  onClick={startPlaying}
                  disabled={starting || isStarted}
                  className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-5 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_#ffffff40,0_10px_30px_-10px_rgba(138,114,255,0.75)] disabled:opacity-70"
                >
                  {starting ? <Loader2 size={16} className="animate-spin" /> : isStarted ? <Gamepad2 size={16} /> : <Play size={16} fill="currentColor" />}
                  {isStarted ? "Now playing" : "Start playing"}
                </button>
                <button
                  type="button"
                  onClick={spin}
                  disabled={pool.length < 2}
                  className="press inline-flex min-h-11 items-center gap-2 rounded-full border border-fg/10 bg-fg/[0.07] px-5 text-[15px] font-semibold text-text transition-colors fine:hover:bg-fg/[0.11] disabled:opacity-40"
                >
                  <RotateCcw size={16} />
                  Spin again
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={spin}
                disabled={pool.length === 0 || spinning}
                className="press inline-flex min-h-12 items-center gap-2 rounded-full bg-brand px-6 text-[16px] font-semibold text-white shadow-[inset_0_1px_0_#ffffff40,0_10px_30px_-10px_rgba(138,114,255,0.75)] disabled:opacity-50"
              >
                <Dices size={18} className={cn(spinning && !reduced && "animate-spin")} />
                {spinning ? "Spinning…" : "Spin"}
              </button>
            )}
          </div>
        </div>

      </div>
    </section>
  );
}

function OptionRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{label}</p>
      {children}
      {hint && <p className="mt-1.5 px-1 text-[11px] text-faint">{hint}</p>}
    </div>
  );
}

function PickFacts({ entry, hours }: { entry: WatchlistEntry; hours: number | null }) {
  // "PC · Steam" → "Steam": the middle dot is this line's separator.
  const owned = (entry.ownedOn ?? []).map((slug) => (ownershipPlatform(slug)?.name ?? slug).replace(/^PC · /, ""));
  const facts = [
    owned.length > 0 ? `Owned on ${owned.slice(0, 2).join(", ")}${owned.length > 2 ? ` +${owned.length - 2}` : ""}` : "On your want-to-play list",
    hours !== null ? `About ${hours}h to beat` : null,
    (entry.genres ?? []).slice(0, 2).map((genre) => genre.name).join(" · ") || null,
  ].filter(Boolean);
  return (
    <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
      {facts.join("  ·  ")}
    </p>
  );
}
