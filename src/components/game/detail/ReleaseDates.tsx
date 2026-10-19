import { ArrowRight, CalendarClock, History } from "lucide-react";
import { isDelay } from "@/lib/games/release-value";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";
import type { ReleaseChange, ReleaseEvent } from "@/lib/games/types";
import { Disclosure } from "./Disclosure";
import { groupReleases, releaseValueLabel, shortPlatform, slipDays } from "./release";

/**
 * Regional release dates and the record of how the date has moved, folded
 * into "Where to play & price" behind "Show": the headline date is already
 * in the hero and "At a glance", so the table is reference, not news.
 *
 * The reader's region (from Cloudflare's country header) is highlighted, since
 * "when can *I* play it" is the question this table exists to answer. Links to
 * `#release-dates` (the "Delayed 2×" badges) open it.
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
  const delays = changes.filter((change) => isDelay(change.from, change.to)).length;
  const subtitle = [
    showTable ? `${groups.length} ${groups.length === 1 ? "region" : "regions"}` : null,
    delays > 0 ? `delayed ${delays}×` : changes.length > 0 ? `${changes.length} date ${changes.length === 1 ? "change" : "changes"}` : null,
    visitorRegion && countryName ? `${countryName} is under ${visitorRegion}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Disclosure id="release-dates" icon={<CalendarClock size={17} />} title={showTable ? "Release dates by region" : "How the date has moved"} subtitle={subtitle}>
      <div className="space-y-5">
        {showTable && (
          <div className="-mx-1 overflow-hidden rounded-2xl border border-line">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Release dates by region and platform</caption>
              <thead className="border-b border-line text-[11px] font-semibold text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Region</th>
                  <th scope="col" className="px-2 py-3 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Platforms</th>
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
                          "border-b border-line align-top last:border-b-0",
                          mine && "bg-[color-mix(in_oklab,var(--game-accent)_10%,transparent)]",
                        )}
                      >
                        <th scope="row" className="px-4 py-3 font-medium">
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
                        <td className="px-4 py-3 text-muted">{row.platforms.length > 0 ? row.platforms.map(shortPlatform).join(", ") : "—"}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}

        {changes.length > 0 && <DateChanges changes={changes} />}
      </div>
    </Disclosure>
  );
}

function DateChanges({ changes }: { changes: ReleaseChange[] }) {
  // Newest first — the latest move is the one people want.
  const ordered = [...changes].reverse();
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[15px] font-semibold">
        <History size={17} className="text-[var(--game-accent)]" /> Date changes
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
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
              <p className="mt-0.5 text-[11px] text-muted">Noticed {formatDate(change.observedAt.slice(0, 10))}</p>
            </li>
          );
        })}
      </ol>
    </div>
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
