"use client";

/**
 * Desktop-first header.
 *
 * It hides on scroll-down and returns on scroll-up, which reclaims vertical
 * space on phones without taking navigation away. The glass background only
 * engages once the page has scrolled, so the hero sits behind a fully
 * transparent bar.
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
      Pinned at all times.

      This used to slide away on scroll-down to reclaim vertical space. In
      practice that trades a permanently available navigation and search for a
      little height, and it means the one control people reach for mid-page —
      search — is never where they left it. The bar only gains its glass
      background once the page has scrolled, so a hero still sits behind a fully
      transparent header.
    */
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-[150] transition-[background-color,border-color,backdrop-filter] duration-500",
        scrolled
          ? "border-b border-line bg-bg/70 backdrop-blur-xl backdrop-saturate-150"
          : "border-b border-transparent bg-transparent",
      )}
    >
      {/* Soft scrim so the bar stays legible over bright hero frames. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 -z-10 h-28 bg-gradient-to-b from-black/55 via-black/20 to-transparent transition-opacity duration-500",
          scrolled ? "opacity-0" : "opacity-100",
        )}
      />
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-4 px-4 lg:h-[72px] lg:px-6 xl:px-10">
        <Logo />

        <nav aria-label="Primary" className="ml-6 hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative inline-flex items-center rounded-full px-3.5 py-2 text-sm font-medium transition-colors duration-300",
                      active ? "text-text" : "text-muted hover:text-text",
                    )}
                  >
                    {active && (
                      // Shared layoutId slides the pill between items instead of
                      // cross-fading, which makes the nav feel physical.
                      <motion.span
                        layoutId="nav-active-pill"
                        className="absolute inset-0 -z-10 rounded-full bg-white/[0.07] ring-1 ring-inset ring-white/10"
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
              "group flex items-center gap-2.5 rounded-full border border-line bg-black/25 text-muted backdrop-blur-md transition-colors duration-300",
              "h-9 w-9 justify-center fine:hover:border-line-strong fine:hover:text-text",
              "lg:h-9 lg:w-56 lg:justify-start lg:px-3.5",
            )}
          >
            <Search size={16} className="shrink-0" />
            <span className="hidden text-[13px] lg:inline">Search everything…</span>
            <kbd className="ml-auto hidden items-center gap-0.5 rounded border border-line px-1.5 py-0.5 text-[10px] text-faint lg:inline-flex">
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
