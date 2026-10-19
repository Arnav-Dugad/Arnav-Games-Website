import Link from "next/link";
import { ArrowUp, Sparkles } from "lucide-react";
import { Logo } from "./Logo";
import { AccountLinks } from "./AccountLinks";
import { Container } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";

const COLUMNS = [
  {
    title: "Discover",
    links: [
      { label: "Everything to explore", href: "/discover" },
      { label: "Upcoming releases", href: "/upcoming" },
      { label: "Browse all", href: "/browse" },
      { label: "Top rated", href: "/browse?ordering=-metacritic" },
      { label: "Search", href: "/search" },
    ],
  },
  {
    title: "Categories",
    links: [
      { label: "Genres", href: "/genres" },
      { label: "Platforms", href: "/platforms" },
      { label: "Studios", href: "/studios" },
      { label: "Franchises", href: "/franchises" },
      { label: "Compare games", href: "/compare" },
    ],
  },
];

export function Footer() {
  return (
    <footer data-track-src="footer" className="relative mt-8 overflow-hidden border-t border-line">
      {/* Oversized wordmark bleeding off the bottom edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-4 select-none whitespace-nowrap text-center font-display text-[14vw] font-black uppercase leading-none tracking-tighter text-fg/[0.025] lg:-bottom-8"
      >
        Arnav Games
      </div>

      <Container className="relative py-14 lg:py-20">
        <Reveal className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)] md:gap-8">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              A release calendar and reference database for video games — every
              upcoming title, score and platform in one place.
            </p>
            <p className="mt-5 inline-flex items-center gap-1.5 text-xs text-faint">
              <Sparkles size={12} />
              Game data from{" "}
              <a
                href="https://www.igdb.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 transition-colors hover:text-muted"
              >
                IGDB
              </a>{" "}
              and{" "}
              <a
                href="https://store.steampowered.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 transition-colors hover:text-muted"
              >
                Steam
              </a>
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
                {column.title}
              </h3>
              {/* Text-sized links on desktop; full 44px rows on touch. */}
              <ul className="mt-4 space-y-2.5 coarse:mt-2 coarse:space-y-0">
                {column.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="group inline-flex items-center text-sm text-muted transition-colors hover:text-text coarse:min-h-11"
                    >
                      <span className="relative">
                        {link.label}
                        <span
                          aria-hidden
                          className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-brand-soft transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-x-100"
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          {/* Auth-aware, so signed-in visitors aren't invited to sign up. */}
          <nav aria-label="Account">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
              Account
            </h3>
            <AccountLinks />
          </nav>
        </Reveal>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-line pt-6 text-xs text-faint sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Arnav Games. Not affiliated with any publisher or platform holder.</p>
          <a href="#main" className="inline-flex items-center gap-1.5 transition-colors hover:text-muted coarse:min-h-11">
            <ArrowUp size={13} />
            Back to top
          </a>
        </div>
      </Container>
    </footer>
  );
}
