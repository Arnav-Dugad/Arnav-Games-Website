"use client";

/**
 * Floating glass header.
 *
 * Primary navigation is duplicated in `MobileTabBar` for touch — this bar keeps
 * only the logo, search and account controls at small sizes.
 */

import { motion } from "motion/react";
import Link from "next/link";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";
import { NotificationBell } from "./NotificationBell";
import { useScrollDirection } from "@/hooks";
import { cn } from "@/lib/utils/cn";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/upcoming", label: "Upcoming" },
  { href: "/stats", label: "Stats" },
  { href: "/browse", label: "Browse" },
  { href: "/genres", label: "Genres" },
  { href: "/studios", label: "Studios" },
  { href: "/franchises", label: "Franchises" },
];

export function Header({ onOpenSearch }: { onOpenSearch: () => void }) {
  const pathname = usePathname();
  const { scrolled } = useScrollDirection();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    /*
      Pinned at all times, as a floating glass capsule.

      The bar used to slide away on scroll-down; that traded always-available
      navigation and search for a little height. It now floats inset from the
      edges in Apple's frosted material, so it reads cleanly over a bright hero
      and over plain content alike — at the top it is a touch more transparent,
      and firms up once the page scrolls.
    */
    <header className="pointer-events-none fixed inset-x-0 top-0 z-[150] px-2.5 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4 lg:pt-3">
      <div className="pointer-events-auto relative z-0 mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 rounded-[22px] pl-3 pr-2 lg:h-[60px] lg:gap-4 lg:pl-4">
        {/* The frosted material sits on an underlay, not on this bar: a
            backdrop-filter would make the bar a backdrop root, and the active
            pill's liquid-glass lens could then only refract the bar's tint. */}
        <span
          aria-hidden
          className={cn(
            "material material-underlay -z-10 transition-[background-color,box-shadow,border-color] duration-500",
            scrolled && "shadow-[inset_0_1px_0_#ffffff21,0_24px_60px_-20px_#000]",
          )}
        />
        <Logo />

        <nav aria-label="Primary" className="ml-2 hidden lg:block xl:ml-4">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative inline-flex items-center rounded-full px-3 py-2 text-[13.5px] font-medium tracking-[-0.01em] transition-colors duration-300 xl:px-3.5",
                      active ? "text-text" : "text-muted hover:text-text",
                    )}
                  >
                    {active && (
                      // Shared layoutId slides the pill between items instead of
                      // cross-fading, which makes the nav feel physical.
                      <motion.span
                        layoutId="nav-active-pill"
                        className="liquid-lens absolute inset-0 -z-10 rounded-full bg-fg/[0.12] shadow-[inset_0_1px_0_#ffffff26] ring-1 ring-inset ring-fg/10"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search the complete database"
            className={cn(
              "group items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.07] text-muted transition-colors duration-300 press",
              // Below lg the tab bar carries search, so the header doesn't repeat it.
              "hidden h-10 w-10 justify-center lg:flex fine:hover:border-line-strong fine:hover:text-text",
              "xl:h-10 xl:w-56 xl:justify-start xl:px-3.5",
            )}
          >
            <Search size={16} className="shrink-0" />
            <span className="hidden text-[13px] xl:inline">Search everything…</span>
            <kbd className="ml-auto hidden items-center gap-0.5 rounded border border-line px-1.5 py-0.5 text-[10px] text-faint xl:inline-flex">
              ⌘K
            </kbd>
          </button>

          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
