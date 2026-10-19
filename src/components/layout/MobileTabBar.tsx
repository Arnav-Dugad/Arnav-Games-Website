"use client";

/**
 * Touch-only bottom navigation, in the iOS 26 shape.
 *
 * A floating Liquid-Glass pill carries the tabs, with a lens that slides to the
 * active one; search sits apart in its own round button, the way Apple's own
 * apps now separate it. Scrolling down tucks the labels away so the bar takes
 * less of the screen, and scrolling up brings them back.
 *
 * This is the counterpart to the desktop header's inline nav — not a
 * responsive restyling of it. It shows for touch at any width, and for mouse
 * users only below `lg`, where the header has no room for its own nav.
 *
 * The bar's frosted material lives on an underlay rather than on the list
 * itself. A `backdrop-filter` makes its element a "backdrop root", and a lens
 * nested inside one can only refract the bar's own tint — never the page
 * behind it. With the blur on a sibling layer, the lens (`.liquid-lens`, see
 * LiquidGlassFilter) bends the real backdrop where the browser supports it.
 */

import { motion, type Transition } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { useScrollDirection } from "@/hooks";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/upcoming", label: "Upcoming", icon: "upcoming" },
  { href: "/browse", label: "Browse", icon: "browse" },
  { href: "/stats", label: "Stats", icon: "stats" },
] as const;

const SPRING = { type: "spring", stiffness: 520, damping: 38, mass: 0.8 } as const;

export function MobileTabBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const pathname = usePathname();
  const { direction } = useScrollDirection();
  const compact = direction === "down";
  const calm = useCalmMotion();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[150] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:fine:hidden"
    >
      <div className="mx-auto flex max-w-md items-end gap-2.5">
        <div
          className={cn(
            "pointer-events-auto relative z-0 flex-1 rounded-full",
            "transition-[height] duration-500 ease-[var(--ease-apple)]",
            compact ? "h-[52px]" : "h-[62px]",
          )}
        >
          <span aria-hidden className="material material-underlay -z-10" />
          <ul className="flex h-full items-stretch p-1.5">
            {TABS.map((tab) => {
              const active = isActive(tab.href);
              return (
                <li key={tab.href} className="relative flex-1">
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      if (!active) haptic("selection");
                    }}
                    className="group/tab relative flex h-full w-full flex-col items-center justify-center gap-[3px] rounded-full"
                  >
                    {active && (
                      // The "lens": a brighter glass bead that slides between
                      // tabs, refracting the page behind it where supported.
                      <motion.span
                        layoutId="tab-lens"
                        aria-hidden
                        className="liquid-lens absolute inset-0 rounded-full bg-fg/[0.13] shadow-[inset_0_1px_0_#ffffff30,inset_0_-1px_0_#ffffff0d]"
                        transition={SPRING}
                      />
                    )}
                    {/* The press feedback rides on the content, not the link:
                        scaling the link would also squash the lens mid-slide. */}
                    <span className="relative flex flex-col items-center gap-[3px] transition-transform duration-300 ease-[var(--ease-apple)] group-active/tab:scale-[0.88] group-active/tab:duration-100">
                      {/* A springy pop on selection; the glyph itself morphs
                          (see TabIcon). Keyed scale, not layout: 60fps. */}
                      <motion.span
                        className={cn(
                          "grid place-items-center transition-colors duration-200",
                          active ? "text-brand-soft" : "text-muted",
                        )}
                        initial={false}
                        animate={active && !calm ? { scale: [0.78, 1.1, 1] } : { scale: 1 }}
                        transition={{ duration: 0.42, times: [0, 0.55, 1], ease: [0.34, 1.56, 0.64, 1] }}
                      >
                        <TabIcon name={tab.icon} active={active} size={compact ? 22 : 23} />
                      </motion.span>
                      <span
                        className={cn(
                          "overflow-hidden text-[10px] font-semibold leading-none tracking-[-0.01em] transition-[max-height,opacity] duration-300",
                          active ? "text-text" : "text-muted",
                          compact ? "max-h-0 opacity-0" : "max-h-3 opacity-100",
                        )}
                      >
                        {tab.label}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <button
          type="button"
          onClick={() => {
            haptic("light");
            onOpenSearch();
          }}
          aria-label="Search the complete database"
          className={cn(
            "material press pointer-events-auto grid shrink-0 place-items-center rounded-full text-text",
            "transition-[height,width] duration-500 ease-[var(--ease-apple)]",
            compact ? "h-[52px] w-[52px]" : "h-[62px] w-[62px]",
          )}
        >
          <Search size={21} strokeWidth={2.1} />
        </button>
      </div>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Tab-bar glyphs that morph between their resting (outline) and selected
 * (filled) states, instead of swapping one static icon for another.
 *
 * Each icon keeps its outline at all times and animates a filled layer in on
 * top of it, plus one small gesture that says what the tab is:
 *  - Home: the house fills from the ground up.
 *  - Upcoming: the calendar's header band drops in and the days pop on.
 *  - Browse: the compass needle swings round and settles on north.
 *  - Stats: the bars grow from the baseline, one after another.
 * Springs, not tweens, so a fast tab change still lands with a little give.
 * Only transform and opacity animate (compositor-only, 60fps). `initial`
 * is off, so nothing animates on first paint — only on a real change — and
 * under reduced motion every transition is instant.
 */

type TabIconName = "home" | "upcoming" | "browse" | "stats";

const ICON_SPRING: Transition = { type: "spring", stiffness: 520, damping: 26, mass: 0.7 };

interface IconProps {
  active: boolean;
  size: number;
}

function TabIcon({ name, active, size }: IconProps & { name: TabIconName }) {
  const calm = useCalmMotion();
  const t = (delay = 0): Transition => (calm ? { duration: 0 } : { ...ICON_SPRING, delay });
  const fade = (delay = 0): Transition => (calm ? { duration: 0 } : { duration: 0.18, delay });
  const state = active ? "on" : "off";

  const svgProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: active ? 2.1 : 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    // Lets the SVG children scale around their own boxes.
    style: { overflow: "visible" },
  };

  switch (name) {
    case "home": {
      const house =
        "M4 10.4 12 4l8 6.4V19a1.6 1.6 0 0 1-1.6 1.6H15v-4.9a1.2 1.2 0 0 0-1.2-1.2h-3.6A1.2 1.2 0 0 0 9 15.7v4.9H5.6A1.6 1.6 0 0 1 4 19z";
      return (
        <svg {...svgProps}>
          <motion.path
            d={house}
            fill="currentColor"
            stroke="none"
            style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
            initial={false}
            animate={state}
            variants={{ on: { opacity: 1, scaleY: 1 }, off: { opacity: 0, scaleY: 0.35 } }}
            transition={{ scaleY: t(), opacity: fade() }}
          />
          <path d={house} />
        </svg>
      );
    }

    case "upcoming":
      return (
        <svg {...svgProps}>
          <motion.path
            d="M4 9a3.5 3.5 0 0 1 3.5-3.5h9A3.5 3.5 0 0 1 20 9v1H4z"
            fill="currentColor"
            stroke="none"
            style={{ transformBox: "fill-box", transformOrigin: "50% 0%" }}
            initial={false}
            animate={state}
            variants={{ on: { opacity: 1, scaleY: 1 }, off: { opacity: 0, scaleY: 0 } }}
            transition={{ scaleY: t(), opacity: fade() }}
          />
          <rect x="4" y="5.5" width="16" height="15" rx="3.5" />
          <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" />
          {[8.5, 12, 15.5].map((cx, i) => (
            <motion.circle
              key={cx}
              cx={cx}
              cy="15"
              r="1.25"
              fill="currentColor"
              stroke="none"
              style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
              initial={false}
              animate={state}
              variants={{ on: { opacity: 1, scale: 1 }, off: { opacity: 0, scale: 0 } }}
              transition={{ scale: t(active ? 0.04 + i * 0.05 : 0), opacity: fade(active ? 0.04 + i * 0.05 : 0) }}
            />
          ))}
        </svg>
      );

    case "browse":
      return (
        <svg {...svgProps}>
          <motion.circle
            cx="12"
            cy="12"
            r="8.5"
            fill="currentColor"
            stroke="none"
            initial={false}
            animate={state}
            variants={{ on: { opacity: 0.2 }, off: { opacity: 0 } }}
            transition={fade()}
          />
          <circle cx="12" cy="12" r="8.5" />
          <motion.g
            style={{ transformBox: "view-box", transformOrigin: "12px 12px" }}
            initial={false}
            animate={state}
            variants={{ on: { rotate: 0 }, off: { rotate: -90 } }}
            transition={calm ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 14, mass: 0.8 }}
          >
            <motion.path
              d="m14.9 9.1-1.6 4.2-4.2 1.6 1.6-4.2z"
              fill="currentColor"
              initial={false}
              animate={state}
              variants={{ on: { fillOpacity: 1 }, off: { fillOpacity: 0 } }}
              transition={fade()}
            />
          </motion.g>
        </svg>
      );

    case "stats": {
      const bars = [
        { x: 4.5, y: 12.5, h: 7.5 },
        { x: 10.2, y: 8, h: 12 },
        { x: 15.9, y: 4, h: 16 },
      ];
      return (
        <svg {...svgProps}>
          {bars.map((bar, i) => (
            <g key={bar.x}>
              <motion.rect
                x={bar.x}
                y={bar.y}
                width="3.6"
                height={bar.h}
                rx="1.3"
                fill="currentColor"
                stroke="none"
                style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
                initial={false}
                animate={state}
                variants={{ on: { opacity: 1, scaleY: 1 }, off: { opacity: 0, scaleY: 0.2 } }}
                transition={{ scaleY: t(active ? i * 0.06 : 0), opacity: fade(active ? i * 0.06 : 0) }}
              />
              <rect x={bar.x} y={bar.y} width="3.6" height={bar.h} rx="1.3" />
            </g>
          ))}
        </svg>
      );
    }
  }
}
