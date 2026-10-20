"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, isNavActive } from "./nav";
import { cn } from "@/lib/utils/cn";

/**
 * Wordmark, with a mark that knows where you are.
 *
 * The "A" tile never changes shape — it is the brand — but each part of the
 * site retunes its gradient (a registered-property cross-fade, see
 * `.logo-tile` in globals.css) and pins a small glyph badge to its corner:
 * a calendar on Upcoming, a compass in Discover, a bookmark in your Library,
 * bars on Stats, a play mark on a game page, whose tile also takes that
 * game's cover accent. Home is the bare mark. The badge springs in and the
 * glyphs cross-fade, all absolutely positioned, so nothing around the logo
 * moves. The sheen still sweeps up on hover and "Games" keeps its gradient.
 *
 * Same markup on the server and the client: the section comes from the
 * pathname, which the server already knows.
 */

type Section = "home" | "upcoming" | "discover" | "library" | "stats" | "search" | "game";

function sectionOf(pathname: string | null): Section {
  const path = pathname ?? "/";
  if (path.startsWith("/game/")) return "game";
  if (path.startsWith("/stats")) return "stats";
  if (path.startsWith("/search")) return "search";
  const nav = PRIMARY_NAV.find((item) => item.href !== "/" && isNavActive(item, path));
  if (nav?.icon === "upcoming" || nav?.icon === "discover" || nav?.icon === "library") return nav.icon;
  return "home";
}

const GLYPHS: Exclude<Section, "home">[] = ["upcoming", "discover", "library", "stats", "search", "game"];

/** 16-unit glyphs, drawn to read at 9px: few strokes, round ends. */
function Glyph({ section }: { section: Exclude<Section, "home"> }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (section) {
    case "upcoming":
      return (
        <>
          <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2.25" {...stroke} />
          <path d="M2.5 7.25h11M5.25 1.75v2.5M10.75 1.75v2.5" {...stroke} />
        </>
      );
    case "discover":
      return (
        <>
          <circle cx="8" cy="8" r="6" {...stroke} />
          <path d="M10.6 5.4 9.1 9.1 5.4 10.6 6.9 6.9z" fill="currentColor" />
        </>
      );
    case "library":
      return <path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" {...stroke} />;
    case "stats":
      return <path d="M3.5 13V9.5M8 13V3.5M12.5 13V7" {...stroke} />;
    case "search":
      return <path d="M7 11.2A4.2 4.2 0 1 0 7 2.8a4.2 4.2 0 0 0 0 8.4zM10.2 10.2l3.3 3.3" {...stroke} />;
    case "game":
      return <path d="M5.5 3.4v9.2l7.2-4.6z" fill="currentColor" />;
  }
}

function LogoMark() {
  const section = sectionOf(usePathname());
  return (
    <span className="relative shrink-0">
      <span
        data-section={section}
        className="logo-tile relative grid h-8 w-8 place-items-center overflow-hidden rounded-[10px] shadow-[0_6px_20px_-6px_color-mix(in_oklab,var(--logo-a)_75%,transparent)] group-hover:-rotate-6 group-hover:scale-105"
      >
        <svg viewBox="0 0 64 64" aria-hidden className="h-[22px] w-[22px]">
          <path d="M27.6 15h8.8L49 49h-8.3l-2.6-7.4H25.9L23.3 49H15zm-.1 19.9h9L32 21.6z" fill="#fff" />
        </svg>
        <span
          aria-hidden
          className="absolute inset-0 translate-y-full bg-white/25 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-y-0"
        />
      </span>
      {/* Where you are, as a badge: decorative — the page title says it in words. */}
      <span
        aria-hidden
        data-on={section !== "home"}
        className="logo-badge absolute -bottom-1 -right-1 grid h-[15px] w-[15px] place-items-center rounded-full bg-text text-bg shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
      >
        {GLYPHS.map((key) => (
          <svg key={key} viewBox="0 0 16 16" data-on={key === section} className="logo-glyph absolute h-[9px] w-[9px]">
            <Glyph section={key} />
          </svg>
        ))}
      </span>
    </span>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Arnav Games — home"
      className={cn("group inline-flex items-center gap-2.5", className)}
    >
      <LogoMark />

      {!compact && (
        <span className="whitespace-nowrap font-display text-[17px] font-extrabold tracking-[0.005em] text-text max-[359px]:sr-only">
          Arnav{" "}
          <span className="bg-[linear-gradient(90deg,var(--color-brand-soft),var(--color-neon))] bg-clip-text text-transparent">
            Games
          </span>
        </span>
      )}
    </Link>
  );
}
