"use client";

/**
 * Client-side guard for account-only pages.
 *
 * Renders three distinct states rather than redirecting blindly: still
 * resolving, Firebase not configured, and signed out. Redirecting during the
 * resolving state would bounce signed-in users on every hard refresh, since
 * Firebase restores the session asynchronously.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LockKeyhole, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, enabled } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      <Container className="py-28">
        <div className="mx-auto max-w-3xl space-y-4">
          <Skeleton className="h-9 w-52" />
          <Skeleton className="h-4 w-72" />
          <div className="grid gap-3 pt-6 sm:grid-cols-2">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
          </div>
        </div>
      </Container>
    );
  }

  if (!enabled) {
    return (
      <Prompt
        icon={<Settings2 size={24} className="text-gold" />}
        title="Accounts aren't configured yet"
        body="Add your Firebase web-app keys to enable sign-in, watchlists and reviews. The rest of the site works without them."
      >
        <Button href="/browse" variant="secondary">
          Browse games instead
        </Button>
      </Prompt>
    );
  }

  if (!user) {
    return (
      <Prompt
        icon={<LockKeyhole size={24} className="text-brand-soft" />}
        title="Sign in to continue"
        body="This page is tied to your account. Sign in and you'll come straight back here."
      >
        <Button href={`/login?next=${encodeURIComponent(pathname || "/")}`}>Sign in</Button>
        <Link
          href={`/signup?next=${encodeURIComponent(pathname || "/")}`}
          className="text-sm text-muted transition-colors hover:text-text"
        >
          Create an account
        </Link>
      </Prompt>
    );
  }

  return <>{children}</>;
}

function Prompt({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <Container className="flex min-h-[70svh] flex-col items-center justify-center py-24 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl border border-line bg-fg/[0.04]">
        {icon}
      </span>
      <h1 className="mt-6 font-display text-2xl font-bold sm:text-3xl">{title}</h1>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">{body}</p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-4">{children}</div>
    </Container>
  );
}
