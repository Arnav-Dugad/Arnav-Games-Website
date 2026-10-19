"use client";

/**
 * The inline search field used above filterable collections. A rounded,
 * borderless "search bar" in the iOS sense — a filled well rather than an
 * outlined input — so it reads as part of the toolbar, not a form.
 */

import { Search, X } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils/cn";

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  name,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  name?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search
        aria-hidden
        size={16}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
      />
      <input
        ref={inputRef}
        type="search"
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        // 16px on touch so iOS doesn't zoom the page on focus.
        className="h-11 w-full rounded-full border border-fg/[0.08] bg-fg/[0.06] pl-10 pr-10 text-[14px] text-text outline-none transition-colors placeholder:text-faint hover:bg-fg/[0.08] focus:border-brand/50 focus:bg-fg/[0.09] coarse:text-base [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:bg-fg/10 hover:text-text"
        >
          <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-fg/25 text-bg">
            <X size={11} strokeWidth={3} />
          </span>
        </button>
      )}
    </div>
  );
}
