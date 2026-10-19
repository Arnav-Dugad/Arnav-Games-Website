"use client";

/**
 * Release timeline — every game an entity is credited with, plotted by release
 * date against critic score.
 *
 * Form: a dated scatter. Each dot is one game, sized by how many people rated
 * it; a Gaussian-smoothed rolling average traces the critic arc; console
 * generations sit behind as era bands; unscored games drop to a labelled lane
 * under the plot instead of being faked onto the score axis; anything not out
 * yet is a hollow dot past the "Today" rule.
 *
 * Mobile: a fifty-year studio squeezed into 390px is a smear of overlapping
 * dots, so narrow screens keep a minimum pixels-per-year and scroll
 * horizontally instead. The y-axis and lane label stay pinned outside the
 * scroller, a mini overview underneath shows where you are in the whole
 * career and can be dragged, and the view opens on the present day — the end
 * people came to see.
 *
 * Interaction: hover (mouse) or tap (touch) finds the *nearest* game rather
 * than demanding a hit on a 7px dot; arrow keys walk the timeline in date
 * order for keyboard users. Every value is also in an sr-only table, so the
 * tooltip enhances rather than gates.
 *
 * The plot renders only after the scroller is measured — its geometry depends
 * on the real width and on the viewer's own clock, neither of which the
 * server knows. A fixed-height frame holds the space until then.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useInView, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { ArrowUpRight } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { ScorePill } from "@/components/ui/ScoreRing";
import { cn } from "@/lib/utils/cn";
import { relativeRelease, scoreColor } from "@/lib/utils/format";
import { CONSOLE_ERAS, scoreTrend, type TimelineGame } from "@/lib/games/timeline";

/* ------------------------------------------------------------------------- */
/* Geometry                                                                  */
/* ------------------------------------------------------------------------- */

/** Below this scroller width the chart switches to its compact, scrolling layout. */
const COMPACT_BELOW = 640;

const LAYOUT = {
  compact: { top: 30, plot: 210, gap: 12, lane: 42, axis: 26, axisCol: 30, minPxPerYear: 38, rMin: 3.5, rMax: 8 },
  wide: { top: 32, plot: 280, gap: 14, lane: 46, axis: 28, axisCol: 36, minPxPerYear: 24, rMin: 3.5, rMax: 9.5 },
} as const;

/** Inner horizontal padding so the first and last dots are never clipped. */
const PAD_X = 14;

const heightOf = (layout: (typeof LAYOUT)[keyof typeof LAYOUT]) =>
  layout.top + layout.plot + layout.gap + layout.lane + layout.axis;

interface Placed {
  index: number;
  game: TimelineGame;
  cx: number;
  cy: number;
  r: number;
}

/* ------------------------------------------------------------------------- */
/* Reduced motion — the OS setting *and* the in-app opt-out                  */
/* ------------------------------------------------------------------------- */

function subscribeReduceAttr(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
  return () => observer.disconnect();
}

/**
 * `useReducedMotion` only reads the OS. Settings can also opt this site out
 * via `data-reduce-motion` on <html>; CSS honours that globally, but a JS
 * driven path draw would ignore it, so it is read here too.
 */
function useMotionOff(): boolean {
  const os = useReducedMotion();
  const app = useSyncExternalStore(
    subscribeReduceAttr,
    () => document.documentElement.dataset.reduceMotion === "true",
    () => false,
  );
  return Boolean(os) || app;
}

/* ------------------------------------------------------------------------- */
/* Component                                                                 */
/* ------------------------------------------------------------------------- */

export function ReleaseTimeline({
  games,
  subject,
  undatedCount = 0,
  className,
}: {
  /** Chronological, from `toTimelineGames`. */
  games: TimelineGame[];
  /** Games with no date at all — not plottable, but the footnote says how many. */
  undatedCount?: number;
  /** "FromSoftware", "The Legend of Zelda" — used in accessible labels. */
  subject: string;
  className?: string;
}) {
  const router = useRouter();
  const motionOff = useMotionOff();

  const cardRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const inView = useInView(cardRef, { once: true, amount: 0.25 });

  const [viewW, setViewW] = useState<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  /** How the reader is driving the chart; decides hover-vs-tap behaviour and the tooltip's controls. */
  const [input, setInput] = useState<"mouse" | "touch" | "keyboard">("mouse");

  // UTC midnight on the viewer's clock. Lazy state so it is read once, on the
  // client, and stays stable for the life of the chart.
  const [today] = useState(() => {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  });

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(([entry]) => setViewW(Math.round(entry.contentRect.width)));
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  /*
   * The server classified each game against *its* clock, and a page can be
   * cached for a day. An exact date is re-judged against the viewer's today so
   * a game that came out this morning isn't drawn hollow past the Today rule.
   */
  const points = useMemo(
    () =>
      games.map((game) => {
        if (game.approximate) return game;
        const upcoming = game.t > today;
        return upcoming === game.upcoming ? game : { ...game, upcoming, score: upcoming ? null : game.score };
      }),
    [games, today],
  );

  const compact = viewW !== null && viewW < COMPACT_BELOW;
  const L = compact ? LAYOUT.compact : LAYOUT.wide;
  const height = heightOf(L);

  const geometry = useMemo(() => {
    if (viewW === null || points.length === 0) return null;

    // X domain: whole calendar years, always reaching today so the present is on the map.
    let firstYear = new Date(points[0].t).getUTCFullYear();
    let lastYear = new Date(Math.max(points.at(-1)!.t, today)).getUTCFullYear();
    while (lastYear + 1 - firstYear < 4) {
      // A two-game franchise still needs some air either side to read as a timeline.
      firstYear -= 1;
      if (lastYear + 1 - firstYear < 4) lastYear += 1;
    }
    const xMin = Date.UTC(firstYear, 0, 1);
    const xMax = Date.UTC(lastYear + 1, 0, 1);
    const years = lastYear + 1 - firstYear;

    const contentW = Math.max(viewW, Math.round(years * L.minPxPerYear + PAD_X * 2));
    const pxPerYear = (contentW - PAD_X * 2) / years;
    const x = (t: number) => PAD_X + ((t - xMin) / (xMax - xMin)) * (contentW - PAD_X * 2);

    // Y domain: scores cluster high, so the floor follows the data (to the
    // decade below the lowest score) instead of wasting half the plot on 0–50.
    const scores = points.flatMap((p) => (p.score === null ? [] : [p.score]));
    const lowest = scores.length ? Math.min(...scores) : 60;
    const yLo = Math.max(0, Math.min(60, Math.floor((lowest - 4) / 10) * 10));
    const yHi = 100;
    const y = (score: number) => L.top + (1 - (score - yLo) / (yHi - yLo)) * L.plot;
    const yStep = yHi - yLo > 50 ? 20 : 10;
    const yTicks: number[] = [];
    for (let v = yHi; v >= yLo; v -= yStep) yTicks.push(v);

    const laneTop = L.top + L.plot + L.gap;
    const laneMid = laneTop + L.lane / 2;
    const axisY = laneTop + L.lane;

    const step = [1, 2, 5, 10, 20].find((s) => s * pxPerYear >= (compact ? 46 : 60)) ?? 20;
    const xTicks: number[] = [];
    for (let year = Math.ceil(firstYear / step) * step; year <= lastYear + 1; year += step) {
      xTicks.push(year);
    }

    const maxWeight = Math.max(1, ...points.map((p) => p.weight));
    const placed: Placed[] = points.map((game, index) => {
      const r = L.rMin + (L.rMax - L.rMin) * Math.sqrt(game.weight / maxWeight);
      // Deterministic per-game jitter inside the lane, so a run of unscored
      // games in one year spreads into a readable cluster rather than one blob.
      const jitter = (((game.id * 2_654_435_761) >>> 0) % 1000) / 1000 - 0.5;
      const cy = game.score === null ? laneMid + jitter * (L.lane - 2 * L.rMax) : y(game.score);
      return { index, game, cx: x(game.t), cy, r };
    });

    const trend = scoreTrend(points, xMin, xMax).map((segment) =>
      segment
        .map((pt, i) => `${i === 0 ? "M" : "L"}${x(pt.t).toFixed(1)},${y(pt.score).toFixed(1)}`)
        .join(""),
    );

    const eras = CONSOLE_ERAS.map((era, i) => {
      const start = Date.parse(`${era.start}T00:00:00Z`);
      const next = CONSOLE_ERAS[i + 1];
      const end = next ? Date.parse(`${next.start}T00:00:00Z`) : xMax;
      return { ...era, i, x0: x(Math.max(start, xMin)), x1: x(Math.min(end, xMax)), visible: end > xMin && start < xMax };
    }).filter((era) => era.visible && era.x1 - era.x0 > 1);

    return { xMin, xMax, contentW, x, y, yTicks, laneTop, laneMid, axisY, xTicks, placed, trend, eras, todayX: x(today) };
  }, [viewW, points, today, L, compact]);

  const scrollable = geometry !== null && viewW !== null && geometry.contentW > viewW + 1;

  // Open on the newest game: recent and upcoming releases are what a visitor
  // came for, and the overview shows how much history sits to the left.
  // Anchoring on the last *game* rather than on Today matters for an entity
  // that went quiet years ago — it would otherwise open on an empty decade.
  const openedAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !geometry || viewW === null) return;
    if (openedAt.current === geometry.contentW) return;
    openedAt.current = geometry.contentW;
    const newest = geometry.placed.at(-1)?.cx ?? geometry.todayX;
    scroller.scrollLeft = Math.max(0, newest - viewW * 0.8);
  }, [geometry, viewW]);

  /* --- picking ---------------------------------------------------------- */

  const nearest = useCallback(
    (clientX: number, clientY: number, slack: number): number | null => {
      const svg = svgRef.current;
      if (!svg || !geometry) return null;
      const rect = svg.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      let best: number | null = null;
      let bestDistance = Infinity;
      for (const dot of geometry.placed) {
        const distance = Math.hypot(dot.cx - px, dot.cy - py) - dot.r;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = dot.index;
        }
      }
      return bestDistance <= slack ? best : null;
    },
    [geometry],
  );

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (input !== "mouse") setInput("mouse");
    setActive(nearest(event.clientX, event.clientY, 22));
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const kind = event.pointerType === "touch" ? "touch" : "mouse";
    if (kind !== input) setInput(kind);
  };

  const onClick = (event: MouseEvent<SVGSVGElement>) => {
    const touch = input === "touch";
    const hit = nearest(event.clientX, event.clientY, touch ? 26 : 22);
    if (touch) {
      // Touch has no hover, so the first tap previews and the tooltip's own
      // button opens the game — a stray tap never navigates away.
      setActive(hit);
      return;
    }
    if (hit !== null) router.push(`/game/${points[hit].slug}`);
  };

  const revealIndex = (index: number) => {
    const scroller = scrollerRef.current;
    const dot = geometry?.placed[index];
    if (!scroller || !dot || viewW === null) return;
    if (dot.cx < scroller.scrollLeft + 40 || dot.cx > scroller.scrollLeft + viewW - 40) {
      scroller.scrollTo({ left: dot.cx - viewW / 2, behavior: motionOff ? "auto" : "smooth" });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    let next: number | null = active;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = active === null ? 0 : Math.min(points.length - 1, active + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = active === null ? points.length - 1 : Math.max(0, active - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = points.length - 1;
    else if (event.key === "Escape") next = null;
    else if (event.key === "Enter" && active !== null) {
      event.preventDefault();
      router.push(`/game/${points[active].slug}`);
      return;
    } else return;
    event.preventDefault();
    setInput("keyboard");
    setActive(next);
    if (next !== null) revealIndex(next);
  };

  /* --- overview scrubbing ---------------------------------------------- */

  const scrubTo = (clientX: number, target: HTMLElement) => {
    const scroller = scrollerRef.current;
    if (!scroller || !geometry || viewW === null) return;
    const rect = target.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    scroller.scrollLeft = fraction * geometry.contentW - viewW / 2;
  };

  const activeDot = active !== null && geometry ? geometry.placed[active] : null;
  // A tapped dot scrolled out of view takes its card with it.
  const tooltipVisible =
    activeDot !== null && viewW !== null && activeDot.cx >= scrollLeft - 4 && activeDot.cx <= scrollLeft + viewW + 4;
  const scoredCount = points.filter((p) => p.score !== null).length;
  const upcomingCount = points.filter((p) => p.upcoming).length;
  const animate = inView && !motionOff;

  return (
    <div ref={cardRef} className={cn("glass relative rounded-[1.75rem] p-3 sm:p-5", className)}>
      {/* Hoisted and de-duplicated by React; the global reduced-motion rules still apply to it. */}
      <style href="release-timeline-keyframes" precedence="default">
        {"@keyframes timeline-dot{from{transform:scale(0)}to{transform:scale(1)}}"}
      </style>
      <Legend hasTrend={(geometry?.trend.length ?? 0) > 0} hasUpcoming={upcomingCount > 0} />

      <div
        role="group"
        tabIndex={0}
        aria-label={`${subject} release timeline. Use the arrow keys to step through ${points.length} games in release order, Enter to open one.`}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (input === "keyboard") setActive(null);
        }}
        className="relative mt-3 flex rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/70"
      >
        {/* Pinned y-axis: stays put while the plot scrolls under it. */}
        <div aria-hidden className="relative shrink-0" style={{ width: L.axisCol, height }}>
          {geometry?.yTicks.map((tick) => (
            <span
              key={tick}
              className="absolute right-1.5 -translate-y-1/2 text-[10px] font-medium tabular-nums text-faint"
              style={{ top: geometry.y(tick) }}
            >
              {tick}
            </span>
          ))}
        </div>

        <div
          ref={scrollerRef}
          onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
          // A horizontally scrolling chart must be reachable by keyboard so
          // arrow keys can pan it (WCAG 2.1.1).
          tabIndex={scrollable ? 0 : undefined}
          role={scrollable ? "region" : undefined}
          aria-label={scrollable ? "Release timeline, scrolls sideways" : undefined}
          className={cn(
            "relative min-w-0 flex-1 overscroll-x-contain",
            scrollable ? "no-scrollbar snap-x snap-proximity overflow-x-auto" : "overflow-hidden",
          )}
        >
          {!geometry ? (
            <div style={{ height }} className="grid place-items-center">
              <span className="h-1 w-24 rounded-full shimmer-bg" />
            </div>
          ) : (
            <div className="relative" style={{ width: geometry.contentW, height }}>
              {/* Snap anchors on the year ticks so a flick settles on a clean year. */}
              {scrollable &&
                geometry.xTicks.map((year) => (
                  <span
                    key={`snap-${year}`}
                    aria-hidden
                    className="absolute top-0 h-px w-px snap-start"
                    style={{ left: Math.max(0, geometry.x(Date.UTC(year, 0, 1)) - 12) }}
                  />
                ))}

              <svg
                ref={svgRef}
                width={geometry.contentW}
                height={height}
                aria-hidden
                className={cn("block select-none", activeDot && input === "mouse" && "cursor-pointer")}
                onPointerMove={onPointerMove}
                onPointerDown={onPointerDown}
                onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}
                onClick={onClick}
              >
                {/* Era bands */}
                {geometry.eras.map((era) => (
                  <g key={era.label}>
                    <rect
                      x={era.x0}
                      y={L.top - 6}
                      width={era.x1 - era.x0}
                      height={geometry.axisY - L.top + 6}
                      fill="var(--color-fg)"
                      fillOpacity={era.i % 2 === 0 ? 0.028 : 0.01}
                    >
                      <title>{`${era.label}: ${era.title}`}</title>
                    </rect>
                    {era.x1 - era.x0 > 48 && Math.abs(era.x0 + 6 - geometry.todayX) > 52 && (
                      <text x={era.x0 + 6} y={L.top - 12} className="fill-faint text-[10px] font-medium">
                        {era.label}
                      </text>
                    )}
                  </g>
                ))}

                {/* Score gridlines */}
                {geometry.yTicks.map((tick) => (
                  <line
                    key={tick}
                    x1={0}
                    x2={geometry.contentW}
                    y1={geometry.y(tick)}
                    y2={geometry.y(tick)}
                    stroke="var(--color-fg)"
                    strokeOpacity={tick === 100 ? 0.04 : 0.07}
                  />
                ))}

                {/* Unscored lane */}
                <rect
                  x={0}
                  y={geometry.laneTop}
                  width={geometry.contentW}
                  height={L.lane}
                  rx={10}
                  fill="var(--color-fg)"
                  fillOpacity={0.035}
                />

                {/* Future */}
                <rect
                  x={geometry.todayX}
                  y={L.top - 6}
                  width={Math.max(0, geometry.contentW - geometry.todayX)}
                  height={geometry.axisY - L.top + 6}
                  fill="var(--color-brand)"
                  fillOpacity={0.05}
                />
                <line
                  x1={geometry.todayX}
                  x2={geometry.todayX}
                  y1={L.top - 6}
                  y2={geometry.axisY}
                  stroke="var(--color-neon)"
                  strokeOpacity={0.7}
                  strokeWidth={1}
                />
                <text
                  x={geometry.todayX}
                  y={L.top - 12}
                  textAnchor="middle"
                  className="fill-neon text-[10px] font-semibold uppercase tracking-[0.08em]"
                >
                  Today
                </text>

                {/* Year axis */}
                {geometry.xTicks.map((year) => {
                  const tx = geometry.x(Date.UTC(year, 0, 1));
                  return (
                    <g key={year}>
                      <line x1={tx} x2={tx} y1={geometry.axisY} y2={geometry.axisY + 4} stroke="var(--color-fg)" strokeOpacity={0.2} />
                      <text
                        x={tx}
                        y={geometry.axisY + 17}
                        textAnchor={tx < 16 ? "start" : tx > geometry.contentW - 16 ? "end" : "middle"}
                        className="fill-faint text-[10px] font-medium tabular-nums"
                      >
                        {year}
                      </text>
                    </g>
                  );
                })}

                {/* Rolling average */}
                {geometry.trend.map((d, i) => (
                  <g key={i}>
                    <path d={d} fill="none" stroke="var(--color-brand)" strokeOpacity={0.28} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" style={{ filter: "blur(4px)" }} />
                    <motion.path
                      d={d}
                      fill="none"
                      stroke="var(--color-brand-soft)"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={motionOff ? false : { pathLength: 0, opacity: 0 }}
                      animate={inView || motionOff ? { pathLength: 1, opacity: 1 } : undefined}
                      transition={{ duration: 1.6, delay: 0.35, ease: [0.32, 0.72, 0, 1] }}
                    />
                  </g>
                ))}

                {/* Active guide */}
                {activeDot && (
                  <line
                    x1={activeDot.cx}
                    x2={activeDot.cx}
                    y1={activeDot.cy + activeDot.r + 3}
                    y2={geometry.axisY}
                    stroke="var(--color-fg)"
                    strokeOpacity={0.35}
                  />
                )}

                {/* Dots — biggest first so small titles stay visible on top. */}
                {[...geometry.placed]
                  .sort((a, b) => b.r - a.r)
                  .map((dot) => (
                    <Dot
                      key={dot.game.id}
                      dot={dot}
                      dimmed={active !== null && active !== dot.index}
                      animate={animate}
                      hidden={!inView && !motionOff}
                      delay={0.15 + (dot.cx / geometry.contentW) * 0.9}
                    />
                  ))}

                {activeDot && (
                  <circle
                    cx={activeDot.cx}
                    cy={activeDot.cy}
                    r={activeDot.r + 4.5}
                    fill="none"
                    stroke="var(--color-text)"
                    strokeWidth={1.5}
                  />
                )}
              </svg>

            </div>
          )}
        </div>

        {/* Lane label, pinned over the left edge of the scroller. */}
        {geometry && (
          <span
            aria-hidden
            className="material-thin pointer-events-none absolute rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-muted"
            style={{ left: L.axisCol + 6, top: geometry.laneTop + 5 }}
          >
            Unscored
          </span>
        )}

        {/*
          The tooltip lives outside the scroller: an `overflow-x: auto` box
          also clips vertically, which cut the card off for any dot near the
          top of the plot. Here it may overhang the legend instead.
        */}
        {activeDot && viewW !== null && tooltipVisible && (
          <Tooltip
            dot={activeDot}
            x={L.axisCol + activeDot.cx - scrollLeft}
            boundsWidth={L.axisCol + viewW}
            today={today}
            touch={input === "touch"}
            keyboard={input === "keyboard"}
            below={activeDot.cy < (input === "touch" ? 175 : 135)}
            onClose={() => setActive(null)}
          />
        )}
      </div>

      {scrollable && geometry && viewW !== null && (
        <Overview
          points={geometry.placed}
          contentW={geometry.contentW}
          viewW={viewW}
          scrollLeft={scrollLeft}
          axisCol={L.axisCol}
          laneTop={geometry.laneTop}
          height={height}
          onScrub={scrubTo}
        />
      )}

      <p className="mt-3 px-1 text-[11.5px] leading-relaxed text-faint">
        {points.length} plotted · {scoredCount} scored
        {upcomingCount > 0 && ` · ${upcomingCount} upcoming`}
        {undatedCount > 0 && ` · ${undatedCount} undated, not shown`} · dot size = number of ratings
        {points.some((p) => p.approximate && p.upcoming) && " · dashed ring = release window, placed at its midpoint"}
      </p>

      <p className="sr-only" aria-live="polite">
        {activeDot
          ? `${activeDot.game.name}, ${activeDot.game.label}, ${
              activeDot.game.score !== null
                ? `critic score ${activeDot.game.score}`
                : activeDot.game.upcoming
                  ? "upcoming"
                  : "no critic score"
            }`
          : ""}
      </p>

      <TimelineTable games={games} subject={subject} />
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Pieces                                                                    */
/* ------------------------------------------------------------------------- */

function Dot({
  dot,
  dimmed,
  animate,
  hidden,
  delay,
}: {
  dot: Placed;
  dimmed: boolean;
  animate: boolean;
  hidden: boolean;
  delay: number;
}) {
  const { game } = dot;
  const fill = game.upcoming
    ? "var(--color-bg)"
    : game.score === null
      ? "var(--color-muted)"
      : scoreColor(game.score);
  const opacity = game.upcoming ? 1 : game.score === null ? 0.5 : 0.92;

  return (
    <circle
      cx={dot.cx}
      cy={dot.cy}
      r={dot.r}
      fill={fill}
      fillOpacity={opacity}
      // Upcoming: hollow brand ring (dashed when only a window is known).
      // Everything else: a surface-coloured ring so overlapping dots separate.
      stroke={game.upcoming ? "var(--color-brand-soft)" : "var(--color-bg)"}
      strokeWidth={game.upcoming ? 1.75 : 1.5}
      strokeDasharray={game.upcoming && game.approximate ? "2.5 2" : undefined}
      style={{
        opacity: hidden ? 0 : dimmed ? 0.5 : 1,
        transition: "opacity 0.25s",
        transformBox: "fill-box",
        transformOrigin: "center",
        animation: animate ? `timeline-dot 0.7s var(--ease-out-expo) ${delay.toFixed(2)}s both` : undefined,
      }}
    />
  );
}

function Tooltip({
  dot,
  x,
  boundsWidth,
  today,
  touch,
  keyboard,
  below,
  onClose,
}: {
  dot: Placed;
  /** Dot centre in the frame's coordinates (scroll already applied). */
  x: number;
  boundsWidth: number;
  today: number;
  touch: boolean;
  keyboard: boolean;
  below: boolean;
  onClose: () => void;
}) {
  const { game } = dot;
  // 236px reads comfortably; a 320px phone gets the whole frame instead.
  const width = Math.min(236, boundsWidth - 4);
  const left = Math.min(Math.max(x, width / 2 + 2), boundsWidth - width / 2 - 2);
  const offset = dot.r + 12;
  const iso = new Date(game.t).toISOString().slice(0, 10);

  return (
    <div
      className={cn("absolute z-20", touch ? "pointer-events-auto" : "pointer-events-none")}
      style={{
        left,
        top: dot.cy,
        width,
        transform: below ? `translate(-50%, ${offset}px)` : `translate(-50%, calc(-100% - ${offset}px))`,
      }}
    >
      <div className="material material-menu animate-[fade-up_0.28s_var(--ease-out-expo)_both] rounded-2xl p-2.5">
        <div className="flex gap-3">
          <div className="relative aspect-[3/4] w-12 shrink-0 overflow-hidden rounded-lg bg-panel-2">
            <GameCover
              name={game.name}
              slug={game.slug}
              image={game.image}
              imageFallback={game.imageFallback}
              width={96}
              sizes="48px"
            />
          </div>
          <div className="min-w-0 flex-1 py-0.5">
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-text">{game.name}</p>
            <p className="mt-1 text-[11.5px] text-muted">
              {game.label}
              {game.approximate && <span className="text-faint"> · window</span>}
            </p>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
              {game.score !== null ? (
                <>
                  <ScorePill score={game.score} />
                  <span className="text-faint">critic score</span>
                </>
              ) : game.upcoming ? (
                <span className="font-medium text-brand-soft">
                  Upcoming{!game.approximate && game.t > today && ` · ${relativeRelease(iso)}`}
                </span>
              ) : (
                <span className="text-faint">No critic score yet</span>
              )}
            </div>
          </div>
        </div>
        {touch ? (
          <div className="mt-2.5 flex gap-2">
            <Link
              href={`/game/${game.slug}`}
              className="press inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-fg/[0.1] text-[12.5px] font-semibold text-text"
            >
              View game <ArrowUpRight size={14} />
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="press h-9 rounded-xl px-3 text-[12.5px] font-medium text-muted"
            >
              Close
            </button>
          </div>
        ) : (
          <p className="mt-2 border-t border-line pt-1.5 text-[10.5px] text-faint">
            {keyboard ? "Enter to open · arrows to move" : "Click to open"}
          </p>
        )}
      </div>
    </div>
  );
}

function Legend({ hasTrend, hasUpcoming }: { hasTrend: boolean; hasUpcoming: boolean }) {
  const item = "inline-flex items-center gap-1.5";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[11.5px] text-muted">
      <span className={item}>
        <span aria-hidden className="flex -space-x-0.5">
          {[90, 65, 40].map((s) => (
            <span key={s} className="h-2.5 w-2.5 rounded-full ring-2 ring-bg" style={{ background: scoreColor(s) }} />
          ))}
        </span>
        Critic score <span className="text-faint">75+ · 50–74 · &lt;50</span>
      </span>
      {hasTrend && (
        <span className={item}>
          <span aria-hidden className="h-0.5 w-4 rounded-full bg-brand-soft" />
          Rolling average
        </span>
      )}
      {hasUpcoming && (
        <span className={item}>
          <span aria-hidden className="h-2.5 w-2.5 rounded-full border-[1.5px] border-brand-soft" />
          Upcoming
        </span>
      )}
      <span className={item}>
        <span aria-hidden className="h-3 w-px bg-neon" />
        Today
      </span>
    </div>
  );
}

function Overview({
  points,
  contentW,
  viewW,
  scrollLeft,
  axisCol,
  laneTop,
  height,
  onScrub,
}: {
  points: Placed[];
  contentW: number;
  viewW: number;
  scrollLeft: number;
  axisCol: number;
  laneTop: number;
  height: number;
  onScrub: (clientX: number, target: HTMLElement) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const H = 40;
  // The overview is a straight scale-down of the plot, lane included.
  const sy = (cy: number) => 4 + (Math.min(cy, height) / (laneTop + 30)) * (H - 8);

  return (
    <div className="mt-3 flex items-center gap-2" style={{ paddingLeft: axisCol }}>
      <div
        role="presentation"
        className={cn(
          "relative h-10 flex-1 touch-none overflow-hidden rounded-xl border border-line bg-fg/[0.03]",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          onScrub(event.clientX, event.currentTarget);
        }}
        onPointerMove={(event) => dragging && onScrub(event.clientX, event.currentTarget)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <svg aria-hidden width="100%" height={H} className="absolute inset-0">
          {points.map((dot) => (
            <circle
              key={dot.game.id}
              cx={`${(dot.cx / contentW) * 100}%`}
              cy={Math.min(H - 4, sy(dot.cy))}
              r={1.4}
              fill={dot.game.upcoming ? "var(--color-brand-soft)" : dot.game.score === null ? "var(--color-faint)" : scoreColor(dot.game.score)}
              fillOpacity={0.85}
            />
          ))}
        </svg>
        <div
          aria-hidden
          className="absolute inset-y-0.5 rounded-[10px] border border-fg/35 bg-fg/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]"
          style={{
            left: `${(scrollLeft / contentW) * 100}%`,
            width: `${(viewW / contentW) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}

/** The accessible view of the same data: every plotted game, as a table. */
function TimelineTable({ games, subject }: { games: TimelineGame[]; subject: string }) {
  return (
    <table className="sr-only">
      <caption>{`${subject} releases in date order`}</caption>
      <thead>
        <tr>
          <th scope="col">Game</th>
          <th scope="col">Release</th>
          <th scope="col">Critic score</th>
        </tr>
      </thead>
      <tbody>
        {games.map((game) => (
          <tr key={game.id}>
            <th scope="row">
              <Link href={`/game/${game.slug}`}>{game.name}</Link>
            </th>
            <td>{game.approximate ? `${game.label} (window)` : game.label}</td>
            <td>{game.score ?? (game.upcoming ? "Upcoming" : "Unscored")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
