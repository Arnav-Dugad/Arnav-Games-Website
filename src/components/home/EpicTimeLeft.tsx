"use client";

import { useEffect, useState } from "react";

/** "3 days left" / "5 h left" / "40 min left" to a promotion's end. */
function left(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h left`;
  return `${Math.floor(hours / 24)} days left`;
}

/**
 * Time left on an Epic promotion. Rendered after mount (clocks differ between
 * server and reader) and refreshed each minute; a promotion that ends while
 * the page is open says so rather than counting below zero.
 */
export function EpicTimeLeft({ end }: { end: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setNow(Date.now()));
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);
  const endMs = Date.parse(end);
  if (now === null || Number.isNaN(endMs)) return null;
  const ms = endMs - now;
  return (
    <time dateTime={end} className={ms < 24 * 3_600_000 ? "font-semibold text-[#ffd60a]" : "font-medium text-white"}>
      {ms <= 0 ? "Ended" : left(ms)}
    </time>
  );
}
