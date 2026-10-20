import Link from "next/link";
import { Search } from "lucide-react";
import { Container } from "@/components/ui/SectionHeading";

/**
 * 404. Most people land here from a mistyped or outdated game link, so the
 * most useful thing on the page is a search box that already knows where to
 * go — then the three places people usually meant.
 *
 * A plain GET form: works before hydration and on a cold, script-less load.
 */
const PLACES = [
  { href: "/", label: "Home" },
  { href: "/upcoming", label: "Upcoming" },
  { href: "/browse", label: "Browse" },
];

export default function NotFound() {
  return (
    <div className="relative isolate flex min-h-dvh-safe items-center overflow-hidden">
      <Container className="py-28 text-center">
        <p className="font-display text-[clamp(4.5rem,20vw,9rem)] font-black leading-none tracking-[-0.06em] text-gradient">
          404
        </p>
        <h1 className="mt-3 font-display text-[28px] font-bold tracking-[-0.02em] sm:text-[34px]">Page not found</h1>
        <p className="mx-auto mt-2 max-w-sm text-[15px] text-muted sm:text-[17px]">
          The link may be old or mistyped. Try searching for it.
        </p>

        <form action="/search" role="search" className="relative mx-auto mt-8 max-w-md">
          <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            name="q"
            required
            aria-label="Search games"
            placeholder="Search games"
            autoComplete="off"
            className="h-12 w-full rounded-full border border-fg/[0.08] bg-fg/[0.06] pl-11 pr-24 text-base text-text outline-none placeholder:text-faint focus:border-brand/50 [&::-webkit-search-cancel-button]:appearance-none"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-full bg-brand px-4 text-[14px] font-semibold text-white"
          >
            Search
          </button>
        </form>

        <nav aria-label="Popular pages" className="mt-6 flex flex-wrap items-center justify-center gap-1">
          {PLACES.map((place) => (
            <Link
              key={place.href}
              href={place.href}
              className="press inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-medium text-brand-soft transition-colors fine:hover:bg-brand/10"
            >
              {place.label}
            </Link>
          ))}
        </nav>
      </Container>
    </div>
  );
}
