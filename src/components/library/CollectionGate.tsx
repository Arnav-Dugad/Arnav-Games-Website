"use client";

/**
 * Account gate for the personal pages (library, watchlist, stats, profile).
 *
 * Like `AuthGate`, it never redirects while Firebase is still restoring the
 * session — that would bounce signed-in readers on every refresh. Unlike it,
 * the signed-out state *sells* the page: what you'd get, in three lines, then
 * one clear action. The page's own header already owns the `h1`, so this
 * speaks in `h2`.
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";

export interface PitchPoint {
  icon: ReactNode;
  title: string;
  body: string;
}

export function CollectionGate({
  title,
  body,
  points,
  children,
  skeleton,
}: {
  title: string;
  body: string;
  points: PitchPoint[];
  children: ReactNode;
  /** Shown while the session restores; should match the page's layout. */
  skeleton?: ReactNode;
}) {
  const { user, loading, enabled } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      skeleton ?? (
        <Container className="py-8">
          <Skeleton className="h-48 rounded-3xl" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}
          </div>
        </Container>
      )
    );
  }

  if (!enabled) {
    return (
      <Container className="py-16">
        <div className="mx-auto max-w-md text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gold/12 text-gold">
            <Settings2 size={24} aria-hidden />
          </span>
          <h2 className="mt-5 font-display text-[22px] font-bold">Accounts aren&apos;t set up here</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            This deployment has no Firebase keys, so sign-in is off. Everything public still works.
          </p>
          <Button href="/browse" variant="secondary" size="sm" className="mt-6">Browse games</Button>
        </div>
      </Container>
    );
  }

  if (!user) {
    const next = encodeURIComponent(pathname || "/");
    return (
      <Container className="py-6 sm:py-10">
        <section className="max-w-xl">
          <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] sm:text-[28px]">{title}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted sm:text-[17px]">{body}</p>
          <ul className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel/55 light:bg-panel">
            {points.map((point, index) => (
              <li key={point.title} className={index > 0 ? "flex gap-3.5 border-t border-line px-4 py-3.5" : "flex gap-3.5 px-4 py-3.5"}>
                <span aria-hidden className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-brand/14 text-brand-soft">
                  {point.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">{point.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{point.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button href={`/login?next=${next}`}>Sign in</Button>
            <Button href={`/signup?next=${next}`} variant="secondary">Create an account</Button>
          </div>
          <p className="mt-4 text-[13px] text-faint">Free, and your library follows you to every device.</p>
        </section>
      </Container>
    );
  }

  return <>{children}</>;
}
