"use client";

/**
 * Footer account column.
 *
 * Signed-in visitors have no use for "Sign in" and "Create account", so the
 * links swap to the pages they'd actually want. Rendered client-side because
 * the footer itself is static and shouldn't become dynamic for this alone.
 */

import Link from "next/link";
import { useAuth } from "@/lib/firebase/AuthProvider";

const SIGNED_OUT = [
  { label: "Sign in", href: "/login" },
  { label: "Create account", href: "/signup" },
  { label: "Your watchlist", href: "/watchlist" },
  { label: "Personal stats", href: "/stats" },
  { label: "Notifications", href: "/notifications" },
  { label: "Settings", href: "/settings" },
];

const SIGNED_IN = [
  { label: "Your watchlist", href: "/watchlist" },
  { label: "Personal stats", href: "/stats" },
  { label: "Games you own", href: "/library" },
  { label: "Play history", href: "/profile#history" },
  { label: "Your reviews", href: "/profile" },
  { label: "Settings", href: "/settings" },
];

export function AccountLinks() {
  const { user } = useAuth();
  const links = user ? SIGNED_IN : SIGNED_OUT;

  return (
    <ul className="mt-4 space-y-2.5 coarse:mt-2 coarse:space-y-0">
      {links.map((link) => (
        <li key={link.href + link.label}>
          <Link href={link.href} className="group inline-flex items-center text-sm text-muted transition-colors hover:text-text coarse:min-h-11">
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
  );
}
