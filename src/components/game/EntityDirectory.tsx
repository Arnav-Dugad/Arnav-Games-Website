"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Stagger, StaggerItem } from "@/components/motion/Reveal";
import { hueFromString } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { DirectoryRef } from "@/lib/games/types";
import { isIgdbImage } from "@/lib/games/image";

export function EntityDirectory({
  items,
  kind,
  query,
  order,
  page,
  pageSize,
  count,
  hasNext,
}: {
  items: DirectoryRef[];
  kind: "studio" | "franchise";
  query: string;
  order: "name" | "-name";
  page: number;
  pageSize: number;
  count: number | null;
  hasNext: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(query);
  const [isPending, startTransition] = useTransition();
  const isStudio = kind === "studio";
  const basePath = isStudio ? "/studios" : "/franchises";
  const label = isStudio ? "studio" : "franchise";
  const first = (page - 1) * pageSize + 1;
  const last = first + items.length - 1;

  /*
   * Follow the URL when it changes underneath us.
   *
   * `draft` seeds from `query` once, so a back/forward navigation updated the
   * results while leaving the previous term sitting in the input — the box and
   * the list disagreed about what was being searched.
   *
   * Adjusted during render rather than in an effect, so the input never paints
   * the stale term first.
   */
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setDraft(query);
  }

  useEffect(() => {
    const nextQuery = draft.trim();
    if (nextQuery === query) return;
    const timer = window.setTimeout(() => {
      startTransition(() => {
        router.replace(directoryHref(basePath, nextQuery, order, 1), { scroll: false });
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [basePath, draft, order, query, router]);

  const updateQuery = (value: string) => {
    setDraft(value);
    startTransition(() => {
      router.replace(directoryHref(basePath, value.trim(), order, 1), { scroll: false });
    });
  };

  return (
    <div className="space-y-7" aria-busy={isPending}>
      <div className="glass relative overflow-hidden rounded-3xl p-3 sm:p-4">
        <div aria-hidden className="absolute -right-20 -top-28 h-56 w-56 rounded-full bg-brand/10 blur-3xl" />
        <form
          action={basePath}
          onSubmit={(event) => {
            event.preventDefault();
            updateQuery(draft);
          }}
          className="relative flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <label className="relative block min-w-0 flex-1">
            <Search
              aria-hidden
              size={17}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint"
            />
            <span className="sr-only">Search {isStudio ? "studios" : "franchises"}</span>
            <input
              type="search"
              name="q"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={isStudio ? "Search every studio…" : "Search every franchise…"}
              className="h-12 w-full rounded-xl border border-line bg-bg/55 py-2 pl-11 pr-11 text-sm text-text outline-none transition-colors placeholder:text-faint hover:border-line-strong focus:border-brand"
            />
            {draft && (
              <button
                type="button"
                onClick={() => updateQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-faint transition-colors hover:bg-white/[0.06] hover:text-text"
              >
                <X size={15} />
              </button>
            )}
          </label>

          <label className="relative shrink-0">
            <span className="sr-only">Sort directory</span>
            <SlidersHorizontal aria-hidden size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <ChevronDown aria-hidden size={14} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <select
              name="sort"
              value={order}
              onChange={(event) => {
                const nextOrder = event.target.value === "-name" ? "-name" : "name";
                startTransition(() => {
                  router.replace(directoryHref(basePath, draft.trim(), nextOrder, 1), { scroll: false });
                });
              }}
              className="h-12 min-w-40 appearance-none rounded-xl border border-line bg-bg/55 pl-10 pr-9 text-sm font-medium text-text outline-none transition-colors hover:border-line-strong focus:border-brand"
            >
              <option value="name">Name: A–Z</option>
              <option value="-name">Name: Z–A</option>
            </select>
          </label>
        </form>

        <div className="relative mt-3 flex min-h-7 flex-wrap items-center justify-between gap-2 px-2 text-xs text-muted">
          <p aria-live="polite">
            {count !== null ? (
              <>
                Showing <span className="font-semibold tabular-nums text-text">{items.length > 0 ? `${first}–${last}` : "0"}</span> of{" "}
                <span className="font-semibold tabular-nums text-text">{count.toLocaleString()}</span> {count === 1 ? label : isStudio ? "studios" : "franchises"}
              </>
            ) : (
              <>
                Page <span className="font-semibold tabular-nums text-text">{page}</span>
                {query && <> for “<span className="text-text">{query}</span>”</>}
              </>
            )}
          </p>
          <span className={cn("inline-flex items-center gap-1.5 text-brand-soft transition-opacity", isPending ? "opacity-100" : "opacity-0")}>
            <LoaderCircle size={13} className="animate-spin" /> Updating
          </span>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={isStudio ? <Building2 size={24} /> : <Layers size={24} />}
          title={`No ${isStudio ? "studios" : "franchises"} found`}
          body={query ? `Nothing matches “${query}”. Try a shorter name or different spelling.` : "There are no entries on this page."}
          action={
            query
              ? { onClick: () => updateQuery(""), label: "Clear search" }
              : page > 1
                ? { href: directoryHref(basePath, query, order, page - 1), label: "Previous page" }
                : undefined
          }
        />
      ) : (
        <Stagger
          className={
            isStudio
              ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
              : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          }
          gap={0.025}
          onMount
        >
          {items.map((item, index) => (
            <StaggerItem key={item.id}>
              {isStudio ? (
                <StudioCard studio={item} priority={index < 12} />
              ) : (
                <FranchiseCard franchise={item} index={index} />
              )}
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <nav
        aria-label={`${isStudio ? "Studio" : "Franchise"} directory pages`}
        className="flex items-center justify-between gap-3 border-t border-line pt-5"
      >
        {page > 1 ? (
          <Link
            href={directoryHref(basePath, query, order, page - 1)}
            scroll={false}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white/[0.03] px-4 text-sm font-semibold text-muted transition-colors hover:border-line-strong hover:text-text"
          >
            <ChevronLeft size={16} /> Previous
          </Link>
        ) : (
          <span />
        )}
        <span className="text-xs font-medium text-faint">
          Page {page}{count !== null ? ` of ${Math.max(1, Math.ceil(count / pageSize))}` : ""}
        </span>
        {hasNext ? (
          <Link
            href={directoryHref(basePath, query, order, page + 1)}
            scroll={false}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-[#090910] transition-transform hover:-translate-y-0.5"
          >
            Next <ChevronRight size={16} />
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}

function directoryHref(basePath: string, query: string, order: "name" | "-name", page: number) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (order === "-name") params.set("sort", "desc");
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

function StudioCard({ studio, priority }: { studio: DirectoryRef; priority: boolean }) {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <Link
      href={`/studio/${studio.slug}`}
      className="group flex h-full min-h-36 flex-col items-center gap-3 rounded-2xl border border-line bg-panel/40 p-4 text-center transition-all duration-300 fine:hover:-translate-y-1 fine:hover:border-line-strong fine:hover:bg-panel/70 fine:hover:shadow-[0_22px_55px_-30px_rgba(124,92,255,0.7)]"
    >
      {studio.logo && !logoFailed ? (
        <span className="relative grid h-16 w-full place-items-center overflow-hidden rounded-xl bg-white/[0.94] p-2 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
          <Image
            src={studio.logo}
            alt=""
            fill
            priority={priority}
            unoptimized={isIgdbImage(studio.logo)}
            sizes="(max-width: 640px) 42vw, 180px"
            onError={() => setLogoFailed(true)}
            className="object-contain p-2.5 transition-transform duration-500 fine:group-hover:scale-105"
          />
        </span>
      ) : (
        <span className="grid h-16 w-full place-items-center rounded-xl bg-white/[0.04] font-display text-xl font-black text-muted">
          {studio.name.charAt(0)}
        </span>
      )}
      <span className="line-clamp-2 text-[13px] font-semibold leading-snug transition-colors group-hover:text-brand-soft">
        {studio.name}
      </span>
      <span className="text-[10px] font-medium uppercase tracking-[0.07em] text-faint">
        {studio.gameCount.toLocaleString()} {studio.gameCount === 1 ? "game" : "games"}
      </span>
    </Link>
  );
}

function FranchiseCard({ franchise, index }: { franchise: DirectoryRef; index: number }) {
  const hue = hueFromString(franchise.slug);

  return (
    <Link
      href={`/franchise/${franchise.slug}`}
      className="group relative flex h-32 items-end overflow-hidden rounded-2xl border border-line p-4 transition-all duration-500 fine:hover:-translate-y-1 fine:hover:border-line-strong fine:hover:shadow-[0_25px_60px_-32px_rgba(124,92,255,0.8)]"
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 58% 21%), hsl(${(hue + 45) % 360} 52% 8%))`,
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0 opacity-60 transition-opacity duration-500 fine:group-hover:opacity-100"
        style={{
          background: `radial-gradient(90% 90% at 20% 0%, hsl(${hue} 90% 64% / 0.42), transparent 68%)`,
        }}
      />
      <span aria-hidden className="absolute -right-2 -top-6 font-display text-8xl font-black text-white/[0.055]">
        {franchise.name.charAt(0)}
      </span>
      <span className="relative">
        <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.07em] text-white/50">
          Franchise {String(index + 1).padStart(2, "0")}
        </span>
        <span className="line-clamp-2 font-display text-[15px] font-bold leading-tight text-white transition-colors group-hover:text-white">
          {franchise.name}
        </span>
        <span className="mt-2 block text-[10px] font-medium uppercase tracking-[0.07em] text-white/45">
          {franchise.gameCount.toLocaleString()} {franchise.gameCount === 1 ? "game" : "games"}
        </span>
      </span>
    </Link>
  );
}
