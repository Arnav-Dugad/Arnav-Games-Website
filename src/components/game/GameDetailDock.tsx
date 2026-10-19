"use client";

import { useEffect, useState } from "react";
import { Check, Share2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";

export interface DetailSectionLink {
  id: string;
  label: string;
}

export function GameDetailDock({
  gameName,
  sections,
}: {
  gameName: string;
  sections: DetailSectionLink[];
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const [shared, setShared] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-24% 0px -66%", threshold: [0, 0.1] },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sections]);

  const share = async () => {
    const data = { title: gameName, text: `Explore ${gameName} on Arnav Games`, url: window.location.href };
    try {
      if (navigator.share) {
        await navigator.share(data);
        setShared(true);
      } else if (navigator.clipboard?.writeText) {
        // `navigator.clipboard` is undefined on insecure origins and older
        // Safari, so calling it unguarded threw a TypeError and the reader saw
        // "Could not share" rather than the URL they could copy themselves.
        await navigator.clipboard.writeText(window.location.href);
        setShared(true);
        toast("Game link copied", "success");
      } else {
        toast("Copy this page's address to share it", "info");
        return;
      }
      window.setTimeout(() => setShared(false), 1800);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast("Could not share this game", "error");
    }
  };

  return (
    <div className="sticky top-16 z-[100] border-y border-line bg-bg/82 py-2 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.95)] backdrop-blur-2xl backdrop-saturate-150 lg:top-[72px]">
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-2 px-4 lg:px-6 xl:px-10">
        <nav aria-label="Game page sections" className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ul className="flex w-max items-center gap-1">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={active === section.id ? "location" : undefined}
                  className={cn(
                    "relative inline-flex min-h-10 items-center rounded-xl px-3.5 text-xs font-semibold transition-colors sm:text-[13px]",
                    active === section.id
                      ? "bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                      : "text-muted hover:bg-white/[0.04] hover:text-text",
                  )}
                >
                  {section.label}
                  {active === section.id && <span aria-hidden className="absolute inset-x-3 -bottom-2 h-px bg-gradient-to-r from-transparent via-brand-soft to-transparent" />}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <span aria-hidden className="h-7 w-px shrink-0 bg-line" />
        <button
          type="button"
          onClick={share}
          aria-label={`Share ${gameName}`}
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-colors",
            shared ? "border-mint/25 bg-mint/10 text-mint" : "border-line bg-white/[0.035] text-muted hover:border-line-strong hover:text-text",
          )}
        >
          {shared ? <Check size={15} /> : <Share2 size={15} />}
        </button>
      </div>
    </div>
  );
}
