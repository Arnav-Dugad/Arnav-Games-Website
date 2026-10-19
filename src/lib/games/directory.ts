export type DirectorySearchParams = Record<string, string | string[] | undefined>;
export type DirectoryOrder = "name" | "-name";

export interface DirectoryQuery {
  query: string;
  page: number;
  order: DirectoryOrder;
  /** A–Z jump: "a"–"z", or "0" for names starting with a digit. */
  letter: string | null;
}

/**
 * Directory queries travel to the provider as a single `query` string, so a
 * letter jump is encoded as `^m` ("names starting with m"). A typed search
 * can't collide with it: `^` is not a character any studio or franchise
 * name starts with.
 */
export const letterQuery = (letter: string) => `^${letter}`;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** Turns a shareable directory URL into a bounded provider query. */
export function parseDirectorySearchParams(params: DirectorySearchParams): DirectoryQuery {
  const query = (first(params.q) ?? "").trim().slice(0, 80);
  const requestedPage = Number.parseInt(first(params.page) ?? "1", 10);

  const letter = (first(params.letter) ?? "").toLowerCase();

  return {
    query,
    page: Number.isFinite(requestedPage) ? Math.min(Math.max(requestedPage, 1), 1000) : 1,
    order: first(params.sort) === "desc" ? "-name" : "name",
    letter: /^[a-z0]$/.test(letter) ? letter : null,
  };
}

/** Safely adds a case-insensitive name filter to an APICalypse where clause. */
export function buildDirectoryWhere(base: string, query: string): string {
  if (!query) return base;
  const jump = /^\^([a-z0])$/.exec(query);
  if (jump) {
    // IGDB's `~ "x"*` is a case-insensitive prefix match; "0" means any digit.
    const prefixes = jump[1] === "0" ? "0123456789".split("") : [jump[1]];
    return `${base} & (${prefixes.map((prefix) => `name ~ "${prefix}"*`).join(" | ")})`;
  }
  const safe = query.replace(/[\\"*;&|()]/g, " ").replace(/\s+/g, " ").trim();
  return safe ? `${base} & name ~ *"${safe}"*` : base;
}
