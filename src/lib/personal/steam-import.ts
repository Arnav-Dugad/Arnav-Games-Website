/**
 * Steam library import: the pure half, shared by `POST /api/steam/import`
 * and the review sheet, and pinned down in `scripts/check-providers.ts`.
 *
 *  - `parseSteamProfile` turns whatever the reader pasted (a profile URL, a
 *    vanity name, a SteamID64, a legacy `STEAM_0:…` or `[U:1:…]` id) into
 *    either a SteamID64 or a vanity name to resolve. Nothing is fetched.
 *  - `inferImportStatus` proposes a library status from Steam's numbers.
 *    It is only a proposal: the reader reviews every row before anything is
 *    written.
 *
 * Steam tells us total minutes played and when the game was last launched —
 * not whether it was finished. So "Finished" is only proposed when the hours
 * reach the crowd's time to beat; a game played a while ago and left short of
 * that is "Shelved" (stored as no status, with its hours kept), which is what
 * the stats page reads as started-then-dropped.
 */

/** SteamID64s for individual accounts sit in this range (universe 1, type 1). */
const ID64_BASE = BigInt("76561197960265728");
const ID64_MAX = BigInt("76561202255233023");

export type SteamProfileRef = { kind: "id64"; id: string } | { kind: "vanity"; name: string };

function id64FromAccount(account: bigint): string | null {
  const id = ID64_BASE + account;
  return id > ID64_BASE && id <= ID64_MAX ? id.toString() : null;
}

function validId64(raw: string): string | null {
  if (!/^\d{17}$/.test(raw)) return null;
  const id = BigInt(raw);
  return id > ID64_BASE && id <= ID64_MAX ? raw : null;
}

const VANITY = /^[A-Za-z0-9_-]{2,32}$/;

/**
 * The account a pasted string points at, or null when it can't be one.
 *
 *   https://steamcommunity.com/id/gaben/          → vanity "gaben"
 *   steamcommunity.com/profiles/76561197960287930 → id64
 *   76561197960287930                             → id64
 *   STEAM_0:0:11101 / [U:1:22202]                 → id64
 *   gaben                                         → vanity "gaben"
 */
export function parseSteamProfile(input: string): SteamProfileRef | null {
  const raw = input.trim().replace(/^<|>$/g, "");
  if (!raw || raw.length > 200) return null;

  // Trailing paths (`/games/?tab=all`) are fine: only the account segment matters.
  const url = raw.match(/^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(id|profiles)\/([^/?#\s]+)(?:[/?#].*)?$/i);
  if (url) {
    let value: string;
    try {
      value = decodeURIComponent(url[2]);
    } catch {
      return null;
    }
    if (url[1].toLowerCase() === "profiles") {
      const id = validId64(value);
      return id ? { kind: "id64", id } : null;
    }
    return VANITY.test(value) ? { kind: "vanity", name: value } : null;
  }
  // Any other URL (a store page, s.team short link) isn't a profile we can read.
  if (/^(?:https?:\/\/|www\.)/i.test(raw) || raw.includes("/")) return null;

  const legacy = raw.match(/^STEAM_[0-5]:([01]):(\d{1,10})$/i);
  if (legacy) {
    const id = id64FromAccount(BigInt(legacy[2]) * BigInt(2) + BigInt(legacy[1]));
    return id ? { kind: "id64", id } : null;
  }
  const steam3 = raw.match(/^\[?U:1:(\d{1,10})\]?$/i);
  if (steam3) {
    const id = id64FromAccount(BigInt(steam3[1]));
    return id ? { kind: "id64", id } : null;
  }
  if (/^\d{17}$/.test(raw)) {
    const id = validId64(raw);
    return id ? { kind: "id64", id } : null;
  }
  // Seventeen digits outside the range, or any other long number, is a typo
  // rather than a vanity name made of digits.
  if (/^\d{12,}$/.test(raw)) return null;
  return VANITY.test(raw) ? { kind: "vanity", name: raw } : null;
}

/* ---------------------------------------------------------------------------
 * Status inference
 * ------------------------------------------------------------------------ */

/** What the review sheet proposes for one game. "shelved" is stored as no status. */
export type ImportChoice = "backlog" | "playing" | "finished" | "shelved" | "skip";

/** Played within this window → "Playing". Two weeks is Steam's own "recent" window. */
export const RECENT_DAYS = 14;
/** Hours ≥ this share of the crowd's main-story time → "Finished". */
export const FINISH_SHARE = 0.9;
/** Less than this and the game was opened, not played. */
export const TRIED_MINUTES = 30;

export interface InferInput {
  /** Steam `playtime_forever`, minutes. */
  minutes: number;
  /** Steam `rtime_last_played`, unix seconds; 0 or missing when never launched. */
  lastPlayed?: number | null;
  /** IGDB "normally" (or "hastily") hours to beat, when known. */
  timeToBeat?: number | null;
  now?: number;
}

export function inferImportStatus({ minutes, lastPlayed, timeToBeat, now = Date.now() }: InferInput): Exclude<ImportChoice, "skip"> {
  const played = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
  if (played < TRIED_MINUTES) return "backlog";
  const hours = played / 60;
  if (typeof timeToBeat === "number" && timeToBeat > 0 && hours >= timeToBeat * FINISH_SHARE) return "finished";
  const last = typeof lastPlayed === "number" && lastPlayed > 0 ? lastPlayed * 1000 : null;
  if (last !== null && now - last <= RECENT_DAYS * 86_400_000) return "playing";
  return "shelved";
}

/** The stored library status for a choice ("shelved" keeps its hours but no status). */
export function statusForChoice(choice: ImportChoice): "none" | "playing" | "played" | null {
  if (choice === "skip") return null;
  if (choice === "playing") return "playing";
  if (choice === "finished") return "played";
  return "none";
}

export const CHOICE_LABEL: Record<ImportChoice, string> = {
  backlog: "Backlog",
  playing: "Playing",
  finished: "Finished",
  shelved: "Shelved",
  skip: "Skip",
};

/* ---------------------------------------------------------------------------
 * Wire format (route ⇄ sheet)
 * ------------------------------------------------------------------------ */

/** One owned Steam app, as the route returns it (no icons, no extras). */
export interface SteamOwnedGame {
  appid: number;
  name: string;
  /** Minutes played, all time. */
  minutes: number;
  /** Unix seconds, 0 when never launched. */
  lastPlayed: number;
}

/** The catalogue record a Steam app matched, trimmed to what a library entry needs. */
export interface SteamMatch {
  appid: number;
  id: number;
  slug: string;
  name: string;
  image: string | null;
  imageFallback: string | null;
  released: string | null;
  releaseWindow: string | null;
  tba: boolean;
  metacritic: number | null;
  genres: Array<{ id: number; slug: string; name: string }>;
  platformSlugs: string[];
  /** IGDB main-story hours when known. */
  hours: number | null;
}

export interface SteamAccount {
  steamId: string;
  name: string | null;
  avatar: string | null;
}

export type SteamImportResponse =
  | { ok: true; account: SteamAccount; games: SteamOwnedGame[]; matches: SteamMatch[]; matched: number[] }
  | { ok: true; matches: SteamMatch[]; matched: number[] }
  | { ok: false; reason: SteamImportFailure; message: string };

export type SteamImportFailure =
  | "not-configured"
  | "signed-out"
  | "bad-input"
  | "not-found"
  | "private"
  | "empty"
  | "steam-down"
  | "rate-limited";

/** Apps matched per request: one IGDB external-id query, one summary query, one time-to-beat query. */
export const MATCH_PAGE = 100;
/** The most games one import reviews (and writes): keeps a whale library inside the free write quota. */
export const IMPORT_MAX = 1500;

/** Owned games, most played first (then most recent, then name), capped to `IMPORT_MAX`. */
export function rankOwnedGames(games: SteamOwnedGame[]): SteamOwnedGame[] {
  return [...games]
    .sort((a, b) => b.minutes - a.minutes || b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name) || a.appid - b.appid)
    .slice(0, IMPORT_MAX);
}

/** Validated appids from an untrusted body: positive integers, deduped, at most one page. */
export function parseAppids(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MATCH_PAGE) return null;
  if (!value.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0 && id < 1e8)) return null;
  return [...new Set(value as number[])];
}
