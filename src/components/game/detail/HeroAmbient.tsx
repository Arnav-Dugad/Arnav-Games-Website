"use client";

/**
 * Client-side pieces of the (server-rendered) game hero:
 *
 *  - `HeroParticlesGate`: decides whether the ambient particles run at all —
 *    desktop with a fine pointer, at `lg` and up, motion allowed, Save-Data
 *    off — and only then loads them (`next/dynamic`, no SSR), so phones and
 *    the Worker's server render never carry the canvas code.
 *  - `LogoTransitionTarget`: names the hero logo for the search-result →
 *    game-page morph. Like the hero cover (`CoverTransition` role="target"),
 *    the page side is always named — there is only ever one hero logo — and
 *    the *source* (a search result, `LogoMorph`) claims the same name only
 *    when it is the one activated, so duplicates never abort the transition.
 *    Both sides use the same `logo-morph` class.
 */

import dynamic from "next/dynamic";
import { ViewTransition, useEffect, useState, type ReactNode } from "react";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { logoTransitionName } from "@/components/interactions/view-transition";
import { LOGO_MORPH_CLASS } from "@/components/search/LogoMorph";

const HeroParticles = dynamic(() => import("./HeroParticles").then((mod) => mod.HeroParticles), { ssr: false });

const DESKTOP = "(pointer: fine) and (min-width: 1024px)";

export function HeroParticlesGate() {
  const calm = useCalmMotion();
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
    const update = () => setDesktop(query.matches && !saveData);
    // A frame later, keeping the state write off the effect body.
    const frame = requestAnimationFrame(update);
    query.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(frame);
      query.removeEventListener("change", update);
    };
  }, []);

  if (calm || !desktop) return null;
  return <HeroParticles />;
}

export function LogoTransitionTarget({ slug, children }: { slug: string; children: ReactNode }) {
  return (
    <ViewTransition name={logoTransitionName(slug)} share={LOGO_MORPH_CLASS} enter="none" exit="none" update="none" default="none">
      {/* One wrapper element = one snapshot, whatever the logo renders inside (image + reveal slices). */}
      <span className="block w-fit max-w-full">{children}</span>
    </ViewTransition>
  );
}
