import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * Wordmark. The tile carries a sheen that sweeps up on hover and "Games"
 * picks up the brand gradient, so the mark reacts without any layout shift.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Arnav Games — home"
      className={cn("group inline-flex items-center gap-2.5", className)}
    >
      <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-[linear-gradient(135deg,var(--color-brand),var(--color-neon))] shadow-[0_6px_20px_-6px_rgba(124,92,255,0.7)] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-rotate-6 group-hover:scale-105">
        <svg viewBox="0 0 64 64" aria-hidden className="h-[22px] w-[22px]">
          <path d="M27.6 15h8.8L49 49h-8.3l-2.6-7.4H25.9L23.3 49H15zm-.1 19.9h9L32 21.6z" fill="#fff" />
        </svg>
        <span
          aria-hidden
          className="absolute inset-0 translate-y-full bg-white/25 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-y-0"
        />
      </span>

      {!compact && (
        <span className="whitespace-nowrap font-display text-[17px] font-extrabold tracking-[0.005em] text-text">
          Arnav{" "}
          <span className="bg-[linear-gradient(90deg,var(--color-brand-soft),var(--color-neon))] bg-clip-text text-transparent">
            Games
          </span>
        </span>
      )}
    </Link>
  );
}
