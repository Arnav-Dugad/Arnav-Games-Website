"use client";

/**
 * The compare table: up to three games in columns, one fact per row, the
 * best value in each comparable row marked.
 *
 * Modelled on Apple's "compare models" pages: each row is a labelled band
 * (the label spans the columns, values sit under it), which survives phones
 * far better than a label column eating a third of the width. On a phone two
 * columns fit and a third scrolls in sideways (snap); a compact header with
 * the games' names sticks to the top and follows that sideways scroll, so a
 * value deep in the table is never orphaned from its game.
 *
 * "Best" is only claimed where more/less is unambiguously better (scores,
 * price, players, hype, Steam Deck status) and only when at least two games
 * have a value — a lone number isn't the best of anything. Length isn't
 * judged: a 100-hour game isn't better or worse than a 10-hour one.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Columns3, Link2, MapPin, Plus, Share2, Star, X } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { PlatformIcons } from "@/components/game/PlatformIcons";
import { GamePickerSheet } from "@/components/compare/GamePickerSheet";
import { liveUrl } from "@/components/game/detail/live";
import { marketUrl, pcUrl, useEndpoints, type EndpointState } from "@/components/game/detail/endpoint";
import { bestPrice, DiscountTag, STORE_LABEL, VerdictChip } from "@/components/game/detail/market-ui";
import { countryName, formatMoney } from "@/components/game/detail/money";
import { PRICE_REGION_SETTINGS } from "@/components/game/detail/PriceSection";
import { DECK } from "@/components/game/detail/StatsSection";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { Skeleton } from "@/components/ui/Skeleton";
import { Container } from "@/components/ui/SectionHeading";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/haptics";
import { usePriceRegion } from "@/lib/preferences/region";
import { cn } from "@/lib/utils/cn";
import { compactNumber, formatDate, relativeRelease, scoreColor } from "@/lib/utils/format";
import type { DeckStatus, GameLiveData, GameMarket, GamePcInfo } from "@/lib/games/types";
import { compareHref, MAX_COMPARE, type CompareGame } from "./types";

type Cell = { node: ReactNode; value?: number | null; loading?: boolean };
interface Row {
  key: string;
  label: string;
  cells: Cell[];
  /** "max"/"min" picks the best numeric `value`; omitted = not judged. */
  best?: "max" | "min";
}

const DECK_RANK: Record<DeckStatus, number> = { verified: 3, playable: 2, unsupported: 0, unknown: -1 };
const full = new Intl.NumberFormat("en-US");

export function CompareView({ games, missing, openPicker }: { games: CompareGame[]; missing: string[]; openPicker: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const calm = useCalmMotion();
  const [pickerOpen, setPickerOpen] = useState(openPicker);
  const [region] = usePriceRegion();
  const slugs = games.map((game) => game.slug);
  const canAdd = games.length < MAX_COMPARE;

  const ids = games.map((game) => ({ id: game.id, steam: game.steamAppId, microsoft: game.microsoftId }));
  const markets = useEndpoints<GameMarket>(
    games.map((game, index) => (region && (game.steamAppId || game.microsoftId) ? marketUrl(ids[index], region) : null)),
  );
  const lives = useEndpoints<GameLiveData>(
    games.map((game) => (game.steamAppId ? liveUrl({ id: game.id, steam: game.steamAppId, name: game.name }) : null)),
  );
  const pcs = useEndpoints<GamePcInfo>(games.map((game, index) => (game.steamAppId ? pcUrl(ids[index]) : null)));

  const remove = (slug: string) => {
    haptic("light");
    router.replace(compareHref(slugs.filter((entry) => entry !== slug)), { scroll: false });
  };
  const add = (slug: string) => {
    setPickerOpen(false);
    router.replace(compareHref([...slugs, slug]), { scroll: false });
  };
  const share = async () => {
    const url = new URL(compareHref(slugs), window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: games.map((game) => game.name).join(" vs "), url });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast("Comparison link copied", "success");
      } else {
        toast("Copy this page's address to share it", "info");
        return;
      }
      haptic("success");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast("Couldn't share this comparison", "error");
    }
  };

  const rows = buildRows(games, { markets, lives, pcs, regionKnown: Boolean(region) });
  const columns = games.length + (canAdd ? 1 : 0);

  return (
    <div className="pb-16">
      <Container className="pt-24 lg:pt-32">
        <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-brand-soft sm:text-[15px]">
          <Columns3 size={15} aria-hidden /> Compare
        </p>
        <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
          {games.length > 1 ? games.map((game) => game.name).join(" vs ") : "Compare games"}
        </h1>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-[15px] leading-snug text-muted sm:text-[17px]">
            Scores, local prices, length and who&rsquo;s playing — side by side. The best value in each row is marked.
          </p>
          {games.length > 0 && (
            <div className="flex shrink-0 items-center gap-2">
              {region && (
                <Link
                  href={PRICE_REGION_SETTINGS}
                  className="press inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-fg/[0.04] px-3.5 text-[13px] font-medium text-muted fine:hover:text-text"
                >
                  <MapPin size={13} /> Prices for {countryName(region)}
                </Link>
              )}
              <button
                type="button"
                onClick={share}
                className="press inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-fg/[0.04] px-3.5 text-[13px] font-semibold text-text fine:hover:bg-fg/[0.08]"
              >
                <Share2 size={14} /> Share
              </button>
            </div>
          )}
        </div>
        {missing.length > 0 && (
          <p className="mt-3 text-[13px] text-muted" role="status">
            Couldn&rsquo;t find {missing.map((slug) => `“${slug}”`).join(", ")}, so {missing.length === 1 ? "it was" : "they were"} left out.
          </p>
        )}
      </Container>

      {games.length === 0 ? (
        <Container className="mt-10">
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-line px-6 py-16 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-fg/[0.06] text-faint">
              <Columns3 size={22} />
            </span>
            <p className="mt-4 text-[17px] font-semibold">Pick the games to compare</p>
            <p className="mt-1 max-w-sm text-[15px] text-muted">Choose up to three. You can also long-press any game and pick &ldquo;Compare with…&rdquo;.</p>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="press mt-6 inline-flex min-h-12 items-center gap-2 rounded-full bg-brand px-6 text-[15px] font-semibold text-white"
            >
              <Plus size={17} /> Choose a game
            </button>
          </div>
        </Container>
      ) : (
        <CompareTable games={games} rows={rows} columns={columns} canAdd={canAdd} onAdd={() => setPickerOpen(true)} onRemove={remove} calm={calm} />
      )}

      <GamePickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        exclude={slugs}
        onPick={(game) => add(game.slug)}
        title={games.length ? "Add a game" : "Compare games"}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function CompareTable({
  games,
  rows,
  columns,
  canAdd,
  onAdd,
  onRemove,
  calm,
}: {
  games: CompareGame[];
  rows: Row[];
  columns: number;
  canAdd: boolean;
  onAdd: () => void;
  onRemove: (slug: string) => void;
  calm: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyTrackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [showSticky, setShowSticky] = useState(false);

  // The sticky name bar mirrors the table's sideways scroll (set directly on
  // the element: a re-render per scroll frame would be wasted work).
  const syncScroll = () => {
    const track = stickyTrackRef.current;
    const scroller = scrollRef.current;
    if (track && scroller) track.style.transform = `translateX(${-scroller.scrollLeft}px)`;
  };

  useEffect(() => {
    const head = headRef.current;
    if (!head) return;
    const observer = new IntersectionObserver(([entry]) => setShowSticky(!entry.isIntersecting && entry.boundingClientRect.top < 0), {
      rootMargin: "-72px 0px 0px 0px",
    });
    observer.observe(head);
    return () => observer.disconnect();
  }, []);

  useEffect(syncScroll, [showSticky]);

  // Two fixed columns fill a phone (a third scrolls in); from `sm` the
  // columns share the width equally. Fixed tracks on phones matter: with
  // `1fr` in a max-content scroller a long genre list would widen its column.
  const gridStyle = {
    gridTemplateColumns: `repeat(${columns}, var(--compare-track))`,
  } as React.CSSProperties;
  const colVar = "[--compare-track:calc((100vw_-_44px)/2)] sm:[--compare-track:minmax(0,1fr)]";

  return (
    <div className="relative mt-8 sm:mt-10">
      <AnimatePresence>
        {showSticky && (
          <motion.div
            initial={calm ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="material fixed inset-x-0 top-16 z-[90] border-b border-line lg:top-[72px]"
            aria-hidden
          >
            <div className="mx-auto max-w-[1400px] overflow-hidden px-4 lg:px-6 xl:px-10">
              <div ref={stickyTrackRef} className={cn("grid gap-3 py-2 sm:max-w-[1040px] sm:gap-4", colVar)} style={gridStyle}>
                {games.map((game) => (
                  <div key={game.slug} className="flex min-w-0 items-center gap-2">
                    <span className="relative h-9 w-[27px] shrink-0 overflow-hidden rounded-md bg-fg/[0.06]">
                      <GameCover name={game.name} slug={game.slug} image={game.image} width={80} sizes="27px" rounded="rounded-md" />
                    </span>
                    <span className="truncate text-[13px] font-semibold text-text">{game.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={scrollRef}
        onScroll={syncScroll}
        className="snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-px-4 [scrollbar-width:none] lg:scroll-px-6 xl:scroll-px-10 [&::-webkit-scrollbar]:hidden"
      >
        <div className="mx-auto w-max min-w-full max-w-[1400px] px-4 sm:w-full lg:px-6 xl:px-10">
          {/* Columns stop growing at ~320px on wide screens: three narrow,
              aligned columns compare better than three half-empty ones. */}
          <div className="sm:max-w-[1040px]">
            <div ref={headRef} role="list" aria-label="Games being compared" className={cn("grid gap-3 sm:gap-4", colVar)} style={gridStyle}>
              {games.map((game) => (
                <div key={game.slug} role="listitem" className="min-w-0 snap-start">
                  <ColumnHead game={game} onRemove={() => onRemove(game.slug)} />
                </div>
              ))}
              {canAdd && (
                <div role="listitem" className="min-w-0 snap-start">
                  <button
                    type="button"
                    onClick={() => {
                      haptic("selection");
                      onAdd();
                    }}
                    className="press flex aspect-[3/4] w-full max-w-[200px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-muted transition-colors fine:hover:border-brand/50 fine:hover:text-text"
                  >
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-fg/[0.07]">
                      <Plus size={20} />
                    </span>
                    <span className="text-[14px] font-semibold">Add a game</span>
                  </button>
                </div>
              )}
            </div>

            <div className="mt-6 divide-y divide-line border-t border-line">
              {rows.map((row) => (
                <CompareRow key={row.key} row={row} names={games.map((game) => game.name)} columns={columns} gridStyle={gridStyle} colVar={colVar} />
              ))}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColumnHead({ game, onRemove }: { game: CompareGame; onRemove: () => void }) {
  return (
    <div className="max-w-[200px]">
      <div className="relative">
        {/* The name below is the labelled link; the cover duplicates it for pointer users only. */}
        <Link href={`/game/${game.slug}`} tabIndex={-1} aria-hidden className="group block">
          <span className="relative block aspect-[3/4] overflow-hidden rounded-2xl bg-fg/[0.06] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.7)]">
            <GameCover
              name={game.name}
              slug={game.slug}
              image={game.image}
              imageFallback={game.imageFallback}
              width={400}
              // The column covers are the page's LCP, always above the fold.
              priority
              sizes="(max-width: 640px) 45vw, 200px"
              className="transition-transform duration-500 fine:group-hover:scale-[1.03]"
            />
          </span>
        </Link>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${game.name} from the comparison`}
          className="press absolute right-1.5 top-1.5 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-md coarse:h-10 coarse:w-10"
        >
          <X size={15} />
        </button>
      </div>
      <Link href={`/game/${game.slug}`} className="mt-3 block">
        <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-text sm:text-[17px]">{game.name}</span>
      </Link>
      {game.developer && <p className="mt-0.5 truncate text-[13px] text-muted">{game.developer}</p>}
    </div>
  );
}

function CompareRow({
  row,
  names,
  columns,
  gridStyle,
  colVar,
}: {
  row: Row;
  /** Each value is prefixed with its game's name for screen readers, which can't see the columns. */
  names: string[];
  columns: number;
  gridStyle: React.CSSProperties;
  colVar: string;
}) {
  const numbers = row.cells.map((cell) => (typeof cell.value === "number" ? cell.value : null));
  const present = numbers.filter((value): value is number => value !== null);
  const anyLoading = row.cells.some((cell) => cell.loading);
  let bestValue: number | null = null;
  if (row.best && present.length >= 2 && !anyLoading) {
    bestValue = row.best === "max" ? Math.max(...present) : Math.min(...present);
    // A tie across every game isn't a winner.
    if (present.every((value) => value === bestValue)) bestValue = null;
  }

  return (
    <div className="py-4">
      <h2 className={row.label ? "sticky left-4 w-fit text-[12px] font-semibold text-muted lg:left-0" : "sr-only"}>{row.label || "Game pages"}</h2>
      <div className={cn("grid gap-3 sm:gap-4", row.label && "mt-2", colVar)} style={gridStyle}>
        {row.cells.map((cell, index) => {
          const best = bestValue !== null && numbers[index] === bestValue;
          return (
            <div
              key={index}
              className={cn(
                "relative min-w-0 rounded-xl text-[15px] text-text",
                best && "-mx-2 -my-1.5 bg-mint/[0.05] px-2 py-1.5 ring-1 ring-inset ring-mint/35",
              )}
            >
              <span className="sr-only">{names[index]}: </span>
              {cell.loading ? <Skeleton className="h-5 w-20 rounded-full" /> : cell.node}
              {best && (
                <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-text">
                  <Check size={12} className="text-mint" aria-hidden /> Best
                </span>
              )}
            </div>
          );
        })}
        {Array.from({ length: columns - row.cells.length }, (_, index) => (
          <div key={`pad-${index}`} aria-hidden />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

const none = (label = "Not available"): Cell => ({
  node: (
    <span className="text-faint">
      <span aria-hidden>—</span>
      <span className="sr-only">{label}</span>
    </span>
  ),
  value: null,
});

function buildRows(
  games: CompareGame[],
  data: {
    markets: EndpointState<GameMarket>[];
    lives: EndpointState<GameLiveData>[];
    pcs: EndpointState<GamePcInfo>[];
    regionKnown: boolean;
  },
): Row[] {
  const rows: Row[] = [];

  rows.push({
    key: "release",
    label: "Release",
    cells: games.map((game) =>
      game.released
        ? {
            node: (
              <>
                <span className="block">{formatDate(game.released)}</span>
                <span className="block text-[13px] text-muted">{relativeRelease(game.released)}</span>
              </>
            ),
          }
        : { node: <span>{game.releaseWindow ?? "To be announced"}</span> },
    ),
  });

  rows.push({
    key: "critic",
    label: "Critic score",
    best: "max",
    // Plain text plus a coloured dot rather than the tinted score pill, which
    // loses contrast on the light theme once the "best" wash sits behind it.
    cells: games.map((game) =>
      game.metacritic !== null
        ? {
            node: (
              <span className="flex items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: scoreColor(game.metacritic) }} />
                <span className="text-[17px] font-semibold tabular-nums">{game.metacritic}</span>
                <span className="text-muted">/ 100</span>
              </span>
            ),
            value: game.metacritic,
          }
        : none("No critic score"),
    ),
  });

  rows.push({
    key: "rating",
    label: "Player rating",
    best: "max",
    cells: games.map((game) =>
      game.rating > 0
        ? {
            node: (
              <span className="flex flex-wrap items-center gap-x-1.5">
                <Star size={14} className="fill-gold text-gold" aria-hidden />
                <span className="font-semibold tabular-nums">{game.rating.toFixed(1)}</span>
                <span className="text-muted">/ 5</span>
                {game.ratingsCount > 0 && <span className="w-full text-[13px] text-muted">{compactNumber(game.ratingsCount)} ratings</span>}
              </span>
            ),
            value: game.rating,
          }
        : none("No player rating"),
    ),
  });

  const prices = games.map((game, index): Cell => {
    if (!game.steamAppId && !game.microsoftId) return none("Not on Steam or the Microsoft Store");
    const state = data.markets[index];
    if (!data.regionKnown || state.status === "loading") return { node: null, loading: true };
    if (state.status !== "ready") return none("Price unavailable");
    const best = bestPrice(state.data);
    if (!best) return { node: <span className="text-[13px] text-muted">Not sold here</span>, value: null };
    return {
      node: (
        <>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[17px] font-semibold">{best.price === 0 ? "Free" : formatMoney(best.price, best.currency, best.country)}</span>
            <DiscountTag percent={best.discount} />
          </span>
          <span className="block text-[13px] text-muted">{STORE_LABEL[best.store]}</span>
        </>
      ),
      value: best.price,
    };
  });
  if (prices.some((cell) => cell.value !== null || cell.loading)) {
    rows.push({ key: "price", label: "Price", best: "min", cells: prices });

    rows.push({
      key: "verdict",
      label: "Buy or wait",
      cells: games.map((_, index) => {
        const state = data.markets[index];
        if (!prices[index].loading && prices[index].value == null) return none();
        if (state.status === "loading" || prices[index].loading) return { node: null, loading: true };
        if (state.status !== "ready") return none();
        return { node: <VerdictChip kind={state.data.verdict.kind} short /> };
      }),
    });
  }

  if (games.some((game) => game.timeToBeat?.hastily || game.timeToBeat?.completely)) {
    rows.push({
      key: "ttb",
      label: "Time to beat (story · everything)",
      cells: games.map((game) => {
        const story = game.timeToBeat?.hastily;
        const all = game.timeToBeat?.completely;
        if (!story && !all) return none("No time-to-beat data");
        const hours = (h: number | null | undefined) => (h ? `${Math.round(h)} h` : "—");
        return {
          node: (
            <span className="tabular-nums">
              {hours(story)} <span className="text-muted">·</span> {hours(all)}
            </span>
          ),
        };
      }),
    });
  }

  if (games.some((game) => game.steamAppId)) {
    rows.push({
      key: "players",
      label: "Playing now on Steam",
      best: "max",
      cells: games.map((game, index) => {
        if (!game.steamAppId) return none("Not on Steam");
        const state = data.lives[index];
        if (state.status === "loading") return { node: null, loading: true };
        const players = state.status === "ready" ? state.data.steamPlayers : null;
        if (players === null) return none("No player count");
        return { node: <span className="font-semibold tabular-nums">{full.format(players)}</span>, value: players };
      }),
    });

    rows.push({
      key: "deck",
      label: "Steam Deck",
      best: "max",
      cells: games.map((game, index) => {
        if (!game.steamAppId) return none("Not on Steam");
        const state = data.pcs[index];
        if (state.status === "loading") return { node: null, loading: true };
        const deck = state.status === "ready" ? state.data.deck : null;
        if (!deck) return none("No Steam Deck rating");
        const meta = DECK[deck];
        return {
          node: (
            <span className="flex items-center gap-1.5">
              <span className={meta.className} aria-hidden>
                {meta.icon}
              </span>
              {meta.label}
            </span>
          ),
          value: deck === "unknown" ? null : DECK_RANK[deck],
        };
      }),
    });
  }

  if (games.some((game) => game.hype !== null)) {
    rows.push({
      key: "hype",
      label: "Hype index",
      best: "max",
      cells: games.map((game) =>
        game.hype !== null
          ? { node: <span className="font-semibold tabular-nums">{game.hype}<span className="font-normal text-muted"> / 100</span></span>, value: game.hype }
          : none("No hype index"),
      ),
    });
  }

  rows.push({
    key: "platforms",
    label: "Platforms",
    cells: games.map((game) =>
      game.platforms.length
        ? {
            node: (
              <>
                <PlatformIcons platforms={game.platforms} size={16} max={8} tinted />
                <span className="mt-1 block text-[13px] leading-snug text-muted">{game.platforms.map((platform) => platform.name).join(", ")}</span>
              </>
            ),
          }
        : none(),
    ),
  });

  rows.push({
    key: "genres",
    label: "Genres",
    cells: games.map((game) => (game.genres.length ? { node: <span className="leading-snug">{game.genres.map((genre) => genre.name).join(", ")}</span> } : none())),
  });

  if (games.some((game) => game.modes.length)) {
    rows.push({
      key: "modes",
      label: "Modes",
      cells: games.map((game) => (game.modes.length ? { node: <span className="leading-snug">{game.modes.map((mode) => mode.name).join(", ")}</span> } : none())),
    });
  }

  rows.push({
    key: "links",
    label: "",
    cells: games.map((game) => ({
      node: (
        <Link
          href={`/game/${game.slug}`}
          className="press inline-flex min-h-10 items-center gap-1.5 rounded-full bg-fg/[0.07] px-4 text-[13px] font-semibold text-text fine:hover:bg-fg/[0.12]"
        >
          <Link2 size={13} aria-hidden /> View game
        </Link>
      ),
    })),
  });

  return rows;
}
