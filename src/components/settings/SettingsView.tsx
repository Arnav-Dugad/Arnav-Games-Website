"use client";

import { useRouter } from "next/navigation";

/**
 * Settings.
 *
 * Every control here applies immediately — there is no save button, because a
 * save button on a preferences screen is a promise the reader has to trust.
 */

import { useState, type ReactNode } from "react";
import {
  SunMoon,
  BellRing,
  Bookmark,
  Check,
  Gauge,
  LogOut,
  Sparkles,
  UserRound,
  Wifi,
} from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { usePreferences } from "@/lib/preferences/PreferencesProvider";
import { useThemePreference, type ThemePreference } from "@/lib/preferences/theme";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { useToast } from "@/components/ui/Toast";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils/cn";

export function SettingsView() {
  return (
    <Container className="max-w-3xl py-10 lg:py-14">
      <div className="space-y-5">
        <AppearanceCard />
        <NotificationCard />
        <MotionCard />
        <AccountCard />
        <DataCard />
      </div>
    </Container>
  );
}

function SettingCard({
  id,
  icon,
  title,
  description,
  children,
  delay = 0,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <Reveal id={id} delay={delay} blur={false}>
      <section className="glass rounded-3xl p-5 sm:p-7">
        <header className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-line bg-fg/[0.04] text-brand-soft">
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
          </div>
        </header>
        <div className="mt-6">{children}</div>
      </section>
    </Reveal>
  );
}

function NotificationCard() {
  const {
    notificationReleases,
    setNotificationReleases,
  } = usePreferences();

  return (
    <SettingCard
      id="notifications"
      icon={<BellRing size={19} />}
      title="Notification center"
      description="Choose which live signals appear in your header inbox and notification center."
      delay={0.05}
    >
      <div className="space-y-2.5">
        <Toggle
          checked={notificationReleases}
          onChange={setNotificationReleases}
          label="Release reminders"
          hint="From 14 days before launch through the first three days after release."
        />
      </div>
    </SettingCard>
  );
}


const APPEARANCES: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "Automatic" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * iOS-style appearance picker: a miniature of the page in each theme, so the
 * choice is made by looking rather than by reading.
 */
function AppearanceCard() {
  const [theme, setTheme] = useThemePreference();

  return (
    <SettingCard
      icon={<SunMoon size={19} />}
      title="Appearance"
      description="Automatic follows your device's light or dark setting."
    >
      <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-3 sm:gap-5">
        {APPEARANCES.map((option) => {
          const active = theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(option.value)}
              className="press group flex flex-col items-center gap-2.5"
            >
              <ThemeThumbnail kind={option.value} active={active} />
              <span className={cn("text-sm font-medium", active ? "text-text" : "text-muted")}>{option.label}</span>
              <span
                aria-hidden
                className={cn(
                  "grid h-5 w-5 place-items-center rounded-full border transition-colors",
                  active ? "border-brand bg-brand" : "border-line-strong",
                )}
              >
                {active && <span className="h-2 w-2 rounded-full bg-white" />}
              </span>
            </button>
          );
        })}
      </div>
    </SettingCard>
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
        // The hairline keeps the light thumbnail's edge visible on a white card;
        // the ring offset matches that card in the light theme.
        "block aspect-[3/4] w-full max-w-[96px] overflow-hidden rounded-2xl shadow-[0_0_0_1px_var(--color-line)] ring-2 ring-offset-2 ring-offset-bg transition-[box-shadow] light:ring-offset-panel",
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

function MotionCard() {
  const { reduceMotion, setReduceMotion } = usePreferences();

  return (
    <SettingCard
      icon={<Sparkles size={19} />}
      title="Motion"
      description="The interface uses parallax, reveals and hover effects. Turn them down if you'd rather it stayed still."
      delay={0.05}
    >
      <Toggle
        checked={reduceMotion}
        onChange={setReduceMotion}
        label="Reduce motion"
        hint="Also follows your system setting when that's enabled."
      />
    </SettingCard>
  );
}

function AccountCard() {
  const { user, loading, enabled, signOut } = useAuth();
  const { entries } = useWatchlist();
  const router = useRouter();
  const { toast } = useToast();

  if (loading) {
    return (
      <SettingCard
        icon={<UserRound size={19} />}
        title="Account"
        description="Your sign-in and synced data."
        delay={0.1}
      >
        <div className="shimmer-bg h-12 rounded-xl" />
      </SettingCard>
    );
  }

  const owned = entries.filter((entry) => (entry.ownedOn ?? []).length > 0).length;

  return (
    <SettingCard
      icon={<UserRound size={19} />}
      title="Account"
      description={
        enabled
          ? "Your watchlist, library and reviews sync to this account."
          : "Sign-in isn't configured for this deployment."
      }
      delay={0.1}
    >
      {!enabled ? (
        <p className="text-sm text-muted">
          Add Firebase credentials to enable accounts. Everything else works without them.
        </p>
      ) : user ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-fg/[0.04] px-4 py-2 text-sm">
              <span className="truncate font-medium">{user.displayName || user.email}</span>
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-fg/[0.04] px-4 py-2 text-sm">
              <Bookmark size={14} className="text-brand-soft" />
              <span className="font-semibold tabular-nums">{entries.length}</span>
              <span className="text-muted">tracked</span>
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-fg/[0.04] px-4 py-2 text-sm">
              <span className="font-semibold tabular-nums">{owned}</span>
              <span className="text-muted">owned</span>
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button href="/profile" variant="secondary" size="sm">
              Edit profile
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<LogOut size={15} />}
              onClick={async () => {
                await signOut();
                toast("Signed out", "info");
                router.push("/");
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button href="/login?next=%2Fsettings" size="sm">
            Sign in
          </Button>
          <Button href="/signup?next=%2Fsettings" variant="secondary" size="sm">
            Create an account
          </Button>
        </div>
      )}
    </SettingCard>
  );
}

function DataCard() {
  const [status, setStatus] = useState<
    { ok: boolean; label: string; hint: string | null } | null
  >(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const body = (await res.json()) as {
        ok: boolean;
        igdb: { problem: string | null; hint: string | null };
      };
      setStatus({
        ok: body.ok,
        label: body.ok ? "IGDB is responding normally." : (body.igdb.problem ?? "Unavailable"),
        hint: body.igdb.hint,
      });
    } catch {
      setStatus({ ok: false, label: "Couldn't reach the health endpoint.", hint: null });
    } finally {
      setChecking(false);
    }
  };

  return (
    <SettingCard
      icon={<Wifi size={19} />}
      title="Data source"
      description="Game data comes from IGDB, with Steam used only when a platform-specific system requirement is unavailable there."
      delay={0.15}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={check} loading={checking} icon={<Gauge size={15} />}>
          Check connection
        </Button>
        {status && (
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px]",
              status.ok
                ? "border-mint/30 bg-mint/10 text-mint"
                : "border-flare/30 bg-flare/10 text-flare",
            )}
          >
            {status.ok && <Check size={14} />}
            {status.label}
          </span>
        )}
      </div>
      {status?.hint && !status.ok && (
        <p className="mt-3 text-[13px] leading-relaxed text-muted">{status.hint}</p>
      )}
    </SettingCard>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-4 rounded-2xl border border-line bg-fg/[0.03] px-4 py-3.5 text-left transition-colors hover:border-line-strong"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300",
          checked ? "bg-brand" : "bg-fg/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_2px_5px_#00000040] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
