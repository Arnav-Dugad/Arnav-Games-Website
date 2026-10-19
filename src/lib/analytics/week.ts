/**
 * ISO-8601 weeks in UTC, shared by the tracker (which labels a browser's
 * first visit) and the stats queries (which line cohorts up by week).
 *
 * UTC rather than local time on purpose: the server buckets by UTC, and a
 * visitor crossing midnight in their own zone must land in the same week on
 * both sides.
 */

const DAY_MS = 86_400_000;

/** "2026-W42" for the week containing `date`. */
export function isoWeekOf(date: Date): string {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  // ISO weeks belong to the year of their Thursday, and the Thursday of week
  // n always falls on ordinal day 7n−6 … 7n of that year.
  const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(day + (3 - weekday) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monday 00:00 UTC of an ISO week label, in unix seconds; null if malformed. */
export function isoWeekStart(label: string): number | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // 4 January is always in week 1.
  const jan4 = Date.UTC(year, 0, 4);
  const monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  return (monday + (week - 1) * 7 * DAY_MS) / 1000;
}

/** Monday 00:00 UTC of the week containing `unixSeconds`. */
export function weekStartOf(unixSeconds: number): number {
  const day = Math.floor(unixSeconds / 86_400);
  // 1 January 1970 was a Thursday, so (day + 3) % 7 is days since Monday.
  return (day - ((day + 3) % 7)) * 86_400;
}

/** "YYYY-MM-DD" in UTC. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
