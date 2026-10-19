import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import type { EpicFreeGame } from "@/lib/games/types";
import { EpicTimeLeft } from "./EpicTimeLeft";

/**
 * Epic's free games as wide art cards — server-rendered, with only the
 * time-left label running in the browser (it changes by the minute; a
 * server-rendered figure would be stale on arrival).
 *
 * Each card has one action, "Get on Epic" (claiming happens there); when the
 * promotion matches a game we know, its title opens our page. Next week's
 * games follow as smaller teasers. Prices are Epic's own local price for the
 * visitor's country, shown struck through, as Epic does.
 */
export function EpicFree({ current, upcoming }: { current: EpicFreeGame[]; upcoming: EpicFreeGame[] }) {
  return (
    <ul className="snap-rail rail-gutter relative -my-3 items-start gap-3 py-3 sm:gap-4">
      {current.map((item) => (
        <li key={item.id} className="w-[84vw] max-w-[420px] sm:w-[400px]">
          <FreeCard item={item} />
        </li>
      ))}
      {upcoming.map((item) => (
        <li key={item.id} className="w-[58vw] max-w-[260px] sm:w-[240px]">
          <NextCard item={item} />
        </li>
      ))}
    </ul>
  );
}

function Art({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  if (!src) return <span className={`block bg-panel-2 ${className ?? ""}`} />;
  return (
    // Epic's CDN art, shown as served: next/image is unoptimised on this site
    // anyway, and Epic's host isn't one of the configured media origins.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" decoding="async" className={`block object-cover ${className ?? ""}`} />
  );
}

function FreeCard({ item }: { item: EpicFreeGame }) {
  const title = item.game ? (
    <Link prefetch={false} href={`/game/${item.game.slug}`} className="line-clamp-2 fine:hover:underline">
      {item.title}
    </Link>
  ) : (
    <span className="line-clamp-2">{item.title}</span>
  );
  return (
    <article data-stage="dark" className="relative isolate flex h-full flex-col overflow-hidden rounded-[22px] bg-[#121214] text-white shadow-[0_18px_40px_-26px_#000]">
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        <Art src={item.imageWide ?? item.image} alt="" className="h-full w-full" />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#121214] to-transparent" />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md">
          <BrandIcon name="epic" size={12} title={null} />
          Free now
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-1">
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold leading-tight tracking-[-0.01em]">{title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-white/70">
            {item.originalPrice && <s className="tabular-nums">{item.originalPrice}</s>}
            <EpicTimeLeft end={item.end} />
          </p>
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="press mt-auto inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full bg-white px-4 text-[14px] font-semibold text-black transition-colors fine:hover:bg-white/85"
        >
          Get on Epic
          <ArrowUpRight size={15} aria-hidden />
        </a>
      </div>
    </article>
  );
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

function NextCard({ item }: { item: EpicFreeGame }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="press group flex h-full flex-col overflow-hidden rounded-[22px] border border-line bg-panel transition-colors fine:hover:border-line-strong"
    >
      <span className="relative block aspect-[16/9] overflow-hidden">
        <Art src={item.imageWide ?? item.image} alt="" className="h-full w-full opacity-80 grayscale-[35%] transition-[filter,opacity] duration-500 fine:group-hover:opacity-100 fine:group-hover:grayscale-0" />
      </span>
      <span className="flex flex-1 flex-col p-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
          Next · <time dateTime={item.start}>{DAY.format(new Date(item.start))}</time>
        </span>
        <span className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug text-text">{item.title}</span>
      </span>
    </a>
  );
}
