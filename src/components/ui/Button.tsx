"use client";

/**
 * Button / link primitive.
 *
 * Renders an `<a>` when given `href` and a `<button>` otherwise, so navigation
 * stays real navigation (middle-click, open-in-new-tab, prefetch) instead of an
 * onClick handler pretending to be a link.
 *
 * Props are declared explicitly rather than extending `ButtonHTMLAttributes`.
 * The surface is small and known, and an explicit list removes the need to
 * strip custom props back out before spreading them onto a DOM node.
 *
 * Hit targets are never smaller than 44px on coarse pointers — the `sm` size
 * shrinks on desktop only.
 */

import Link from "next/link";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white shadow-[inset_0_1px_0_#ffffff40,0_10px_30px_-10px_rgba(138,114,255,0.75)] fine:hover:brightness-110",
  secondary:
    "material-thin text-text fine:hover:bg-fg/[0.14]",
  ghost: "text-muted hover:text-text hover:bg-fg/[0.07]",
  outline: "border border-fg/20 text-text hover:bg-fg/[0.07]",
  danger: "bg-flare/15 text-flare border border-flare/30 hover:bg-flare/25",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "text-[13px] px-4 py-2.5 gap-1.5 coarse:min-h-11 fine:py-2",
  md: "text-[15px] px-5 py-3 gap-2 min-h-11",
  lg: "text-[17px] px-7 py-4 gap-2.5 min-h-14",
};

export interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Leading icon. Replaced by a spinner while `loading`. */
  icon?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  "aria-label"?: string;
  /** Renders an anchor instead of a button. */
  href?: string;
  /** Opens in a new tab with the appropriate rel. Requires `href`. */
  external?: boolean;
  prefetch?: boolean;
  /** Button-only. Ignored when `href` is set. */
  type?: "button" | "submit" | "reset";
}

const BASE =
  "relative inline-flex items-center justify-center rounded-full font-semibold tracking-[-0.01em] " +
  "transition-[background-color,border-color,color,transform,box-shadow,filter] duration-300 ease-[var(--ease-apple)] " +
  "active:scale-[0.96] active:duration-100 disabled:pointer-events-none disabled:opacity-50 select-none whitespace-nowrap";

export const Button = forwardRef<HTMLButtonElement & HTMLAnchorElement, ButtonProps>(
  function Button(
    {
      children,
      variant = "primary",
      size = "md",
      className,
      icon,
      iconRight,
      fullWidth,
      loading,
      disabled,
      onClick,
      title,
      href,
      external,
      prefetch,
      type = "button",
      "aria-label": ariaLabel,
    },
    ref,
  ) {
    const classes = cn(
      BASE,
      VARIANTS[variant],
      SIZES[size],
      fullWidth && "w-full",
      (loading || disabled) && "pointer-events-none opacity-60",
      className,
    );

    const content = (
      <>
        {loading ? (
          <span
            aria-hidden
            className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : (
          icon
        )}
        <span>{children}</span>
        {iconRight}
      </>
    );

    if (href !== undefined) {
      if (external) {
        return (
          <a
            ref={ref}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={classes}
            onClick={onClick}
            title={title}
            aria-label={ariaLabel}
          >
            {content}
          </a>
        );
      }
      return (
        <Link
          ref={ref}
          href={href}
          prefetch={prefetch}
          className={classes}
          onClick={onClick}
          title={title}
          aria-label={ariaLabel}
        >
          {content}
        </Link>
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        className={classes}
        onClick={onClick}
        disabled={disabled || loading}
        title={title}
        aria-label={ariaLabel}
        aria-busy={loading || undefined}
      >
        {content}
      </button>
    );
  },
);
