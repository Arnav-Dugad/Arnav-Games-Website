"use client";

/**
 * "Live on Twitch", part of the Watch section: how many people are watching
 * right now and a rail of the top streams. One block where there used to be
 * two (a bento tile previewing three streams, then a "Live now" rail
 * repeating them bigger). With nobody streaming it doesn't render at all.
 */

import { BrandIcon } from "@/components/brand/BrandIcon";
import { compactNumber } from "@/lib/utils/format";
import { DetailHeading } from "./DetailSection";
import { InfoTip } from "./InfoTip";
import { useLiveField } from "./live";

export function LiveOnTwitch({ standalone = false }: { standalone?: boolean }) {
  const twitch = useLiveField((live) => (live.twitch && live.twitch.streams > 0 && live.twitch.top.length > 0 ? live.twitch : null));
  if (twitch.state !== "ready") return null;
  const { viewers, streams, top } = twitch.value;

  const body = (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-2.5 text-[17px] font-semibold text-text">
          <span aria-hidden className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-flare/70 [animation-duration:1.8s] motion-reduce:animate-none" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-flare" />
          </span>
          Live on Twitch
        </h3>
        <p className="flex items-center gap-1.5 text-[13px] tabular-nums text-muted">
          <BrandIcon name="twitch" size={12} title={null} tinted />
          {compactNumber(viewers)} watching · {compactNumber(streams)} {streams === 1 ? "stream" : "streams"}
          <InfoTip topic="twitch" />
        </p>
      </div>
      {/* `scroll-px-4` matches the inset, so the first stream doesn't snap flush to the screen edge. */}
      <ul className="snap-rail -mx-4 flex scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:scroll-px-0 lg:px-0">
        {/* Twitch can list one channel twice (a restream), so the index joins the key. */}
        {top.map((stream, index) => (
          <li key={`${stream.url}-${index}`} className="w-[240px] shrink-0 sm:w-[260px]">
            <a href={stream.url} target="_blank" rel="noopener noreferrer" className="group block">
              <span className="relative block aspect-video overflow-hidden rounded-2xl bg-fg/[0.06]">
                {/* eslint-disable-next-line @next/next/no-img-element -- Twitch's preview CDN isn't a configured image host and these refresh every few minutes. */}
                <img src={stream.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-700 fine:group-hover:scale-105" />
                <span className="absolute left-2 top-2 rounded-md bg-[#d70015] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-white">Live</span>
                {/* The broadcast language: a German stream shouldn't surprise someone who taps it. */}
                {stream.language && stream.language !== "en" && (
                  <span className="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-white">
                    <span className="sr-only">Language: </span>
                    {stream.language}
                  </span>
                )}
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
    </div>
  );

  // Without trailers or screenshots there's no server-rendered Watch section
  // to sit in, so the block brings its own heading.
  if (!standalone) return body;
  return (
    <section id="watch" aria-labelledby="watch-title" className="min-w-0 scroll-mt-36">
      <DetailHeading titleId="watch-title" title="Watch" />
      <div className="mt-5 sm:mt-6">{body}</div>
    </section>
  );
}
