"use client";

/**
 * Disclosure section that starts closed.
 *
 * For content that matters to a minority of readers but is bulky enough to
 * push everything else off the page — system requirements being the canonical
 * case. Animates to a measured height rather than a guessed `max-height`, so
 * the easing is linear in perceived distance instead of racing through empty
 * space and then stalling.
 */

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function Collapsible({
  title,
  subtitle,
  icon,
  children,
  defaultOpen = false,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [height, setHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const measure = useCallback(() => {
    if (contentRef.current) setHeight(contentRef.current.scrollHeight);
  }, []);

  useEffect(() => {
    measure();
    const el = contentRef.current;
    if (!el) return;
    // Requirement text reflows with viewport width, so the target height has
    // to be re-measured rather than captured once.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-panel/40", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-fg/[0.03] sm:px-5"
      >
        {icon && <span className="shrink-0 text-faint">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{title}</span>
          {subtitle && <span className="mt-0.5 block text-xs text-muted">{subtitle}</span>}
        </span>
        <ChevronDown
          size={17}
          className={cn(
            "shrink-0 text-faint transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
            open && "rotate-180",
          )}
        />
      </button>

      <motion.div
        initial={false}
        animate={{ height: open ? height : 0, opacity: open ? 1 : 0 }}
        transition={reduced ? { duration: 0 } : { duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="overflow-hidden"
        // Keeps collapsed content out of the tab order and off screen readers.
        aria-hidden={!open}
      >
        <div ref={contentRef} className="border-t border-line px-4 py-4 sm:px-5">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
