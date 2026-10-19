"use client";

/**
 * Backlog roulette: "what should I play next?", answered by a dealer.
 *
 * The pool is the reader's real backlog — games they own but haven't started
 * or finished, plus anything marked "Want to play" — minus anything that
 * isn't out yet, because you can't start a game that doesn't exist. Options
 * narrow it honestly:
 *
 *  - Mood maps from the genres stored with each record. A game with no genre
 *    data never matches a mood rather than being guessed into one.
 *  - Time uses IGDB's crowd-sourced time-to-beat (shared with the rest of the
 *    library through `useTimeToBeat`). Without that data the control is
 *    hidden; a game with no submitted time is excluded from a length filter
 *    instead of being assumed short.
 *  - Platform lists only stores/systems the reader actually owns things on.
 *
 * The pick is a card trick: a face-down deck is riffled twice, fanned, the
 * other cards are dealt away one by one and the last card flips face-up.
 * Every card that lands ticks a selection haptic. The winner is chosen before
 * the shuffle starts — the animation is theatre, never the randomness — and
 * reduced motion skips straight to the face-up card.
 */

import Link from "next/link";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dices, Gamepad2, Loader2, Play, RotateCcw, Sparkles } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { ScorePill } from "@/components/ui/ScoreRing";
import { useToast } from "@/components/ui/Toast";
import { FacetControl, SegmentedControl, type FacetDef } from "@/components/filters";
import { useTimeToBeat } from "@/components/stats/useTimeToBeat";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { ownershipPlatform } from "@/lib/games/stores-catalog";
import { isBacklog } from "./backlog";
import { haptic } from "@/lib/haptics";
import type { WatchlistEntry } from "@/lib/firebase/db";
import type { TimeToBeatLike } from "@/lib/games/stats";

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

/** Main-story hours, preferring IGDB's "normally" figure. */
function hoursFrom(ttb: TimeToBeatLike | undefined): number | null {
  if (!ttb) return null;
  return ttb.normally ?? ttb.hastily ?? ttb.completely ?? null;
}

/* -------------------------------------------------------------------------- */
/* The deck                                                                   */
/* -------------------------------------------------------------------------- */

const CARD_W = 132;
const CARD_H = 176;
/** Six cards fan to ~265px — inside a 320px phone's panel with room to spare. */
const DECK_MAX = 6;
const RIFFLE_STAGGER = 0.035;
const DEAL_STAGGER = 0.085;

type Phase = "stack" | "split" | "riffle" | "fan" | "deal" | "reveal";

interface CardSlot {
  i: number;
  n: number;
  winner: boolean;
  /** Order in which a losing card leaves the table. */
  out: number;
  /** -1 left, 1 right. */
  side: number;
  /** How many cards leave before the winner moves. */
  losers: number;
}

/** A hair of rotation per card so the stack reads as paper, not one block. */
const jitter = (i: number) => (((i * 47) % 7) - 3) * 0.55;
const stackPose = (c: CardSlot) => ({ x: 0, y: -c.i * 1.5, rotate: jitter(c.i), scale: 1, opacity: 1, zIndex: c.i });

/*
 * Every variant spells out every value: motion animates a value that a new
 * variant omits back to its `initial` ("enter", invisible), which would blink
 * the deck out between phases.
 */
const CARD: Variants = {
  enter: (c: CardSlot) => ({ ...stackPose(c), y: -c.i * 1.5 - 10, opacity: 0 }),
  stack: (c: CardSlot) => ({ ...stackPose(c), transition: { duration: 0.16, ease: "easeOut" } }),
  // Two halves lifted apart, tilted like thumbs bending them for the riffle.
  split: (c: CardSlot) => ({
    x: c.i % 2 ? 64 : -64,
    y: -8 - Math.floor(c.i / 2) * 2,
    rotate: c.i % 2 ? 8 : -8,
    scale: 1,
    opacity: 1,
    zIndex: c.i,
    transition: { duration: 0.22, ease: [0.3, 0, 0.2, 1] },
  }),
  // Alternating sides drop back in one at a time: the interleave.
  riffle: (c: CardSlot) => ({
    ...stackPose(c),
    transition: { delay: c.i * RIFFLE_STAGGER, type: "spring", stiffness: 700, damping: 36 },
  }),
  fan: (c: CardSlot) => {
    const offset = c.i - (c.n - 1) / 2;
    return {
      x: offset * 17,
      y: Math.abs(offset) * 4,
      rotate: offset * 6,
      scale: 1,
      opacity: 1,
      zIndex: c.i,
      transition: { delay: c.i * 0.04, type: "spring", stiffness: 420, damping: 30 },
    };
  },
  deal: (c: CardSlot) =>
    c.winner
      ? { x: 0, y: 0, rotate: 0, scale: 1.04, opacity: 1, zIndex: 20, transition: { delay: c.losers * DEAL_STAGGER + 0.05, type: "spring", stiffness: 300, damping: 26 } }
      : {
          x: c.side * 300,
          y: -30 + c.out * 6,
          rotate: c.side * 28,
          scale: 1,
          opacity: 0,
          transition: { delay: c.out * DEAL_STAGGER, duration: 0.36, ease: [0.5, 0, 0.75, 0] },
        },
  reveal: (c: CardSlot) =>
    c.winner
      ? { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, zIndex: 20, transition: { type: "spring", stiffness: 260, damping: 22 } }
      : { x: c.side * 300, y: -30 + c.out * 6, rotate: c.side * 28, scale: 1, opacity: 0, zIndex: c.i },
};

/** The face: rotateY 180° shows the front, which is mounted pre-rotated. */
const FLIP: Variants = {
  enter: { rotateY: 0 },
  stack: { rotateY: 0 },
  split: { rotateY: 0 },
  riffle: { rotateY: 0 },
  fan: { rotateY: 0 },
  deal: { rotateY: 0 },
  reveal: (c: CardSlot) => (c.winner ? { rotateY: 180, transition: { duration: 0.55, ease: [0.2, 0.7, 0.2, 1] } } : { rotateY: 0 }),
};

interface Deal {
  id: number;
  cards: WatchlistEntry[];
  winner: number;
}

/** Schedule of the trick, in ms from the tap. */
function timeline(n: number) {
  const riffle = n * RIFFLE_STAGGER * 1000 + 200;
  const split1 = 170;
  const riffle1 = split1 + 240;
  const split2 = riffle1 + riffle + 20;
  const riffle2 = split2 + 240;
  const fan = riffle2 + riffle + 40;
  const deal = fan + n * 40 + 280;
  const reveal = deal + (n - 1) * DEAL_STAGGER * 1000 + 460;
  const done = reveal + 560;
  return { split1, riffle1, split2, riffle2, fan, deal, reveal, done };
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function BacklogRoulette({
  preview,
}: {
  /**
   * Dev-only sample data for `/library/preview`, which 404s outside
   * `next dev`. Bypasses auth, the network and status writes.
   */
  preview?: { entries: WatchlistEntry[]; hours?: Record<number, TimeToBeatLike> };
} = {}) {
  const { user } = useAuth();
  const live = useWatchlist();
  const entries = preview?.entries ?? live.entries;
  const loading = preview ? false : live.loading;
  const signedIn = preview ? true : Boolean(user);
  const setStatus = preview ? async () => {} : live.setStatus;
  const { toast } = useToast();
  // OS setting or the in-app switch: either way, no card trick.
  const reduced = useCalmMotion();

  const [mood, setMood] = useState<MoodId>("any");
  const [length, setLength] = useState<LengthId>("any");
  const [platform, setPlatform] = useState<string | null>(null);

  const backlog = useMemo(() => entries.filter(isBacklog), [entries]);
  const ttb = useTimeToBeat(backlog, { enabled: !loading, preview: preview?.hours });
  const hours = useMemo(() => {
    const map = new Map<number, number>();
    for (const [id, value] of Object.entries(ttb.data ?? {})) {
      const h = hoursFrom(value);
      if (h !== null) map.set(Number(id), h);
    }
    return map;
  }, [ttb.data]);

  const knownLengths = backlog.filter((entry) => hours.has(entry.gameId)).length;
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
          const value = hours.get(entry.gameId);
          const band = LENGTHS.find((item) => item.id === length);
          if (value === undefined || !band?.test(value)) return false;
        }
        return true;
      }),
    [backlog, mood, platform, length, showLength, hours],
  );

  /* ---------------------------------------------------------------- deck -- */

  const [deal, setDeal] = useState<Deal | null>(null);
  const [phase, setPhase] = useState<Phase>("stack");
  const [pick, setPick] = useState<WatchlistEntry | null>(null);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState<number | null>(null);
  const timers = useRef<number[]>([]);
  const dealing = deal !== null && pick === null;

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending.splice(0)) window.clearTimeout(id);
    };
  }, []);

  // Changing the options invalidates a previous answer. Adjusted during
  // render (not in an effect) so a stale pick never paints against new options.
  const optionsKey = `${mood}|${length}|${platform ?? ""}`;
  const [lastOptions, setLastOptions] = useState(optionsKey);
  if (optionsKey !== lastOptions) {
    setLastOptions(optionsKey);
    if (!dealing) {
      setPick(null);
      setDeal(null);
      setPhase("stack");
    }
  }

  const shuffle = useCallback(() => {
    if (pool.length === 0 || dealing) return;
    // Never the same game twice in a row when there's a choice.
    const choices = pool.length > 1 && pick ? pool.filter((entry) => entry.gameId !== pick.gameId) : pool;
    const winner = choices[Math.floor(Math.random() * choices.length)];
    setPick(null);
    setStarted(null);
    // Emptied in place: the unmount cleanup holds this same array.
    for (const id of timers.current.splice(0)) window.clearTimeout(id);

    if (reduced) {
      setDeal({ id: Date.now(), cards: [winner], winner: 0 });
      setPhase("reveal");
      setPick(winner);
      haptic("success");
      return;
    }

    // The deck: the winner hidden among real backlog games, so the cards
    // dealt away are genuine alternatives rather than blanks.
    const others = shuffled(pool.filter((entry) => entry.gameId !== winner.gameId)).slice(0, DECK_MAX - 1);
    const cards = shuffled([...others, winner]);
    const n = cards.length;
    setDeal({ id: Date.now(), cards, winner: cards.indexOf(winner) });
    setPhase("stack");
    haptic("light");

    const t = timeline(n);
    const at = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms));
    const ticks = (from: number, gap: number, count: number) => {
      for (let i = 0; i < count; i++) at(from + i * gap, () => haptic("selection"));
    };
    at(t.split1, () => setPhase("split"));
    at(t.riffle1, () => setPhase("riffle"));
    ticks(t.riffle1 + 110, RIFFLE_STAGGER * 1000, n);
    at(t.split2, () => setPhase("split"));
    at(t.riffle2, () => setPhase("riffle"));
    ticks(t.riffle2 + 110, RIFFLE_STAGGER * 1000, n);
    at(t.fan, () => setPhase("fan"));
    ticks(t.fan + 120, 40, n);
    at(t.deal, () => setPhase("deal"));
    ticks(t.deal + 60, DEAL_STAGGER * 1000, n - 1);
    at(t.reveal, () => {
      setPhase("reveal");
      haptic("medium");
    });
    at(t.done, () => {
      setPick(winner);
      haptic("success");
    });
  }, [pool, dealing, pick, reduced]);

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
          <p className="mt-0.5 text-[13px] leading-snug text-muted">Nothing released is waiting to be started.</p>
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
  // Before the first deal the table shows a face-down deck the size of the pool.
  const table: Deal = deal ?? { id: 0, cards: pool.slice(0, DECK_MAX), winner: -1 };
  const isStarted = pick !== null && started === pick.gameId;

  return (
    <section aria-labelledby="roulette-title" className="glass relative mb-8 overflow-hidden rounded-3xl p-4 sm:p-6">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-brand/15 blur-3xl" />

      <div className="relative">
        <h2 id="roulette-title" className="font-display text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">
          Backlog roulette
        </h2>
        <p className="mt-0.5 text-[13px] text-muted sm:text-[15px]">
          <span className="font-semibold tabular-nums text-text">{pool.length}</span> {pool.length === 1 ? "game" : "games"} in the deck
        </p>
      </div>

      <div className="relative mt-5 grid gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-10">
        <Table deal={table} phase={deal ? phase : "stack"} reduced={Boolean(reduced)} empty={pool.length === 0} />

        {/*
          Phones read deck → answer → button → options, so the card trick and
          the button that starts it share one screen; wider layouts put the
          options first, beside the deck.
        */}
        <div className="flex min-w-0 flex-col">
          <div className="order-3 mt-7 space-y-3.5 md:order-none md:mt-0">
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
                hint={length !== "any" && knownLengths < backlog.length ? `Only the ${knownLengths} games with a known length can match` : undefined}
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
          <div className="order-1 text-center md:order-none md:mt-6 md:min-h-[92px] md:text-left" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {pick ? (
                <motion.div
                  key={pick.gameId}
                  initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0.2 : 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="flex items-start justify-center gap-2 md:justify-start">
                    <Link prefetch={false}
                      href={`/game/${pick.slug}`}
                      className="min-w-0 font-display text-2xl font-bold leading-tight tracking-[-0.02em] fine:hover:text-brand-soft"
                    >
                      {pick.name}
                    </Link>
                    <ScorePill score={pick.metacritic} className="mt-1.5 shrink-0" />
                  </div>
                  <PickFacts entry={pick} hours={hours.get(pick.gameId) ?? null} />
                </motion.div>
              ) : pool.length === 0 ? (
                <motion.p key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-muted">
                  Nothing in your backlog matches.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMood("any");
                      setLength("any");
                      setPlatform(null);
                    }}
                    className="min-h-11 font-medium text-brand-soft underline underline-offset-2"
                  >
                    Reset options
                  </button>
                </motion.p>
              ) : dealing ? (
                // The button already says so on screen; this is for screen readers.
                <p key="dealing" className="sr-only">
                  Shuffling…
                </p>
              ) : null}
            </AnimatePresence>
          </div>

          <div className="order-2 mt-4 flex flex-wrap justify-center gap-2.5 md:order-none md:justify-start">
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
                  onClick={shuffle}
                  disabled={pool.length < 2}
                  className="press inline-flex min-h-11 items-center gap-2 rounded-full border border-fg/10 bg-fg/[0.07] px-5 text-[15px] font-semibold text-text transition-colors fine:hover:bg-fg/[0.11] disabled:opacity-40"
                >
                  <RotateCcw size={16} />
                  Deal again
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={shuffle}
                disabled={pool.length === 0 || dealing}
                className="press inline-flex min-h-12 items-center gap-2 rounded-full bg-brand px-6 text-[16px] font-semibold text-white shadow-[inset_0_1px_0_#ffffff40,0_10px_30px_-10px_rgba(138,114,255,0.75)] disabled:opacity-50"
              >
                <Dices size={18} />
                {dealing ? "Shuffling…" : "Shuffle and deal"}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The card table. Cards are keyed per deal so every shuffle starts from a
 * freshly gathered deck; the phase drives every card through shared variants.
 */
function Table({ deal, phase, reduced, empty }: { deal: Deal; phase: Phase; reduced: boolean; empty: boolean }) {
  const n = deal.cards.length;
  const losers = Math.max(0, n - 1);
  // Exit order of the losing cards: their position among the non-winners.
  const outOrder = deal.cards.map((_, i) => (i < deal.winner || deal.winner < 0 ? i : i - 1));
  return (
    <div aria-hidden className="relative mx-auto grid h-[228px] w-full max-w-[288px] place-items-center md:mx-0 md:w-[288px]">
      {/* The felt: a soft pool of light the deck sits in. */}
      <div className="absolute inset-x-6 bottom-2 h-10 rounded-[50%] bg-fg/[0.07] blur-xl" />
      {n === 0 || empty ? (
        <div className="grid h-[176px] w-[132px] place-items-center rounded-2xl border-2 border-dashed border-fg/15 text-faint">
          <Dices size={22} />
        </div>
      ) : (
        deal.cards.map((entry, i) => {
          const winner = i === deal.winner;
          const slot: CardSlot = { i, n, winner, out: winner ? 0 : outOrder[i], side: i % 2 ? 1 : -1, losers };
          return (
            <motion.div
              key={`${deal.id}-${i}`}
              custom={slot}
              variants={CARD}
              initial={reduced ? false : "enter"}
              animate={phase}
              className="absolute left-1/2 top-1/2"
              style={{ width: CARD_W, height: CARD_H, marginLeft: -CARD_W / 2, marginTop: -CARD_H / 2, perspective: 900 }}
            >
              <motion.div
                custom={slot}
                variants={FLIP}
                initial={reduced && winner ? { rotateY: 180 } : false}
                className="relative h-full w-full rounded-2xl shadow-[0_12px_26px_-12px_#000000d9] [transform-style:preserve-3d] light:shadow-[0_12px_26px_-14px_#00000066]"
              >
                <CardBack />
                <div className="absolute inset-0 overflow-hidden rounded-2xl bg-panel [backface-visibility:hidden] [transform:rotateY(180deg)]">
                  {/* Only the winner's face is ever seen, so only it loads art. */}
                  {winner && (
                    <GameCover
                      name={entry.name}
                      slug={entry.slug}
                      image={entry.image}
                      imageFallback={entry.imageFallback}
                      width={CARD_W * 2}
                      sizes={`${CARD_W}px`}
                    />
                  )}
                </div>
              </motion.div>
            </motion.div>
          );
        })
      )}
    </div>
  );
}

/** The same back on every card, always dark: a deck doesn't change with the theme. */
function CardBack() {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-2xl bg-[#2a1f6b] [backface-visibility:hidden]">
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_30%_10%,#8a72ff_0%,transparent_60%),repeating-linear-gradient(45deg,#ffffff12_0_2px,transparent_2px_9px)]" />
      <div className="absolute inset-[7px] grid place-items-center rounded-[11px] ring-1 ring-inset ring-white/25">
        <Dices size={26} className="text-white/70" />
      </div>
    </div>
  );
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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
    hours !== null ? `About ${Math.round(hours)}h to beat` : null,
    (entry.genres ?? []).slice(0, 2).map((genre) => genre.name).join(" · ") || null,
  ].filter(Boolean);
  return <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{facts.join("  ·  ")}</p>;
}
