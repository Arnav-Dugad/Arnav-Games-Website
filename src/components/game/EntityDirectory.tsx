"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Layers,
  LoaderCircle,
} from "lucide-react";
import { SearchField, SortMenu } from "@/components/filters";
import { EmptyState } from "@/components/ui/EmptyState";
import { Stagger, StaggerItem } from "@/components/motion/Reveal";
import { hueFromString } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { DirectoryRef } from "@/lib/games/types";
import { isIgdbImage } from "@/lib/games/image";

const DIRECTORY_SORTS: { value: "name" | "-name"; label: string }[] = [
  { value: "name", label: "Name A–Z" },
  { value: "-name", label: "Name Z–A" },
];

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
      {/* Collapsed toolbar: a search well and a sort menu, nothing else. */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <form
            action={basePath}
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              updateQuery(draft);
            }}
            className="min-w-0 flex-1 sm:max-w-md"
          >
            <SearchField
              name="q"
              value={draft}
              onChange={(value) => (value ? setDraft(value) : updateQuery(""))}
              placeholder={isStudio ? "Search every studio" : "Search every franchise"}
              label={`Search ${isStudio ? "studios" : "franchises"}`}
            />
          </form>
          <div className="ml-auto shrink-0">
            <SortMenu
              options={DIRECTORY_SORTS}
              value={order}
              label={`Sort ${isStudio ? "studios" : "franchises"}`}
              onChange={(nextOrder) => {
                startTransition(() => {
                  router.replace(directoryHref(basePath, draft.trim(), nextOrder, 1), { scroll: false });
                });
              }}
            />
          </div>
        </div>

        <div className="flex min-h-6 items-center gap-2 px-1 text-[13px] text-muted">
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
          <LoaderCircle
            aria-hidden
            size={13}
            className={cn("shrink-0 animate-spin text-faint transition-opacity", isPending ? "opacity-100" : "opacity-0")}
          />
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
            className="press inline-flex min-h-11 items-center gap-2 rounded-full border border-fg/10 bg-fg/[0.06] px-4 text-sm font-semibold text-text transition-colors fine:hover:bg-fg/[0.1]"
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
            className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_#ffffff40] transition-[filter] fine:hover:brightness-110"
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
        <span className="grid h-16 w-full place-items-center rounded-xl bg-fg/[0.04] font-display text-xl font-black text-muted">
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
      className="hue-tile group relative flex h-32 items-end overflow-hidden rounded-2xl border border-line p-4 transition-all duration-500 fine:hover:-translate-y-1 fine:hover:border-line-strong fine:hover:shadow-[0_25px_60px_-32px_rgba(124,92,255,0.8)]"
      style={{ "--tile-hue": hue, "--tile-hue-2": (hue + 45) % 360 } as CSSProperties}
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
        <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.07em] text-white/65">
          Franchise {String(index + 1).padStart(2, "0")}
        </span>
        <span className="line-clamp-2 font-display text-[15px] font-bold leading-tight text-white">
          {franchise.name}
        </span>
        <span className="mt-2 block text-[10px] font-medium uppercase tracking-[0.07em] text-white/60">
          {franchise.gameCount.toLocaleString()} {franchise.gameCount === 1 ? "game" : "games"}
        </span>
      </span>
    </Link>
  );
}
