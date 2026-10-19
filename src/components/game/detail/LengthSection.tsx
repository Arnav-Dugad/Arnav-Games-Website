"use client";

/**
 * "How long": time to beat in three honest bands, and what an hour of the
 * main story costs at the reader's local price.
 *
 * Cost per hour is the one derived number on the page, so it shows its
 * working ("₹3,599 ÷ 55 h") next to the result rather than asking to be
 * trusted. It only uses IGDB's main-story figure: dividing by a median
 * "typical playtime" would mix two different measures.
 */

import { ExternalLink } from "lucide-react";
import { valuePerHour } from "@/lib/games/market-rules";
import type { TimeToBeat } from "@/lib/games/types";
import type { GameIds } from "./endpoint";
import { InfoTip } from "./InfoTip";
import { STORE_LABEL, useLocalMarket } from "./market-ui";
import { formatMoney, formatRate } from "./money";
import { hoursLabel } from "./summary";

const full = new Intl.NumberFormat("en-US");

export function LengthSection({
  ttb,
  mainHours,
  typicalHours,
  hltbUrl,
  market,
}: {
  ttb: TimeToBeat | null;
  /** Main-story hours fit to quote (see `storyHours`); null for endless games. */
  mainHours: number | null;
  /** Median playtime, shown only when IGDB has no time to beat. */
  typicalHours: number | null;
  hltbUrl: string | null;
  market: GameIds | null;
}) {
  const { best } = useLocalMarket(market);
  const rows = ttb
    ? [
        { label: "Main story", hours: ttb.hastily },
        { label: "Main + extras", hours: ttb.normally },
        { label: "Completionist", hours: ttb.completely },
      ].filter((row): row is { label: string; hours: number } => typeof row.hours === "number" && row.hours > 0)
    : [];
  const max = Math.max(1, ...rows.map((row) => row.hours));
  const main = mainHours;
  const rate = best && best.price > 0 && main ? valuePerHour(best, main) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="glass rounded-3xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[17px] font-semibold text-text">
            {rows.length > 0 ? "Time to beat" : "Typical playtime"}
            {rows.length > 0 && <InfoTip topic="timeToBeat" />}
          </h3>
          {hltbUrl && (
            <a
              href={hltbUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-text"
            >
              HowLongToBeat <ExternalLink size={12} aria-hidden />
            </a>
          )}
        </div>

        {rows.length > 0 ? (
          <ul className="mt-4 space-y-3.5">
            {rows.map((row, index) => (
              <li key={row.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 text-[15px]">
                <span className="truncate text-muted">{row.label}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-fg/[0.08]" aria-hidden>
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(6, (row.hours / max) * 100)}%`,
                      background: `color-mix(in oklab, var(--game-accent) ${100 - index * 22}%, transparent)`,
                    }}
                  />
                </span>
                <span className="font-semibold tabular-nums text-text">{hoursLabel(row.hours)}</span>
              </li>
            ))}
          </ul>
        ) : (
          typicalHours && <p className="mt-3 font-display text-[32px] font-bold leading-none tabular-nums text-text">{hoursLabel(typicalHours)}</p>
        )}
        <p className="mt-4 text-[12px] text-faint">
          {ttb && ttb.count > 0
            ? `From ${full.format(ttb.count)} player ${ttb.count === 1 ? "submission" : "submissions"} on IGDB`
            : rows.length > 0
              ? "Player submissions on IGDB"
              : "How long players typically spend in it"}
        </p>
      </div>

      {rate && best && main && (
        <div className="glass flex flex-col rounded-3xl p-5 sm:p-6">
          <h3 className="flex items-center gap-1.5 text-[17px] font-semibold text-text">
            Cost per hour <InfoTip topic="valuePerHour" />
          </h3>
          <p className="mt-4 font-display text-[36px] font-bold leading-none tracking-[-0.02em] tabular-nums text-text">
            ≈ {formatRate(rate.perHour, best.currency, best.country)}
            <span className="ml-1 text-[15px] font-semibold text-muted">/ hour</span>
          </p>
          <p className="mt-3 text-[13px] leading-snug text-muted">
            {formatMoney(best.price, best.currency, best.country)} on {STORE_LABEL[best.store]} ÷ {hoursLabel(main)} of main story
          </p>
        </div>
      )}
    </div>
  );
}
