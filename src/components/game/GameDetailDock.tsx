"use client";

/**
 * The game page's sticky bar: in-page section navigation plus the game's
 * identity and primary action once the hero has scrolled away.
 *
 * App Store product pages do this — the icon and "Get" slide into the nav
 * bar the moment the header leaves — so the one action that matters
 * (Follow) is never more than a tap away on a long page, and the reader
 * always knows whose page they're on. Before that point the bar shows only
 * the sections, because the hero already says all of it.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Check, Share2 } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { WatchButton } from "@/components/game/WatchButton";
import { CompareButton } from "@/components/game/detail/CompareButton";
import type { PickedGame } from "@/components/compare/GamePickerSheet";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import type { GameSummary } from "@/lib/games/types";

export interface DetailSectionLink {
  id: string;
  label: string;
}

/** The hero's element id; the bar watches it to know when to show identity. */
export const GAME_HERO_ID = "game-hero";

export function GameDetailDock({
  game,
  sections,
  compareSuggestions,
}: {
  game: GameSummary;
  sections: DetailSectionLink[];
  compareSuggestions: PickedGame[];
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const [stuck, setStuck] = useState(false);
  const [shared, setShared] = useState(false);
  const { toast } = useToast();
  const calm = useCalmMotion();
  const navRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Keep the active link visible in the horizontally scrolling row on phones,
  // moving only the row itself (scrollIntoView would also scroll the page).
  useEffect(() => {
    const nav = navRef.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !link) return;
    const navBox = nav.getBoundingClientRect();
    const linkBox = link.getBoundingClientRect();
    const left = nav.scrollLeft + (linkBox.left - navBox.left) - navBox.width / 2 + linkBox.width / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: calm ? "auto" : "smooth" });
  }, [active, calm]);

  // The active section is the last one whose top has passed a line a third
  // of the way down the screen. Measured on scroll (one rAF per frame) rather
  // than with an IntersectionObserver band: sections not in the nav (About,
  // News…) sit between tracked ones, and a band misses the moment a long
  // section is scrolled back past.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.innerHeight * 0.33;
      let current = sections[0]?.id ?? "";
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= line) current = section.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sections]);

  // "Stuck" = the hero has scrolled up behind the bar.
  useEffect(() => {
    const hero = document.getElementById(GAME_HERO_ID);
    const bar = barRef.current;
    if (!hero || !bar) return;
    const top = Math.round(bar.getBoundingClientRect().height + (parseFloat(getComputedStyle(bar).top) || 64));
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      rootMargin: `-${top}px 0px 0px 0px`,
      threshold: 0,
    });
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  const share = async () => {
    const url = window.location.href.split("#")[0];
    const data = { title: game.name, text: `${game.name} on Arnav Games`, url };
    try {
      if (navigator.share) {
        await navigator.share(data);
        setShared(true);
      } else if (navigator.clipboard?.writeText) {
        // `navigator.clipboard` is undefined on insecure origins and older
        // Safari; calling it unguarded threw and showed "Could not share".
        await navigator.clipboard.writeText(url);
        setShared(true);
        toast("Game link copied", "success");
      } else {
        toast("Copy this page's address to share it", "info");
        return;
      }
      haptic("success");
      window.setTimeout(() => setShared(false), 1800);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast("Could not share this game", "error");
    }
  };

  return (
    <div
      ref={barRef}
      className="sticky top-(--chrome-top) z-(--z-sticky) border-b border-line bg-bg/80 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150 light:shadow-[0_14px_36px_-28px_rgba(0,0,0,0.25)] lg:top-[72px]"
    >
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-2 px-4 lg:px-6 xl:px-10">
        <AnimatePresence initial={false}>
          {stuck && (
            <motion.a
              key="identity"
              href={`#${GAME_HERO_ID}`}
              onClick={(event) => {
                event.preventDefault();
                window.scrollTo({ top: 0, behavior: calm ? "auto" : "smooth" });
              }}
              aria-label={`Back to the top of ${game.name}`}
              initial={calm ? { opacity: 0 } : { opacity: 0, width: 0, x: -8 }}
              animate={calm ? { opacity: 1 } : { opacity: 1, width: "auto", x: 0 }}
              exit={calm ? { opacity: 0 } : { opacity: 0, width: 0, x: -8 }}
              transition={{ type: "spring", stiffness: 420, damping: 38 }}
              className="flex shrink-0 items-center gap-2.5 overflow-hidden"
            >
              <span className="relative h-9 w-[27px] shrink-0 overflow-hidden rounded-md bg-fg/[0.06] shadow-sm">
                <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={80} sizes="27px" rounded="rounded-md" />
              </span>
              <span className="hidden max-w-[11rem] truncate text-[14px] font-semibold text-text md:block">{game.name}</span>
              <span aria-hidden className="ml-1 hidden h-6 w-px bg-line md:block" />
            </motion.a>
          )}
        </AnimatePresence>

        <nav
          ref={navRef}
          aria-label="Game page sections"
          className="min-w-0 flex-1 overflow-x-auto [mask-image:linear-gradient(90deg,#000_calc(100%-24px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex w-max items-center gap-0.5 pr-6">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={() => haptic("selection")}
                  aria-current={active === section.id ? "location" : undefined}
                  className={cn(
                    "relative inline-flex min-h-10 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors coarse:min-h-11",
                    // The current section wears the cover's accent, like the rail's tick.
                    active === section.id
                      ? "bg-[color-mix(in_oklab,var(--game-accent,var(--color-brand))_17%,transparent)] text-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--game-accent,var(--color-brand))_22%,transparent)]"
                      : "text-muted fine:hover:bg-fg/[0.05] fine:hover:text-text",
                  )}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          <AnimatePresence initial={false}>
            {stuck && (
              <motion.span
                key="follow"
                initial={calm ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={calm ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
                transition={{ type: "spring", stiffness: 520, damping: 30 }}
                className="flex"
              >
                <WatchButton game={game} variant="icon" className="h-10 w-10 coarse:h-10 coarse:w-10" />
              </motion.span>
            )}
            {/* The hero has its own Compare; the bar's appears once that one has scrolled away. */}
            {stuck && (
              <motion.span
                key="compare"
                initial={calm ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={calm ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
                transition={{ type: "spring", stiffness: 520, damping: 30 }}
                className="hidden sm:flex"
              >
                <CompareButton slug={game.slug} name={game.name} suggestions={compareSuggestions} variant="icon" />
              </motion.span>
            )}
          </AnimatePresence>
          <button
            type="button"
            onClick={share}
            aria-label={`Share ${game.name}`}
            className={cn(
              "press grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-colors",
              shared ? "border-mint/25 bg-mint/10 text-mint" : "border-line bg-fg/[0.035] text-muted fine:hover:border-line-strong fine:hover:text-text",
            )}
          >
            {shared ? <Check size={15} /> : <Share2 size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}
