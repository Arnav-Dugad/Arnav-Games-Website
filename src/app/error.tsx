"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/SectionHeading";

/**
 * Route-level error boundary. Renders whenever a server component throws — most
 * plausibly a network failure the data layer couldn't absorb, which is why
 * "Try again" leads: it usually works.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <Container className="flex min-h-[80svh] flex-col items-center justify-center py-24 text-center">
      <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] sm:text-[34px]">This page didn&rsquo;t load</h1>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted sm:text-[17px]">
        It&rsquo;s usually a brief hiccup with our game data. Try again in a moment.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset} icon={<RotateCcw size={16} aria-hidden />}>
          Try again
        </Button>
        <Button href="/" variant="secondary">
          Home
        </Button>
      </div>
      {error.digest && <p className="mt-8 font-mono text-[11px] text-faint">Reference {error.digest}</p>}
    </Container>
  );
}
