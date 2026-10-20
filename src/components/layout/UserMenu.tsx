"use client";

/**
 * The account control at the right of the header.
 *
 * Two presentations of one menu, like the App Store's account button:
 *  - mouse: a compact dropdown under the avatar;
 *  - touch: a bottom sheet of iOS-style grouped rows — 48px targets, room for
 *    every personal page, and it scrolls when a landscape phone or 200% text
 *    leaves it taller than the screen.
 *
 * On touch it opens signed out too. A phone has no hover and no footer in
 * reach, so this sheet is how a signed-out reader gets to their (local)
 * watchlist, stats, notifications and settings in two taps — the old
 * "Sign in" pill was a dead end for everything except signing in.
 *
 * Open state is pinned to the route it was opened on, so any navigation —
 * a row, the Back button, a swipe — closes it without an effect.
 */

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  Bookmark,
  ChevronRight,
  Library,
  LogOut,
  Settings,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useClickOutside, useEscapeKey, useMediaQuery } from "@/hooks";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";

/** Deterministic accent per user, so an avatar without a photo still has identity. */
function avatarHue(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash << 5) - hash + seed.charCodeAt(i);
  return Math.abs(hash) % 360;
}

interface Entry {
  href: string;
  label: string;
  icon: ReactNode;
  /** Tile colour for the touch sheet's iOS-Settings-style glyphs. */
  tint: string;
}

const LIBRARY: Entry[] = [
  { href: "/library", label: "Games you own", icon: <Library size={16} />, tint: "bg-brand text-white" },
  { href: "/watchlist", label: "Watchlist", icon: <Bookmark size={16} />, tint: "bg-flare text-white" },
  { href: "/stats", label: "Personal stats", icon: <BarChart3 size={16} />, tint: "bg-mint text-white" },
];

const ACCOUNT: Entry[] = [
  { href: "/notifications", label: "Notifications", icon: <Bell size={16} />, tint: "bg-gold text-white" },
  { href: "/profile", label: "Profile", icon: <UserIcon size={16} />, tint: "bg-neon text-white" },
  { href: "/settings", label: "Settings", icon: <Settings size={16} />, tint: "bg-panel-2 text-text" },
];


export function UserMenu() {
  const { user, loading, enabled, signOut } = useAuth();
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === pathname;
  const touch = useMediaQuery("(hover: none) and (pointer: coarse)");
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  const close = useCallback(() => setOpenOn(null), []);
  const toggle = () => setOpenOn((current) => (current === pathname ? null : pathname));

  // The sheet brings its own Escape, outside-tap and focus handling.
  useClickOutside(ref, close, open && !touch);
  useEscapeKey(close, open && !touch);

  if (loading) {
    return <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-fg/8 coarse:h-11 coarse:w-11" aria-hidden />;
  }

  const next = encodeURIComponent(pathname || "/");
  const name = user ? user.displayName || user.email?.split("@")[0] || "Player" : null;
  const hue = user ? avatarHue(user.uid) : 0;
  const entries = [...LIBRARY, ...ACCOUNT];

  const handleSignOut = async () => {
    close();
    await signOut();
    toast("Signed out", "info");
    router.push("/");
  };

  const trigger = (
    <button
      type="button"
      onClick={toggle}
      aria-haspopup={touch ? "dialog" : "menu"}
      aria-expanded={open}
      aria-label="Account menu"
      className={cn(
        "press grid h-10 w-10 place-items-center overflow-hidden rounded-full border transition-all duration-300 coarse:h-11 coarse:w-11",
        open ? "border-brand/60 ring-2 ring-brand/25" : "border-line-strong fine:hover:border-brand/50",
        !user && "bg-fg/[0.07] text-muted",
        // Signed out with a mouse, the visible "Sign in" pill does this job.
        !user && "fine:hidden",
      )}
      style={{
        background: user && !user.photoURL
          ? `linear-gradient(140deg, hsl(${hue} 70% 45%), hsl(${(hue + 50) % 360} 70% 32%))`
          : undefined,
      }}
    >
      {user?.photoURL ? (
        // Firebase avatar hosts vary (Google, GitHub, …); a plain <img> avoids
        // having to allowlist every provider domain in next.config.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.photoURL} alt="" className="h-full w-full object-cover" />
      ) : user && name ? (
        <span className="text-[13px] font-bold text-white">{name.slice(0, 1).toUpperCase()}</span>
      ) : (
        <UserIcon size={18} aria-hidden />
      )}
    </button>
  );

  return (
    <div ref={ref} className="relative flex shrink-0 items-center gap-2">
      {!user && (
        <Link
          href={`/login?next=${next}`}
          className="press inline-flex min-h-10 items-center rounded-full bg-brand px-4 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_#ffffff40] coarse:hidden fine:hover:brightness-110"
        >
          Sign in
        </Link>
      )}
      {trigger}

      {touch ? (
        <Sheet
          open={open}
          onClose={close}
          title={name ?? "Your account"}
          description={user?.email ?? (enabled ? "Sign in to keep your library and watchlist on every device." : "Your library and watchlist are saved on this device.")}
        >
          {!user && enabled && (
            <div className="grid grid-cols-2 gap-2.5">
              <Button href={`/login?next=${next}`} onClick={close} fullWidth>
                Sign in
              </Button>
              <Button href={`/signup?next=${next}`} variant="secondary" onClick={close} fullWidth>
                Create account
              </Button>
            </div>
          )}
          <SheetGroup className={cn(!user && enabled && "mt-5")} entries={LIBRARY} onNavigate={close} />
          <SheetGroup className="mt-4" entries={ACCOUNT} onNavigate={close} />
          {user && (
            <div className="mt-4 overflow-hidden rounded-2xl bg-fg/[0.06]">
              <button
                type="button"
                onClick={handleSignOut}
                className="flex min-h-12 w-full items-center justify-center text-[17px] text-flare active:bg-fg/[0.08]"
              >
                Sign out
              </button>
            </div>
          )}
        </Sheet>
      ) : (
        <AnimatePresence>
          {open && (
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              // Capped to the space under the header, so a short window can
              // still scroll to "Sign out".
              className="material material-menu absolute right-0 top-[calc(100%+14px)] z-50 max-h-[calc(100dvh-var(--chrome-top)-1rem)] w-64 origin-top-right overflow-y-auto overscroll-contain rounded-[22px] p-1.5"
            >
              {user ? (
                <div className="border-b border-line px-3 py-2.5">
                  <p className="truncate text-sm font-semibold">{name}</p>
                  {user.email && <p className="truncate text-xs text-faint">{user.email}</p>}
                </div>
              ) : enabled ? (
                <MenuLink href={`/login?next=${next}`} icon={<UserIcon size={15} />} onClick={close}>
                  Sign in
                </MenuLink>
              ) : null}
              {entries.map((entry) => (
                <MenuLink key={entry.href} href={entry.href} icon={entry.icon} onClick={close}>
                  {entry.label}
                </MenuLink>
              ))}
              {user && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-flare transition-colors hover:bg-flare/10"
                >
                  <LogOut size={15} />
                  Sign out
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

/** An inset grouped list, as in iOS Settings. */
function SheetGroup({ entries, onNavigate, className }: { entries: Entry[]; onNavigate: () => void; className?: string }) {
  return (
    <ul className={cn("overflow-hidden rounded-2xl bg-fg/[0.06]", className)}>
      {entries.map((entry) => (
        <li key={entry.href} className="border-b border-line last:border-b-0">
          <Link
            href={entry.href}
            onClick={onNavigate}
            className="flex min-h-12 items-center gap-3 px-3.5 py-2 text-[17px] text-text transition-colors active:bg-fg/[0.08]"
          >
            <span className={cn("grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px]", entry.tint)}>
              {entry.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            <ChevronRight size={18} aria-hidden className="shrink-0 text-faint" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:bg-fg/6 hover:text-text"
    >
      <span className="text-faint">{icon}</span>
      {children}
    </Link>
  );
}
