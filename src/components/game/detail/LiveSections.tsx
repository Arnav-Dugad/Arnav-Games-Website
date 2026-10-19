"use client";

/**
 * The page's two live sections: the latest Steam news, and who is streaming
 * the game right now. Both are optional in the strongest sense — with nothing
 * to show, the section (heading included) doesn't render at all.
 */

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Newspaper } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCalmMotion } from "@/components/interactions/motion-prefs";
import { compactNumber, formatDate } from "@/lib/utils/format";
import { DetailHeading } from "./DetailSection";
import { useLiveField } from "./live";

export function LatestNews({ expected }: { expected: boolean }) {
  const news = useLiveField((live) => live.news);
  const calm = useCalmMotion();
  if (news.state === "empty" || (news.state === "loading" && !expected)) return null;

  return (
    <section id="news" aria-labelledby="news-title" className="scroll-mt-36">
      <DetailHeading titleId="news-title" eyebrow="From the developers" icon={<Newspaper size={14} />} title="Latest news" />
      <ul className="mt-5 grid gap-3 sm:mt-6 sm:grid-cols-2">
        <AnimatePresence initial={false}>
          {news.state === "loading"
            ? Array.from({ length: 4 }, (_, index) => (
                <li key={`skeleton-${index}`} aria-hidden className="glass rounded-3xl p-5">
                  <Skeleton className="h-3 w-24 rounded-full" />
                  <Skeleton className="mt-3 h-5 w-4/5 rounded-full" />
                  <Skeleton className="mt-3 h-3 w-full rounded-full" />
                  <Skeleton className="mt-2 h-3 w-3/4 rounded-full" />
                </li>
              ))
            : news.value.slice(0, 4).map((item, index) => (
                <motion.li
                  key={item.url}
                  initial={calm ? false : { opacity: 0, y: 8, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.45, delay: calm ? 0 : index * 0.05, ease: [0.16, 1, 0.3, 1] }}
                >
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="glass group flex h-full flex-col rounded-3xl p-5 transition-transform duration-500 fine:hover:-translate-y-0.5"
                  >
                    <p className="flex items-center gap-2 text-[11px] text-faint">
                      <time dateTime={item.date}>{formatDate(item.date.slice(0, 10))}</time>
                      {item.source && <span className="truncate">· {item.source}</span>}
                    </p>
                    <h3 className="mt-2 line-clamp-2 text-base font-bold leading-snug text-text">{item.title}</h3>
                    {item.excerpt && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{item.excerpt}</p>}
                    <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-semibold text-[var(--game-accent)]">
                      Read on Steam <ArrowUpRight size={13} className="transition-transform duration-300 fine:group-hover:-translate-y-0.5 fine:group-hover:translate-x-0.5" />
                    </span>
                  </a>
                </motion.li>
              ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

/**
 * "Live now": a rail of the top streams. Only shown once there are more than
 * the three the bento's Twitch tile already previews — otherwise it would just
 * repeat that tile at a bigger size.
 */
export function LiveNowStrip() {
  const twitch = useLiveField((live) => (live.twitch && live.twitch.top.length > 3 ? live.twitch : null));
  if (twitch.state !== "ready") return null;

  return (
    <section aria-labelledby="live-now" className="min-w-0">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 id="live-now" className="flex items-center gap-2.5 text-[20px] font-bold tracking-[-0.02em] sm:text-[22px]">
          <span aria-hidden className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-flare/70 [animation-duration:1.8s]" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-flare" />
          </span>
          Live now
        </h2>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <BrandIcon name="twitch" size={12} title={null} tinted /> {compactNumber(twitch.value.viewers)} watching
        </p>
      </div>
      <ul className="snap-rail -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
        {twitch.value.top.map((stream) => (
          <li key={stream.url} className="w-[240px] sm:w-[260px]">
            <a href={stream.url} target="_blank" rel="noopener noreferrer" className="group block">
              <span className="relative block aspect-video overflow-hidden rounded-2xl bg-fg/[0.06]">
                {/* eslint-disable-next-line @next/next/no-img-element -- Twitch's preview CDN isn't a configured image host and these refresh every few minutes. */}
                <img src={stream.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-700 fine:group-hover:scale-105" />
                <span className="absolute left-2 top-2 rounded-md bg-[#d70015] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-white">Live</span>
                <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
                  {compactNumber(stream.viewers)} viewers
                </span>
              </span>
              <span className="mt-2 block truncate text-sm font-semibold text-text">{stream.user}</span>
              <span className="block truncate text-xs text-muted">{stream.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
