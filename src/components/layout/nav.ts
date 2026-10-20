/**
 * The site's primary destinations, shared by the phone tab bar and the
 * desktop header so the two can never drift into different information
 * architectures.
 *
 * Four destinations plus Search — the App Store / Apple TV shape. The phone
 * bar used to carry Home · Upcoming · Browse · Stats, which left Genres,
 * Platforms, Studios, Franchises, Compare, the watchlist and the library
 * reachable on a phone only from the footer at the bottom of a long page.
 * Now every catalogue entry point is one tap into Discover, and every
 * personal page one tap into Library or the account sheet behind the avatar.
 * Stats lives under Library: it is a view *of* your library, not somewhere
 * you go to browse.
 *
 * `match` lists the route families a destination owns, so a genre page or a
 * franchise still lights up Discover, and the watchlist lights up Library.
 */

export type NavIcon = "home" | "upcoming" | "discover" | "library";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  match: readonly string[];
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { href: "/", label: "Home", icon: "home", match: [] },
  { href: "/upcoming", label: "Upcoming", icon: "upcoming", match: ["/upcoming", "/today"] },
  {
    href: "/discover",
    label: "Discover",
    icon: "discover",
    match: [
      "/discover", "/browse", "/genres", "/platforms", "/studios", "/studio/", "/franchises",
      "/franchise/", "/series/", "/character/", "/person/", "/compare", "/steam",
    ],
  },
  { href: "/library", label: "Library", icon: "library", match: ["/library", "/watchlist", "/stats", "/profile"] },
];

export function isNavActive(item: NavItem, pathname: string | null): boolean {
  const path = pathname ?? "/";
  return item.href === "/" ? path === "/" : item.match.some((prefix) => path.startsWith(prefix));
}
