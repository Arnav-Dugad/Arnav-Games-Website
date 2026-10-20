"use client";

/**
 * A slim "you are here" rail for long pages: one tick per section at the
 * right edge of the window, the current one drawn longer in the page accent.
 * Hovering the rail (or tabbing into it) unfolds every section's name beside
 * its tick, like the scrubber in a long Apple document; a click glides there.
 *
 * Desktop with a fine pointer, at `xl` and up, only: that is where the right
 * gutter is wide enough for it to sit beside the content rather than on it.
 * Phones keep each page's own sticky section bar (game dock, stats jump bar).
 *
 * The active section comes from one IntersectionObserver, never a scroll
 * handler: the observed band runs from far above the viewport down to a line
 * 38% of the way down it, so "intersecting" means exactly "its top has passed
 * the line" — including after a jump that skips straight over a section,
 * which a narrow band would miss. The rail stays out of sight until the first
 * section reaches that line, so it never sits over a hero.
 *
 * Sections that render late (signed-in data, lazily loaded blocks) are picked
 * up by a frame-throttled scan of the ids whenever the page's DOM changes;
 * missing ids are simply not shown.
 */

import { useEffect, useRef, useState } from "react";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { cn } from "@/lib/utils/cn";

export interface MiniMapSection {
  id: string;
  label: string;
}

/** The band's bottom edge: 38% down the viewport. */
const ROOT_MARGIN = "99999px 0px -62% 0px";

export function SectionMiniMap({ sections, label = "Page outline" }: { sections: MiniMapSection[]; label?: string }) {
  const calm = useCalmMotion();
  const [present, setPresent] = useState<MiniMapSection[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const passed = useRef(new Map<string, boolean>());
  // A stable key, so a parent re-rendering with an equal list doesn't
  // restart the observers.
  const key = sections.map((section) => `${section.id}\u0000${section.label}`).join("\u0001");

  // Which sections exist right now. Rescanned (once per frame at most) when
  // the page's DOM changes, so late sections join the rail.
  useEffect(() => {
    const list = key.split("\u0001").filter(Boolean).map((entry) => {
      const [id, text] = entry.split("\u0000");
      return { id, label: text };
    });
    let frame = 0;
    let last = "";
    const scan = () => {
      frame = 0;
      const found = list.filter((section) => document.getElementById(section.id));
      const signature = found.map((section) => section.id).join(",");
      if (signature === last) return;
      last = signature;
      setPresent(found);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(scan);
    };
    schedule();
    const main = document.getElementById("main") ?? document.body;
    const mutations = new MutationObserver(schedule);
    mutations.observe(main, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
    };
  }, [key]);

  useEffect(() => {
    if (present.length < 2 || typeof IntersectionObserver === "undefined") return;
    const state = passed.current;
    state.clear();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          state.set(entry.target.id, entry.isIntersecting || entry.boundingClientRect.top < 0);
        }
        let current: string | null = null;
        for (const section of present) if (state.get(section.id)) current = section.id;
        setActive(current);
      },
      { rootMargin: ROOT_MARGIN, threshold: 0 },
    );
    for (const section of present) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [present]);

  if (present.length < 2) return null;

  const jump = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    // Keyboard users land in the section, not back on the rail.
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    window.history.replaceState(null, "", `#${id}`);
    setActive(id);
  };

  return (
    <nav
      aria-label={label}
      className={cn(
        "group/minimap fixed right-3 top-1/2 z-[90] hidden -translate-y-1/2 fine:xl:block 2xl:right-5",
        "transition-opacity duration-500",
        active ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {/* The frosted card the names unfold onto; invisible until the rail is hovered. */}
      <span
        aria-hidden
        className="material material-menu pointer-events-none absolute -inset-y-2 -left-3 right-[-6px] origin-right scale-x-95 rounded-2xl opacity-0 transition-[opacity,transform] duration-300 ease-[var(--ease-out-quart)] group-hover/minimap:scale-x-100 group-hover/minimap:opacity-100 group-focus-within/minimap:scale-x-100 group-focus-within/minimap:opacity-100"
      />
      <ol className="relative flex flex-col items-end">
        {present.map((section) => {
          const current = section.id === active;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                onClick={(event) => jump(event, section.id)}
                aria-current={current ? "location" : undefined}
                className="group/tick flex h-7 items-center justify-end gap-3 rounded-full pl-2 outline-offset-0"
              >
                <span
                  className={cn(
                    "max-w-[14rem] truncate text-[12px] font-semibold opacity-0 transition-[opacity,color] duration-300",
                    "group-hover/minimap:opacity-100 group-focus-within/minimap:opacity-100",
                    current ? "text-text" : "text-muted group-hover/tick:text-text",
                  )}
                >
                  {section.label}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    // Length changes are a scale, not a width: no layout per tick.
                    "h-[3px] w-6 origin-right rounded-full transition-[transform,background-color] duration-500 ease-[var(--ease-out-expo)]",
                    current
                      ? "bg-[var(--page-accent)] shadow-[0_0_10px_var(--page-accent)]"
                      : "scale-x-50 bg-fg/25 group-hover/tick:scale-x-[0.7] group-hover/tick:bg-fg/50",
                  )}
                />
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
