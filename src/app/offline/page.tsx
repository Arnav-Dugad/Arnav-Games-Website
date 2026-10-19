import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";
import { RetryButton } from "@/components/pwa/RetryButton";

/**
 * Offline fallback.
 *
 * The service worker precaches this page and serves it in place of any
 * navigation that fails with no saved copy, so the address bar still shows
 * the page the person asked for — "Try again" simply reloads it.
 *
 * Deliberately static and motion-free: it has to render correctly from cache
 * even if none of its scripts are available, so nothing here may start
 * invisible and wait for JavaScript to reveal it.
 */

export const metadata: Metadata = {
  title: "You're offline",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <Container className="flex min-h-[70dvh] flex-col items-center justify-center py-28 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-3xl bg-fg/[0.06] text-gold">
        <WifiOff size={28} aria-hidden />
      </span>
      <h1 className="mt-6 font-display text-[34px] font-bold tracking-[-0.03em] sm:text-5xl">
        You&rsquo;re offline
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-muted sm:text-[17px]">
        This page isn&rsquo;t saved on this device. Your library and pages you&rsquo;ve opened recently still work.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button href="/library">Open your library</Button>
        <RetryButton />
      </div>
    </Container>
  );
}
