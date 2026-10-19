import { ArrowRight, CalendarClock, History, MapPin } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { isDelay } from "@/lib/games/release-value";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";
import type { ReleaseChange, ReleaseEvent } from "@/lib/games/types";
import { groupReleases, releaseValueLabel, shortPlatform, slipDays } from "./release";

/**
 * Regional release dates and the record of how the date has moved.
 *
 * The reader's region (from Cloudflare's country header) is highlighted, since
 * "when can *I* play it" is the question this table exists to answer.
 */
export function ReleaseDates({
  releases,
  changes,
  visitorRegion,
  countryName,
}: {
  releases: ReleaseEvent[];
  changes: ReleaseChange[];
  visitorRegion: string | null;
  countryName: string | null;
}) {
  const groups = groupReleases(releases);
  const showTable = releases.length > 1;
  if (!showTable && changes.length === 0) return null;

  return (
    <section id="release-dates" className="scroll-mt-32 space-y-6">
      <Reveal>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--game-accent)]">
          <CalendarClock size={13} /> Release dates
        </p>
        <h2 className="text-3xl font-black sm:text-4xl">When it lands, where</h2>
        {visitorRegion && countryName && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-muted">
            <MapPin size={14} className="text-[var(--game-accent)]" />
            Showing {countryName} under <strong className="font-semibold text-text">{visitorRegion}</strong>
          </p>
        )}
      </Reveal>

      {showTable && (
        <Reveal className="overflow-hidden rounded-3xl border border-line bg-panel/40">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Release dates by region and platform</caption>
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold sm:px-5">Region</th>
                <th scope="col" className="px-2 py-3 font-semibold">Date</th>
                <th scope="col" className="px-4 py-3 font-semibold sm:px-5">Platforms</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) =>
                group.rows.map((row, index) => {
                  const mine = group.region === visitorRegion;
                  return (
                    <tr
                      key={`${group.region}-${row.label}`}
                      className={cn(
                        "border-b border-line last:border-b-0 align-top",
                        mine && "bg-[color-mix(in_oklab,var(--game-accent)_10%,transparent)]",
                      )}
                    >
                      <th scope="row" className="px-4 py-3 font-medium sm:px-5">
                        {index === 0 && (
                          <span className="flex flex-wrap items-center gap-1.5">
                            {group.region}
                            {mine && (
                              <span className="rounded-full bg-[var(--game-accent)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-[var(--game-on-accent)]">
                                You
                              </span>
                            )}
                          </span>
                        )}
                      </th>
                      <td className="whitespace-nowrap px-2 py-3 tabular-nums text-text">{row.label}</td>
                      <td className="px-4 py-3 text-muted sm:px-5">
                        {row.platforms.length > 0 ? row.platforms.map(shortPlatform).join(", ") : "—"}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </Reveal>
      )}

      {changes.length > 0 && <DateChanges changes={changes} />}
    </section>
  );
}

function DateChanges({ changes }: { changes: ReleaseChange[] }) {
  // Newest first — the latest move is the one people want.
  const ordered = [...changes].reverse();
  return (
    <Reveal className="rounded-3xl border border-line bg-panel/40 p-5 sm:p-6">
      <h3 className="flex items-center gap-2 text-lg font-bold">
        <History size={17} className="text-[var(--game-accent)]" /> Date changes
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-faint">
        Recorded by Arnav Games since it began tracking this game&rsquo;s release date. Earlier changes aren&rsquo;t shown.
      </p>
      <ol className="relative mt-5 space-y-4 border-l border-line pl-5">
        {ordered.map((change) => {
          const delay = isDelay(change.from, change.to);
          const days = slipDays(change.from, change.to);
          return (
            <li key={`${change.observedAt}-${change.to}`} className="relative">
              <span
                aria-hidden
                className={cn(
                  "absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-bg",
                  delay ? "bg-flare" : "bg-mint",
                )}
              />
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="text-muted line-through decoration-faint/60">{releaseValueLabel(change.from)}</span>
                <ArrowRight size={13} className="text-faint" aria-label="to" />
                <span className="font-semibold text-text">{releaseValueLabel(change.to)}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    delay ? "bg-flare/12 text-flare" : "bg-mint/12 text-mint",
                  )}
                >
                  {delay ? (days ? `Delayed ${days} days` : "Delayed") : days && days < 0 ? `Moved up ${-days} days` : "Date firmed up"}
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-faint">Noticed {formatDate(change.observedAt.slice(0, 10))}</p>
            </li>
          );
        })}
      </ol>
    </Reveal>
  );
}

/** "Delayed 2×" — sits next to the date wherever the date is shown. */
export function DelayBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <a
      href="#release-dates"
      title="See how the release date has moved"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-flare/30 bg-flare/12 px-2.5 py-1 text-[11px] font-semibold text-flare transition-colors hover:bg-flare/20",
        className,
      )}
    >
      <History size={12} />
      Delayed {count}×
    </a>
  );
}
