import type { ReleaseEvent } from "./types";

/**
 * Country → IGDB release region.
 *
 * IGDB dates releases against ten coarse regions, not countries. These lists
 * say which of those regions describe a reader's country, most specific first,
 * so "when does it come out *here*" can be answered from the per-region rows.
 *
 * Deliberately conservative: a country only maps to a region publishers
 * actually ship it under (PAL Europe covers the UK, the EU/EEA and the usual
 * PAL neighbours). Anywhere not listed gets just "Worldwide" — guessing that,
 * say, the Gulf follows the European date would be an invented claim.
 */

const EUROPE = new Set(
  (
    "AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GI GR HR HU IE IM IS IT JE GG LI LT LU LV " +
    "MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM TR UA VA XK"
  ).split(" "),
);
const NORTH_AMERICA = new Set(["US", "CA", "MX", "PR"]);
/** Asian markets IGDB has no dedicated region for. */
const ASIA = new Set(
  "AF BD BN BT HK ID IN KH KZ LA LK MM MN MO MY NP PH PK SG TH TW UZ VN".split(" "),
);

export function regionForCountry(iso2: string): string[] {
  const code = (iso2 || "").trim().toUpperCase();
  if (code === "JP") return ["Japan", "Asia", "Worldwide"];
  if (code === "KR") return ["Korea", "Asia", "Worldwide"];
  if (code === "CN") return ["China", "Asia", "Worldwide"];
  if (code === "AU") return ["Australia", "Worldwide"];
  if (code === "NZ") return ["New Zealand", "Worldwide"];
  if (code === "BR") return ["Brazil", "Worldwide"];
  if (NORTH_AMERICA.has(code)) return ["North America", "Worldwide"];
  if (EUROPE.has(code)) return ["Europe", "Worldwide"];
  if (ASIA.has(code)) return ["Asia", "Worldwide"];
  return ["Worldwide"];
}

/**
 * The release that applies to a reader in `iso2`, or null when none of the
 * game's regional rows covers them.
 *
 * Walks the country's regions most-specific-first and stops at the first one
 * with any rows, so a dedicated Japan date beats a worldwide one. Within a
 * region the earliest day-precise date wins (the reader can play then on
 * *some* platform); a window is only used when the region has no exact date.
 * Rows with no region are treated as worldwide, which is what IGDB means by
 * leaving it blank.
 */
export function localReleaseFor(releases: ReleaseEvent[], iso2: string): ReleaseEvent | null {
  for (const region of regionForCountry(iso2)) {
    const matching = releases.filter(
      (release) => (release.region ?? "Worldwide") === region,
    );
    if (matching.length === 0) continue;
    const dated = matching
      .filter((release): release is ReleaseEvent & { date: string } => Boolean(release.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    return dated[0] ?? matching[0];
  }
  return null;
}
