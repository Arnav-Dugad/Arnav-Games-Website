"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BarChart3, Bell, Bookmark, Library, LogOut, Settings, User as UserIcon } from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useClickOutside, useEscapeKey } from "@/hooks";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";

/** Deterministic accent per user, so an avatar without a photo still has identity. */
function avatarHue(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash << 5) - hash + seed.charCodeAt(i);
  return Math.abs(hash) % 360;
}

export function UserMenu() {
  const { user, loading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();

  useClickOutside(ref, () => setOpen(false), open);
  useEscapeKey(() => setOpen(false), open);

  if (loading) {
    return <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-fg/8" aria-hidden />;
  }

  if (!user) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname || "/")}`}
        className="press inline-flex min-h-10 items-center rounded-full bg-brand px-4 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_#ffffff40] fine:hover:brightness-110"
      >
        Sign in
      </Link>
    );
  }

  const name = user.displayName || user.email?.split("@")[0] || "Player";
  const hue = avatarHue(user.uid);

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    toast("Signed out", "info");
    router.push("/");
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className={cn(
          "press grid h-10 w-10 place-items-center overflow-hidden rounded-full border transition-all duration-300",
          open ? "border-brand/60 ring-2 ring-brand/25" : "border-line-strong fine:hover:border-brand/50",
        )}
        style={{
          background: user.photoURL
            ? undefined
            : `linear-gradient(140deg, hsl(${hue} 70% 45%), hsl(${(hue + 50) % 360} 70% 32%))`,
        }}
      >
        {user.photoURL ? (
          // Firebase avatar hosts vary (Google, GitHub, …); a plain <img> avoids
          // having to allowlist every provider domain in next.config.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.photoURL} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[13px] font-bold text-white">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="material material-menu absolute right-0 top-[calc(100%+14px)] z-50 w-64 origin-top-right overflow-hidden rounded-[22px] p-1.5"
          >
            <div className="border-b border-line px-3 py-2.5">
              <p className="truncate text-sm font-semibold">{name}</p>
              {user.email && <p className="truncate text-xs text-faint">{user.email}</p>}
            </div>
            <MenuLink href="/profile" icon={<UserIcon size={15} />} onClick={() => setOpen(false)}>
              Profile
            </MenuLink>
            <MenuLink href="/library" icon={<Library size={15} />} onClick={() => setOpen(false)}>
              Games you own
            </MenuLink>
            <MenuLink href="/watchlist" icon={<Bookmark size={15} />} onClick={() => setOpen(false)}>
              Watchlist
            </MenuLink>
            <MenuLink href="/stats" icon={<BarChart3 size={15} />} onClick={() => setOpen(false)}>
              Personal stats
            </MenuLink>
            <MenuLink href="/notifications" icon={<Bell size={15} />} onClick={() => setOpen(false)}>
              Notifications
            </MenuLink>
            <MenuLink href="/settings" icon={<Settings size={15} />} onClick={() => setOpen(false)}>
              Settings
            </MenuLink>
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-flare transition-colors hover:bg-flare/10"
            >
              <LogOut size={15} />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
