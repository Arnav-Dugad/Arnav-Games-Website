import { Suspense, type ReactNode } from "react";
import { Bookmark, CalendarClock, Star } from "lucide-react";
import { Aurora, GridLines } from "@/components/motion/Aurora";
import { Reveal } from "@/components/motion/Reveal";
import { Logo } from "@/components/layout/Logo";
import { Skeleton } from "@/components/ui/Skeleton";

const PERKS = [
  {
    icon: CalendarClock,
    title: "Release countdowns",
    body: "Know exactly how long until the games you care about land.",
  },
  {
    icon: Bookmark,
    title: "A watchlist that syncs",
    body: "Save titles on your phone, pick them up on your desktop.",
  },
  {
    icon: Star,
    title: "Rate what you finish",
    body: "Score games out of ten and see how the community landed.",
  },
];

/**
 * Split auth layout: form on the left, editorial panel on the right.
 *
 * The panel is desktop-only — on a phone it would push the form below the fold
 * for no benefit, so touch users get straight to the fields.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh-safe lg:grid-cols-2">
      <div className="flex items-center justify-center px-5 py-24 sm:px-10 lg:px-16">
        <Suspense fallback={<AuthFormFallback />}>{children}</Suspense>
      </div>

      <aside className="noise relative isolate hidden overflow-hidden border-l border-line lg:flex lg:flex-col lg:justify-center lg:px-16">
        <Aurora intensity="normal" className="-z-10" />
        <GridLines className="-z-10" />

        <Reveal>
          <Logo />
          <h2 className="mt-10 max-w-md font-display text-[2.6rem] font-black leading-[1.05] tracking-[-0.04em]">
            Your games, <span className="text-gradient">tracked properly.</span>
          </h2>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-muted">
            One account, every release you&rsquo;re waiting for, on every device you use.
          </p>
        </Reveal>

        <ul className="mt-12 space-y-6">
          {PERKS.map((perk, i) => {
            const Icon = perk.icon;
            return (
              <Reveal as="li" key={perk.title} delay={0.1 + i * 0.08} className="flex gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-fg/[0.04]">
                  <Icon size={18} className="text-brand-soft" />
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold">{perk.title}</h3>
                  <p className="mt-1 max-w-xs text-sm leading-relaxed text-muted">{perk.body}</p>
                </div>
              </Reveal>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}

function AuthFormFallback() {
  return (
    <div className="w-full max-w-md space-y-4">
      <Skeleton className="h-10 w-3/5" />
      <Skeleton className="h-4 w-4/5" />
      <div className="space-y-3 pt-6">
        <Skeleton className="h-[52px] w-full rounded-xl" />
        <Skeleton className="h-[52px] w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-full" />
      </div>
    </div>
  );
}
