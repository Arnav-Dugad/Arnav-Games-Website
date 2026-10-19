"use client";

import { useCallback, useRef, useState } from "react";
import { Check, ChevronRight, Cloud, Gamepad2, Sparkles, X } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { useRouter } from "next/navigation";
import { Popover } from "@/components/ui/Popover";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/haptics";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import type { SubscriptionAccess } from "@/lib/firebase/db";
import type { GameSummary } from "@/lib/games/types";
import { cn } from "@/lib/utils/cn";

export interface Service {
  slug: string;
  name: string;
  icon: string;
  platforms: string[];
}

export const SUBSCRIPTION_SERVICES: Service[] = [
  { slug: "game-pass", name: "Game Pass", icon: "xbox", platforms: ["xbox", "pc", "cloud"] },
  { slug: "playstation-plus", name: "PlayStation Plus", icon: "playstation", platforms: ["playstation", "cloud"] },
  { slug: "ea-play", name: "EA Play", icon: "ea", platforms: ["pc", "xbox", "playstation"] },
  { slug: "ubisoft-plus", name: "Ubisoft+", icon: "ubisoft", platforms: ["pc", "xbox", "playstation", "cloud"] },
  { slug: "nintendo-switch-online", name: "Nintendo Switch Online", icon: "nintendo", platforms: ["nintendo"] },
  { slug: "apple-arcade", name: "Apple Arcade", icon: "applearcade", platforms: ["mobile", "mac"] },
  { slug: "netflix-games", name: "Netflix Games", icon: "netflix", platforms: ["mobile"] },
  { slug: "amazon-luna", name: "Amazon Luna", icon: "amazonluna", platforms: ["cloud"] },
  { slug: "geforce-now", name: "GeForce NOW", icon: "nvidia", platforms: ["cloud", "pc"] },
];

const PLATFORM_LABELS: Record<string, string> = {
  pc: "PC",
  xbox: "Xbox",
  playstation: "PlayStation",
  nintendo: "Nintendo Switch",
  mobile: "Mobile",
  mac: "Mac",
  cloud: "Cloud",
};

export function subscriptionServiceName(slug: string): string {
  return SUBSCRIPTION_SERVICES.find((service) => service.slug === slug)?.name
    ?? slug.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function subscriptionServiceIcon(slug: string): string | null {
  return SUBSCRIPTION_SERVICES.find((service) => service.slug === slug)?.icon ?? null;
}

export function SubscriptionAccessPicker({
  game,
  className,
}: {
  game: GameSummary;
  className?: string;
}) {
  const { user, enabled } = useAuth();
  const { accessOf, setAccess, ensure } = useWatchlist();
  const { toast } = useToast();
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [service, setService] = useState<Service | null>(null);
  const [pending, setPending] = useState<SubscriptionAccess[] | null>(null);
  const [busy, setBusy] = useState(false);
  const access = pending ?? accessOf(game.id);
  const close = useCallback(() => {
    setOpen(false);
    setService(null);
  }, []);

  const requireAccount = () => {
    if (!enabled) {
      toast("Sign-in isn't configured for this deployment yet.", "info");
      return false;
    }
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/game/${game.slug}`)}`);
      return false;
    }
    return true;
  };

  const save = async (next: SubscriptionAccess[]) => {
    if (!requireAccount()) return;
    setPending(next);
    setBusy(true);
    try {
      await ensure(game);
      await setAccess(game.id, next);
      haptic("success");
      toast("Subscription play history updated", "success");
    } catch (error) {
      haptic("warning");
      setPending(null);
      toast(error instanceof Error ? error.message : "Couldn't save that access.", "error");
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const choosePlatform = async (platform: string) => {
    if (!service) return;
    const item = { service: service.slug, platform };
    const exists = access.some((entry) => entry.service === item.service && entry.platform === item.platform);
    const next = exists
      ? access.filter((entry) => entry.service !== item.service || entry.platform !== item.platform)
      : [...access, item];
    await save(next);
    setService(null);
  };

  const remove = (item: SubscriptionAccess) => save(
    access.filter((entry) => entry.service !== item.service || entry.platform !== item.platform),
  );

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex min-h-12 items-center gap-2 rounded-full border px-5 text-sm font-semibold press transition-[background-color,border-color,color]",
          access.length
            ? "border-neon/40 bg-neon/10 text-text"
            : "border-fg/15 bg-fg/[0.08] text-text backdrop-blur-xl fine:hover:bg-fg/[0.14]",
          busy && "opacity-60",
        )}
      >
        <Sparkles size={17} className={access.length ? "text-neon" : undefined} />
        {access.length ? (
          `Subscription · ${access.length}`
        ) : (
          <>
            <span className="sm:hidden">Subscription</span>
            <span className="hidden sm:inline">Played via subscription</span>
          </>
        )}
      </button>

      <Popover open={open} onClose={close} anchorRef={triggerRef} width={340} label="Subscription play history">
        <div className="border-b border-line px-3 pb-3 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-neon">Access history</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">Record the service and the platform you actually used. This never counts as ownership.</p>
        </div>

        {access.length > 0 && (
          <ul className="space-y-1 border-b border-line p-2">
            {access.map((item) => (
              <li key={`${item.service}:${item.platform}`} className="flex items-center gap-2 rounded-xl bg-fg/[0.045] px-3 py-2.5 text-sm">
                {subscriptionServiceIcon(item.service)
                  ? <BrandIcon name={subscriptionServiceIcon(item.service)!} size={15} title={null} tinted />
                  : item.platform === "cloud"
                    ? <Cloud size={14} className="text-neon" />
                    : <Gamepad2 size={14} className="text-brand-soft" />}
                <span className="min-w-0 flex-1 truncate"><strong>{subscriptionServiceName(item.service)}</strong><span className="text-faint"> · {PLATFORM_LABELS[item.platform] ?? item.platform}</span></span>
                <button type="button" onClick={() => remove(item)} disabled={busy} aria-label={`Remove ${subscriptionServiceName(item.service)} on ${PLATFORM_LABELS[item.platform] ?? item.platform}`} className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-fg/10 hover:text-text"><X size={13} /></button>
              </li>
            ))}
          </ul>
        )}

        <div className="max-h-[min(55vh,22rem)] overflow-y-auto p-2">
          {!service ? (
            <ul className="space-y-1">
              {SUBSCRIPTION_SERVICES.map((item) => (
                <li key={item.slug}>
                  <button type="button" onClick={() => setService(item)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted transition-colors hover:bg-fg/[0.06] hover:text-text">
                    <span className="grid h-8 w-8 place-items-center rounded-xl border border-fg/[0.08] bg-fg/[0.05]"><BrandIcon name={item.icon} size={16} title={null} tinted /></span>
                    <span className="flex-1 font-medium">{item.name}</span>
                    <ChevronRight size={14} className="text-faint" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div>
              <button type="button" onClick={() => setService(null)} className="mb-2 px-3 py-1 text-xs font-semibold text-faint hover:text-text">← All services</button>
              <p className="px-3 pb-2 text-sm font-bold">Where did you play through {service.name}?</p>
              <ul className="space-y-1">
                {service.platforms.map((platform) => {
                  const active = access.some((item) => item.service === service.slug && item.platform === platform);
                  return <li key={platform}><button type="button" onClick={() => choosePlatform(platform)} disabled={busy} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors", active ? "bg-neon/10 text-text" : "text-muted hover:bg-fg/[0.06] hover:text-text")}><Gamepad2 size={14} /><span className="flex-1">{PLATFORM_LABELS[platform] ?? platform}</span>{active && <Check size={14} className="text-neon" />}</button></li>;
                })}
              </ul>
            </div>
          )}
        </div>
      </Popover>
    </div>
  );
}
