import type { GameSummary, ReleaseChange } from "./types";

/**
 * The comparable form of a release "value" — the string the delay tracker
 * stores: an ISO day, a window label ("Q4 2026", "Mar 2026", "2027") or "TBA".
 * Pure, so the delay rules can be self-checked without a database.
 */

export const TBA_VALUE = "TBA";

/** What we record for a game: its most precise known date, else its window. */
export function releaseValue(game: Pick<GameSummary, "released" | "releaseWindow">): string {
  return game.released ?? game.releaseWindow?.trim() ?? TBA_VALUE;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (value: number) => String(value).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The *latest* day a value could mean, as ISO — the end of a window, the day
 * itself for a date, null for TBA or anything unparseable.
 *
 * End-of-window is the right bound for delay detection: "Q4 2026" narrowing to
 * "2026-11-15" is a firmer date, not a delay, while "2026-11-15" becoming
 * "Q1 2027" plainly is.
 */
export function releaseUpperBound(value: string): string | null {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const quarter = text.match(/^Q([1-4])\s+(\d{4})$/i);
  if (quarter) {
    const year = Number(quarter[2]);
    const month = Number(quarter[1]) * 3;
    return `${year}-${pad(month)}-${pad(lastDay(year, month))}`;
  }

  const month = text.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (month) {
    const index = MONTHS.indexOf(month[1].slice(0, 3).toLowerCase());
    if (index >= 0) {
      const year = Number(month[2]);
      return `${year}-${pad(index + 1)}-${pad(lastDay(year, index + 1))}`;
    }
  }

  const year = text.match(/^(\d{4})$/);
  if (year) return `${year[1]}-12-31`;

  return null;
}

/**
 * True when `to` is later than `from`. Losing a date entirely (→ TBA) counts
 * as a slip; gaining one never does.
 */
export function isDelay(from: string, to: string): boolean {
  const a = releaseUpperBound(from);
  const b = releaseUpperBound(to);
  if (a && !b) return /^tb[ad]$/i.test(to.trim());
  if (!a || !b) return false;
  return b > a;
}

/** Observations (any order) → the chain of changes between them, oldest first. */
export function changesFromObservations(
  rows: Array<{ value: string; observedAt: number }>,
): ReleaseChange[] {
  const ordered = [...rows].sort((a, b) => a.observedAt - b.observedAt);
  const changes: ReleaseChange[] = [];
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].value === ordered[i - 1].value) continue;
    changes.push({
      from: ordered[i - 1].value,
      to: ordered[i].value,
      observedAt: new Date(ordered[i].observedAt * 1000).toISOString(),
    });
  }
  return changes;
}
