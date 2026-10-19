"use client";

/**
 * The studio and franchise directories' controls: a search well, an A–Z
 * jump rail and the result count, around a server-rendered grid.
 *
 * Three ways in, all in the URL: the default "Popular" view (the names
 * behind games people are playing now), a letter, or a search. Alphabetical
 * order alone opened on "00087" and "$1,000,000 Kid" — technically first,
 * useful to nobody — so A–Z is something you jump into, not where you land.
 *
 * The grid is passed in as children so cards with art stay server-rendered;
 * this component only owns what changes on input, and dims the grid while
 * the next answer is on its way.
 */

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { SearchField } from "@/components/filters";
import { Pagination } from "@/components/ui/Pagination";
import { cn } from "@/lib/utils/cn";
import { isIgdbImage } from "@/lib/games/image";

const LETTERS = ["0", ..."abcdefghijklmnopqrstuvwxyz"];

export function EntityDirectory({
  kind,
  query,
  letter,
  count,
  page,
  totalPages,
  hasNext,
  children,
}: {
  kind: "studio" | "franchise";
  query: string;
  letter: string | null;
  /** Exact total for the current mode; null when unknown or not meaningful. */
  count: number | null;
  page: number;
  totalPages?: number;
  hasNext: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(query);
  const basePath = kind === "studio" ? "/studios" : "/franchises";
  const plural = kind === "studio" ? "studios" : "franchises";

  /*
   * Follow the URL when it changes underneath us (back/forward, a letter
   * tap). Adjusted during render rather than in an effect, so the input
   * never paints the stale term first.
   */
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    if (draft.trim() !== query) setDraft(query);
  }

  const go = (href: string, replace = false) =>
    startTransition(() => {
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });

  // Typing settles for a moment, then replaces (not pushes) the URL so the
  // back button isn't a keystroke log.
  useEffect(() => {
    const term = draft.trim();
    if (term === query) return;
    const timer = window.setTimeout(() => go(directoryHref(basePath, { query: term }), true), 400);
    return () => window.clearTimeout(timer);
    // `go` is recreated each render; the inputs that matter are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, query, basePath]);

  const mode = query ? "search" : letter ? "letter" : "popular";

  // Arriving on "?letter=t" (a shared link, back/forward) should show "T"
  // in the rail, not leave it scrolled off a phone's edge. Scrolls only the
  // rail, never the page.
  const railRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const rail = railRef.current;
    const current = rail?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!rail || !current || rail.scrollWidth <= rail.clientWidth) return;
    rail.scrollLeft = current.offsetLeft - rail.clientWidth / 2 + current.offsetWidth / 2;
  }, [letter]);

  return (
    <div className="space-y-4">
      <form
        action={basePath}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          go(directoryHref(basePath, { query: draft.trim() }));
          (document.activeElement as HTMLElement | null)?.blur();
        }}
        className="sm:max-w-xl"
      >
        <SearchField
          name="q"
          value={draft}
          onChange={setDraft}
          placeholder={kind === "studio" ? "Search studios" : "Search franchises"}
          label={`Search ${plural}`}
          className="[&_input]:h-12 [&_input]:text-base"
        />
      </form>

      <nav
        ref={railRef}
        aria-label={`Jump to ${plural} by letter`}
        // Bleeds to the screen edge on phones so the rail visibly continues.
        className="no-scrollbar relative -mx-4 flex gap-1 overflow-x-auto px-4 py-0.5 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        <JumpLink
          href={basePath}
          active={mode === "popular"}
          onNavigate={go}
          className="px-3.5"
        >
          Popular
        </JumpLink>
        {LETTERS.map((value) => (
          <JumpLink
            key={value}
            href={directoryHref(basePath, { letter: value })}
            active={mode === "letter" && letter === value}
            onNavigate={go}
            label={value === "0" ? "Numbers" : value.toUpperCase()}
            className="w-11 fine:w-9"
          >
            {value === "0" ? "#" : value.toUpperCase()}
          </JumpLink>
        ))}
      </nav>

      <p aria-live="polite" className="flex min-h-5 items-center gap-2 px-1 text-[13px] text-muted">
        {mode === "popular" ? (
          "Popular right now"
        ) : count !== null ? (
          <span>
            <span className="font-semibold tabular-nums text-text">{count.toLocaleString("en-US")}</span>{" "}
            {count === 1 ? kind : plural}
            {mode === "letter" && letter && <> starting with {letter === "0" ? "a number" : letter.toUpperCase()}</>}
          </span>
        ) : null}
      </p>

      <div
        aria-busy={pending}
        className={cn("pt-2 transition-opacity duration-300", pending && "opacity-50 delay-150")}
      >
        {children}
      </div>

      {mode !== "popular" && (
        <Pagination
          page={page}
          hasNext={hasNext}
          totalPages={totalPages}
          basePath={basePath}
          params={{ q: query || undefined, letter: query ? undefined : letter ?? undefined }}
        />
      )}
    </div>
  );
}

function JumpLink({
  href,
  active,
  onNavigate,
  label,
  className,
  children,
}: {
  href: string;
  active: boolean;
  onNavigate: (href: string) => void;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      // 27 links in view would otherwise prefetch 27 directory renders.
      prefetch={false}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        // New-tab and modified clicks keep their browser meaning.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onNavigate(href);
      }}
      className={cn(
        "press inline-flex h-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold tabular-nums transition-colors coarse:h-11",
        active ? "bg-text text-bg" : "text-muted fine:hover:bg-fg/[0.08] fine:hover:text-text",
        className,
      )}
    >
      {children}
    </Link>
  );
}

function directoryHref(basePath: string, { query, letter }: { query?: string; letter?: string }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  else if (letter) params.set("letter", letter);
  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

/** A studio as its logo on a light plate (marks are drawn for paper). */
export function StudioCard({
  slug,
  name,
  logo,
  gameCount,
  priority = false,
}: {
  slug: string;
  name: string;
  logo?: string | null;
  gameCount: number | null;
  priority?: boolean;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <Link
      href={`/studio/${slug}`}
      className="press group flex h-full flex-col gap-2.5 rounded-2xl p-1.5 text-left transition-colors fine:hover:bg-fg/[0.04]"
    >
      <span className="relative grid aspect-[16/10] w-full place-items-center overflow-hidden rounded-xl bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] light:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.05)]">
        {logo && !logoFailed ? (
          <Image
            src={logo}
            alt=""
            fill
            priority={priority}
            unoptimized={isIgdbImage(logo)}
            sizes="(max-width: 640px) 45vw, 220px"
            onError={() => setLogoFailed(true)}
            className="object-contain p-[14%] transition-transform duration-500 ease-[var(--ease-apple)] fine:group-hover:scale-105"
          />
        ) : (
          <span aria-hidden className="font-display text-3xl font-black text-black/30">
            {name.charAt(0)}
          </span>
        )}
      </span>
      <span className="min-w-0 px-1 pb-1">
        <span className="line-clamp-2 text-[15px] font-semibold leading-snug">{name}</span>
        {gameCount !== null && (
          <span className="mt-0.5 block text-[13px] tabular-nums text-muted">
            {gameCount.toLocaleString("en-US")} {gameCount === 1 ? "game" : "games"}
          </span>
        )}
      </span>
    </Link>
  );
}
