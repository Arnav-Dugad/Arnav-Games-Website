/**
 * Cookieless returning-visitor signal for retention cohorts.
 *
 * Two values are kept in localStorage, and neither is an identifier:
 *  - `arnav-games:first-seen`: the ISO week of this browser's first visit
 *    ("2026-W42") — identical for everyone who first came that week;
 *  - `arnav-games:last-active`: the UTC day of its latest visit.
 *
 * From those, the first pageview of each day is tagged `new`, `return-wk`
 * (first return this week) or `return`, with the cohort week. Nothing is
 * written for visitors with DNT/GPC, and clearing site data simply makes a
 * browser "new" again — which is why the dashboard calls these estimates.
 */

import type { VisitKind } from "./types";
import { COHORT_RE } from "./types";
import { isoWeekOf, utcDay } from "./week";

const FIRST_SEEN = "arnav-games:first-seen";
const LAST_ACTIVE = "arnav-games:last-active";

/**
 * Tags for this pageview, or null when it isn't the first of the UTC day
 * (or storage is unavailable). Marks the day as seen as a side effect, so
 * call it once per pageview that is actually being sent.
 */
export function takeVisitTags(now = new Date()): { cohort: string; visit: VisitKind } | null {
  try {
    const storage = window.localStorage;
    const today = utcDay(now);
    const last = storage.getItem(LAST_ACTIVE);
    if (last === today) return null;

    let cohort = storage.getItem(FIRST_SEEN);
    let visit: VisitKind;
    if (!cohort || !COHORT_RE.test(cohort)) {
      cohort = isoWeekOf(now);
      storage.setItem(FIRST_SEEN, cohort);
      visit = "new";
    } else {
      const lastDate = last && /^\d{4}-\d{2}-\d{2}$/.test(last) ? new Date(`${last}T00:00:00Z`) : null;
      visit = lastDate && isoWeekOf(lastDate) === isoWeekOf(now) ? "return" : "return-wk";
    }
    storage.setItem(LAST_ACTIVE, today);
    return { cohort, visit };
  } catch {
    // Private mode, blocked storage, quota — just send the pageview untagged.
    return null;
  }
}
