/**
 * Plain-text excerpts from Steam news.
 *
 * `ISteamNews` hands back whatever the publisher typed: Steam's BBCode
 * (`[b]`, `[url=…]`, `[img]{STEAM_CLAN_IMAGE}/…[/img]`, `[previewyoutube=…]`),
 * raw HTML from syndicated feeds, or both at once. Excerpts are rendered as
 * text, so this removes markup entirely rather than translating it, keeping
 * link *labels* and dropping media.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X"
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function stripNewsMarkup(raw: string, maxLength = 280): string {
  const text = decodeEntities(
    raw
      // Media carries no prose; drop it with its payload.
      .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, " ")
      .replace(/\[previewyoutube[^\]]*\][\s\S]*?\[\/previewyoutube\]/gi, " ")
      .replace(/\[video[^\]]*\][\s\S]*?\[\/video\]/gi, " ")
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<img[^>]*>/gi, " ")
      .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, " ")
      // List bullets and line structure become spaces in a one-line excerpt.
      .replace(/\[\*\]/g, " • ")
      .replace(/\[\/\*\]/g, " ")
      .replace(/<\s*li[^>]*>/gi, " • ")
      // Every other tag, either syntax, keeps its inner text.
      .replace(/\[\/?[a-z0-9]+(?:[= ][^\]]*)?\]/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s•]+/, "")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();

  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}
