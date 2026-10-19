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
 */

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarClock, Compass, Home, Search } from "lucide-react";
import { useScrollDirection } from "@/hooks";
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
        <ul
          className={cn(
            "material pointer-events-auto flex flex-1 items-stretch rounded-full p-1.5",
            "transition-[height] duration-500 ease-[var(--ease-apple)]",
            compact ? "h-[52px]" : "h-[62px]",
          )}
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab.href);
            return (
              <li key={tab.href} className="relative flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className="press relative flex h-full w-full flex-col items-center justify-center gap-[3px] rounded-full"
                >
                  {active && (
                    // The "lens": a brighter glass bead that slides between tabs.
                    <motion.span
                      layoutId="tab-lens"
                      aria-hidden
                      className="absolute inset-0 rounded-full bg-white/[0.13] shadow-[inset_0_1px_0_#ffffff30,inset_0_-1px_0_#ffffff0d]"
                      transition={SPRING}
                    />
                  )}
                  <Icon
                    size={compact ? 20 : 21}
                    strokeWidth={active ? 2.3 : 1.9}
                    className={cn(
                      "relative transition-colors duration-200",
                      active ? "text-brand-soft" : "text-muted",
                    )}
                  />
                  <span
                    className={cn(
                      "relative overflow-hidden text-[10px] font-semibold leading-none tracking-[-0.01em] transition-[max-height,opacity] duration-300",
                      active ? "text-text" : "text-muted",
                      compact ? "max-h-0 opacity-0" : "max-h-3 opacity-100",
                    )}
                  >
                    {tab.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={onOpenSearch}
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
