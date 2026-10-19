import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "neutral" | "brand" | "neon" | "gold" | "mint" | "flare";

const TONES: Record<Tone, string> = {
  neutral: "bg-white/[0.06] text-muted border-line",
  brand: "bg-brand/15 text-brand-soft border-brand/25",
  neon: "bg-neon/12 text-neon border-neon/25",
  gold: "bg-gold/12 text-gold border-gold/25",
  mint: "bg-mint/12 text-mint border-mint/25",
  flare: "bg-flare/12 text-flare border-flare/25",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none tracking-[0.01em]",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Interactive pill used for genre/platform filters and tag links. */
export function Chip({
  children,
  href,
  active,
  onClick,
  className,
}: {
  children: ReactNode;
  href?: string;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const classes = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium leading-none",
    "press min-h-9 coarse:min-h-11 coarse:px-4 transition-colors duration-200",
    active
      ? "border-brand/50 bg-brand/25 text-white shadow-[inset_0_1px_0_#ffffff1f]"
      : "border-white/[0.09] bg-white/[0.06] text-muted fine:hover:bg-white/[0.1] fine:hover:text-text",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes} aria-pressed={active}>
      {children}
    </button>
  );
}
