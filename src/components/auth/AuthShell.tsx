import { Suspense, type ReactNode } from "react";
import { Aurora } from "@/components/motion/Aurora";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Auth layout: one calm, centred column, as Apple ID's sign-in is.
 *
 * It used to be a split screen with a panel of perks on desktop. Someone on
 * this page has already decided to sign in; selling them the account again
 * only moved the form off-centre. The form's own title says what it's for.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh-safe justify-center px-5 pb-16 pt-28 sm:items-center sm:pb-24 sm:pt-32">
      <Aurora intensity="subtle" className="-z-10" />
      <Suspense fallback={<AuthFormFallback />}>{children}</Suspense>
    </div>
  );
}

function AuthFormFallback() {
  return (
    <div className="w-full max-w-[400px] space-y-4" aria-hidden>
      <Skeleton className="mx-auto h-10 w-3/5" />
      <div className="space-y-3 pt-8">
        <Skeleton className="h-[52px] w-full rounded-full" />
        <Skeleton className="h-[112px] w-full rounded-2xl" />
        <Skeleton className="h-[52px] w-full rounded-full" />
      </div>
    </div>
  );
}
