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

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarClock, Compass, Home, Search } from "lucide-react";
import { useScrollDirection } from "@/hooks";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/upcoming", label: "Upcoming", icon: CalendarClock },
  { href: "/browse", label: "Browse", icon: Compass },
  { href: "/stats", label: "Stats", icon: BarChart3 },
] as const;

const SPRING = { type: "spring", stiffness: 520, damping: 38, mass: 0.8 } as const;

export function MobileTabBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const pathname = usePathname();
  const { direction } = useScrollDirection();
  const compact = direction === "down";
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
              const Icon = tab.icon;
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
                      <Icon
                        size={compact ? 20 : 21}
                        strokeWidth={active ? 2.3 : 1.9}
                        className={cn(
                          "transition-colors duration-200",
                          active ? "text-brand-soft" : "text-muted",
                        )}
                      />
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
