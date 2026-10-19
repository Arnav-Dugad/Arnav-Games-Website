"use client";

/**
 * Settings, as iOS Settings: grouped lists of rows, a quiet caption above
 * each group and an explanatory footer below it.
 *
 * Every control applies immediately — there is no save button, because a
 * save button on a preferences screen is a promise the reader has to trust.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  BellRing,
  Check,
  ChevronRight,
  Gauge,
  Globe2,
  LogOut,
  Sparkles,
  UserRound,
  Wifi,
} from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { usePreferences } from "@/lib/preferences/PreferencesProvider";
import { useThemePreference, type ThemePreference } from "@/lib/preferences/theme";
import { PRICE_REGIONS, usePriceRegion } from "@/lib/preferences/region";
import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";
import { InstallAppRow } from "@/components/pwa/InstallAppRow";
import { SearchField } from "@/components/filters";
import { Sheet } from "@/components/ui/Sheet";
import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/haptics";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { cn } from "@/lib/utils/cn";

export function SettingsView() {
  return (
    <Container className="pb-12 pt-2 lg:pb-16">
      {/* Left-aligned with the page title; a settings column wider than this
          only spreads each row's label and value apart. */}
      <div className="max-w-3xl space-y-8">
        <AccountGroup />
        <AppearanceGroup />
        <Group title="App" footer="Installing keeps Arnav Games one tap away, in its own window.">
          {/* The PWA row is a self-contained cell; its own card chrome is
              flattened so it reads as one row of this group. */}
          <div className="[&>div]:rounded-none [&>div]:border-0 [&>div]:bg-transparent">
            <InstallAppRow />
          </div>
        </Group>
        <PricesGroup />
        <Group title="Notifications" footer="Release reminders run from 14 days before launch to three days after.">
          <NotificationRow />
        </Group>
        <Group title="Motion" footer="Also follows your device's reduced-motion setting when that is on.">
          <MotionRow />
        </Group>
        <DataGroup />
        <SignOutGroup />
      </div>
    </Container>
  );
}

/* -------------------------------------------------------------------------- */
/* Grouped-list primitives                                                    */
/* -------------------------------------------------------------------------- */

function Group({ title, footer, children, id }: { title?: string; footer?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-28">
      {title && <h2 className="mb-2 px-4 text-[13px] font-medium uppercase tracking-[0.04em] text-faint">{title}</h2>}
      <div data-group-panel className="overflow-hidden rounded-2xl border border-line bg-panel/55 light:bg-panel [&>*+*]:border-t [&>*+*]:border-line">
        {children}
      </div>
      {footer && <p className="mt-2 px-4 text-[13px] leading-relaxed text-muted">{footer}</p>}
    </section>
  );
}

function RowIcon({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "mint" | "gold" | "neon" | "flare" }) {
  const tones = {
    brand: "bg-brand text-white",
    mint: "bg-mint text-white",
    gold: "bg-[#ff9f0a] text-white",
    neon: "bg-[#0a84ff] text-white",
    flare: "bg-flare text-white",
  } as const;
  return <span aria-hidden className={cn("grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px]", tones[tone])}>{children}</span>;
}

const rowClass = "flex min-h-[52px] w-full items-center gap-3.5 px-4 py-2.5 text-left";

function NavRow({ href, icon, label, value }: { href: string; icon: ReactNode; label: string; value?: string }) {
  return (
    <Link href={href} className={cn(rowClass, "press transition-colors fine:hover:bg-fg/[0.04]")}>
      {icon}
      <span className="min-w-0 flex-1 truncate text-[15px] sm:text-[16px]">{label}</span>
      {value && <span className="max-w-[45%] truncate text-[15px] text-muted">{value}</span>}
      <ChevronRight size={17} aria-hidden className="shrink-0 text-faint" />
    </Link>
  );
}

function SwitchRow({ icon, label, hint, checked, onChange }: { icon: ReactNode; label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        haptic("selection");
        onChange(!checked);
      }}
      className={cn(rowClass, "transition-colors fine:hover:bg-fg/[0.03]")}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] sm:text-[16px]">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] text-muted">{hint}</span>}
      </span>
      <span aria-hidden className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-300", checked ? "bg-mint" : "bg-fg/[0.16]")}>
        <span
          className={cn(
            "absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_#00000026,0_1px_1px_#00000029] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
            checked ? "translate-x-[22px]" : "translate-x-[2px]",
          )}
        />
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Account                                                                    */
/* -------------------------------------------------------------------------- */

function AccountGroup() {
  const { user, loading, enabled } = useAuth();
  const { entries } = useWatchlist();

  if (loading) {
    return (
      <Group title="Account">
        <div className={rowClass}>
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40 rounded" />
            <Skeleton className="h-3 w-56 rounded" />
          </div>
        </div>
      </Group>
    );
  }

  if (!enabled) {
    return (
      <Group title="Account" footer="Add Firebase credentials to this deployment to enable accounts. Everything else works without them.">
        <div className={rowClass}>
          <RowIcon tone="gold"><UserRound size={17} /></RowIcon>
          <span className="text-[15px] text-muted">Sign-in isn&apos;t configured</span>
        </div>
      </Group>
    );
  }

  if (!user) {
    return (
      <Group title="Account" footer="Your watchlist, library, reviews and stats sync to your account.">
        <Link href="/login?next=%2Fsettings" className={cn(rowClass, "press min-h-[76px] transition-colors fine:hover:bg-fg/[0.04]")}>
          <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-fg/[0.08] text-muted">
            <UserRound size={26} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold text-brand-soft">Sign in</span>
            <span className="mt-0.5 block text-[13px] text-muted">Keep your games on every device</span>
          </span>
          <ChevronRight size={17} aria-hidden className="shrink-0 text-faint" />
        </Link>
        <NavRow href="/signup?next=%2Fsettings" icon={<RowIcon><Sparkles size={16} /></RowIcon>} label="Create an account" />
      </Group>
    );
  }

  const name = user.displayName || user.email?.split("@")[0] || "Player";
  const owned = entries.filter((entry) => (entry.ownedOn ?? []).length > 0).length;

  return (
    <Group title="Account" footer={`${entries.length} tracked · ${owned} owned. Your library and reviews sync to this account.`}>
      <Link href="/profile" className={cn(rowClass, "press min-h-[76px] transition-colors fine:hover:bg-fg/[0.04]")}>
        <Avatar name={name} photo={user.photoURL} uid={user.uid} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-semibold">{name}</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted">{user.email ?? "Profile, reviews and milestones"}</span>
        </span>
        <ChevronRight size={17} aria-hidden className="shrink-0 text-faint" />
      </Link>
    </Group>
  );
}

function Avatar({ name, photo, uid }: { name: string; photo: string | null; uid: string }) {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash << 5) - hash + uid.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return (
    <span
      aria-hidden
      className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full"
      style={{ background: photo ? undefined : `linear-gradient(140deg, hsl(${hue} 68% 52%), hsl(${(hue + 50) % 360} 68% 34%))` }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- third-party avatar URL, tiny, not worth the optimiser
        <img src={photo} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-display text-xl font-bold text-white">{name.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

function SignOutGroup() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  if (!user) return null;
  return (
    <Group>
      <button
        type="button"
        onClick={async () => {
          await signOut();
          toast("Signed out", "info");
          router.push("/");
        }}
        className={cn(rowClass, "press justify-center text-[16px] font-medium text-flare transition-colors fine:hover:bg-flare/[0.06]")}
      >
        <LogOut size={16} aria-hidden />
        Sign out
      </button>
    </Group>
  );
}

/* -------------------------------------------------------------------------- */
/* Appearance                                                                 */
/* -------------------------------------------------------------------------- */

const APPEARANCES: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Automatic" },
];

/** iOS-style picker: a miniature of the page in each theme, chosen by looking. */
function AppearanceGroup() {
  const [theme, setTheme] = useThemePreference();
  return (
    <Group title="Appearance" footer="Automatic follows your device's light or dark setting.">
      <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-3 px-4 py-5 sm:gap-6 sm:px-8">
        {APPEARANCES.map((option) => {
          const active = theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                haptic("selection");
                setTheme(option.value);
              }}
              className="press group flex flex-col items-center gap-2.5"
            >
              <ThemeThumbnail kind={option.value} active={active} />
              <span className={cn("text-[14px] font-medium", active ? "text-text" : "text-muted")}>{option.label}</span>
              <span aria-hidden className={cn("grid h-[22px] w-[22px] place-items-center rounded-full border transition-colors", active ? "border-brand bg-brand" : "border-line-strong")}>
                {active && <Check size={13} strokeWidth={3} className="text-white" />}
              </span>
            </button>
          );
        })}
      </div>
    </Group>
  );
}

function ThemeThumbnail({ kind, active }: { kind: ThemePreference; active: boolean }) {
  // Hard-coded colours on purpose: each thumbnail shows its own theme
  // regardless of which one is currently applied.
  const panel = (tone: "light" | "dark") => (
    <div className={cn("flex h-full flex-col gap-1.5 p-2", tone === "light" ? "bg-[#f5f5f7]" : "bg-black")}>
      <div className={cn("h-2.5 rounded-full", tone === "light" ? "bg-white shadow-sm" : "bg-[#2c2c2e]")} />
      <div className="flex flex-1 gap-1.5">
        <div className={cn("flex-1 rounded-md", tone === "light" ? "bg-white shadow-sm" : "bg-[#1c1c1e]")} />
        <div className={cn("flex-1 rounded-md", tone === "light" ? "bg-white shadow-sm" : "bg-[#1c1c1e]")} />
      </div>
      <div className="h-2 w-2/3 rounded-full bg-[#8a72ff]" />
    </div>
  );
  return (
    <span
      className={cn(
        "block aspect-[3/4] w-full max-w-[88px] overflow-hidden rounded-[14px] shadow-[0_0_0_1px_var(--color-line)] ring-2 ring-offset-2 ring-offset-panel transition-[box-shadow]",
        active ? "ring-brand" : "ring-transparent",
      )}
    >
      {kind === "system" ? (
        <span className="grid h-full grid-cols-2">
          {panel("light")}
          {panel("dark")}
        </span>
      ) : (
        panel(kind)
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Prices                                                                     */
/* -------------------------------------------------------------------------- */

const DETECTED_KEY = `${STORAGE_PREFIX}price-region-detected`;
const noop = () => () => {};

function regionName(code: string | null): string | null {
  if (!code) return null;
  const known = PRICE_REGIONS.find((region) => region.code === code);
  if (known) return known.name;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The detected (automatic) country, read straight from where `region.ts` caches it. */
function useDetectedRegion(region: string | null, explicit: boolean): string | null {
  const stored = useSyncExternalStore(
    noop,
    () => {
      try {
        return window.localStorage.getItem(DETECTED_KEY);
      } catch {
        return null;
      }
    },
    () => null,
  );
  // While automatic, the live region *is* the detected one (and updates with it).
  return explicit ? stored : region ?? stored;
}

/**
 * Arriving from a game page's "Prices for India · Change" link
 * (`/settings#price-region`): the browser scrolls the group into view (its
 * scroll margin clears the floating header), and the group's panel glows
 * once so the eye lands on the right row. Skipped under reduced motion.
 */
function useArrivalHighlight(id: string) {
  const calm = useCalmMotion();
  useEffect(() => {
    const flash = () => {
      if (window.location.hash !== `#${id}`) return;
      if (calm) return;
      const panel = document.getElementById(id)?.querySelector<HTMLElement>("[data-group-panel]");
      panel?.animate(
        [
          { boxShadow: "0 0 0 0 color-mix(in oklab, var(--color-brand) 0%, transparent)" },
          { boxShadow: "0 0 0 4px color-mix(in oklab, var(--color-brand) 55%, transparent)", offset: 0.25 },
          { boxShadow: "0 0 0 0 color-mix(in oklab, var(--color-brand) 0%, transparent)" },
        ],
        { duration: 1600, delay: 250, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
    };
    flash();
    window.addEventListener("hashchange", flash);
    return () => window.removeEventListener("hashchange", flash);
  }, [id, calm]);
}

function PricesGroup() {
  useArrivalHighlight("price-region");
  const [region, setRegion, explicit] = usePriceRegion();
  const detected = useDetectedRegion(region, explicit);
  const [open, setOpen] = useState(false);
  const detectedName = regionName(detected);
  const value = region === null ? "Detecting…" : explicit ? regionName(region) ?? region : `Automatic${detectedName ? ` (${detectedName})` : ""}`;

  return (
    <Group id="price-region" title="Prices" footer="Prices are shown in the store's local currency for this region — real regional prices, never a conversion of US prices.">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(rowClass, "press transition-colors fine:hover:bg-fg/[0.04]")}
      >
        <RowIcon tone="neon"><Globe2 size={17} /></RowIcon>
        <span className="flex-1 whitespace-nowrap text-[15px] sm:text-[16px]">Store region</span>
        <span className="min-w-0 truncate text-[15px] text-muted">{value}</span>
        <ChevronRight size={17} aria-hidden className="shrink-0 text-faint" />
      </button>
      <RegionSheet
        open={open}
        onClose={() => setOpen(false)}
        current={explicit ? region : null}
        detectedName={detectedName}
        onPick={(code) => {
          haptic("selection");
          setRegion(code);
          setOpen(false);
        }}
      />
    </Group>
  );
}

function RegionSheet({
  open,
  onClose,
  current,
  detectedName,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** The explicit choice, or null when automatic. */
  current: string | null;
  detectedName: string | null;
  onPick: (code: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const regions = useMemo(() => {
    const term = query.trim().toLowerCase();
    const sorted = [...PRICE_REGIONS].sort((a, b) => a.name.localeCompare(b.name));
    return term ? sorted.filter((region) => region.name.toLowerCase().includes(term) || region.code.toLowerCase() === term) : sorted;
  }, [query]);

  return (
    <Sheet open={open} onClose={onClose} title="Store region" description="Prices are shown in the store's local currency for this region.">
      <SearchField value={query} onChange={setQuery} placeholder="Search countries" label="Search countries" />
      <ul className="mt-4 overflow-hidden rounded-2xl border border-line bg-fg/[0.03] [&>*+*]:border-t [&>*+*]:border-line">
        {!query && (
          <li>
            <RegionOption selected={current === null} onClick={() => onPick(null)} label="Automatic" detail={detectedName ? `Detected: ${detectedName}` : "Based on where you are"} />
          </li>
        )}
        {regions.map((region) => (
          <li key={region.code}>
            <RegionOption selected={current === region.code} onClick={() => onPick(region.code)} label={region.name} detail={region.code} />
          </li>
        ))}
        {regions.length === 0 && <li className="px-4 py-6 text-center text-[14px] text-muted">No store region matches “{query}”.</li>}
      </ul>
    </Sheet>
  );
}

function RegionOption({ selected, onClick, label, detail }: { selected: boolean; onClick: () => void; label: string; detail: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={cn(rowClass, "min-h-[50px] transition-colors fine:hover:bg-fg/[0.04]")}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px]">{label}</span>
        <span className="block text-[12px] text-faint">{detail}</span>
      </span>
      {selected && <Check size={18} strokeWidth={2.5} aria-hidden className="shrink-0 text-brand-soft" />}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Notifications, motion, data                                                */
/* -------------------------------------------------------------------------- */

function NotificationRow() {
  const { notificationReleases, setNotificationReleases } = usePreferences();
  return (
    <SwitchRow
      icon={<RowIcon tone="flare"><BellRing size={16} /></RowIcon>}
      label="Release reminders"
      checked={notificationReleases}
      onChange={setNotificationReleases}
    />
  );
}

function MotionRow() {
  const { reduceMotion, setReduceMotion } = usePreferences();
  return (
    <SwitchRow
      icon={<RowIcon tone="neon"><Sparkles size={16} /></RowIcon>}
      label="Reduce motion"
      hint="Calms parallax, reveals and physics"
      checked={reduceMotion}
      onChange={setReduceMotion}
    />
  );
}

function DataGroup() {
  const [status, setStatus] = useState<{ ok: boolean; label: string; hint: string | null } | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const body = (await res.json()) as { ok: boolean; igdb: { problem: string | null; hint: string | null } };
      setStatus({ ok: body.ok, label: body.ok ? "Connected" : body.igdb.problem ?? "Unavailable", hint: body.igdb.hint });
    } catch {
      setStatus({ ok: false, label: "Unreachable", hint: null });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Group
      title="Data"
      footer={status?.hint && !status.ok ? status.hint : "Game data comes from IGDB, with Steam filling in PC system requirements where IGDB has none."}
    >
      <button type="button" onClick={check} disabled={checking} className={cn(rowClass, "press transition-colors fine:hover:bg-fg/[0.04]")}>
        <RowIcon tone="mint"><Wifi size={16} /></RowIcon>
        <span className="min-w-0 flex-1 text-[15px] sm:text-[16px]">Check connection</span>
        {checking ? (
          <Gauge size={16} aria-hidden className="animate-pulse text-faint" />
        ) : status ? (
          <span className={cn("inline-flex items-center gap-1 text-[15px]", status.ok ? "text-mint" : "text-flare")}>
            {status.ok && <Check size={15} aria-hidden />}
            {status.label}
          </span>
        ) : (
          <span className="text-[15px] text-muted">Test</span>
        )}
      </button>
    </Group>
  );
}
