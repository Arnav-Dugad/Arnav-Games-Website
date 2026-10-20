/**
 * Steam patch posts condensed into "what changed" — pure, so the rules can be
 * pinned down in `scripts/check-providers.ts`.
 *
 * The one rule that matters: nothing here writes copy. Every bullet is text
 * the developer published, cleaned of markup and trimmed; headings are the
 * post's own headings. The only words we supply are two fallback section
 * labels ("Changes" for bullets that sit under no heading, "Notes" for a post
 * that has no list at all), which describe the grouping, not the game.
 *
 * Steam posts arrive in Steam BBCode (`[list][*]…`, `[h2]`), raw HTML from
 * syndicated feeds, or plain text with dash bullets — often a mix — so the
 * parser first flattens all three into marked lines (heading / bullet start /
 * bullet end / text) and then walks them once.
 */

import type { PatchNote, UpdatePost } from "./types";
import { decodeEntities, stripNewsMarkup } from "./news-text";

export interface SteamNewsItem {
  gid?: string;
  title?: string;
  url?: string;
  date?: number;
  tags?: string[];
  feedlabel?: string;
  contents?: string;
}

const ITEM_MAX = 160;
const HEADING_MAX = 60;
/** Response-size guard; `totalItems` still counts everything. */
const MAX_ITEMS_PER_POST = 60;
const MAX_HIGHLIGHTS = 5;

/*
 * Titles that announce a patch. Steam's own `patchnotes` tag is the primary
 * signal (developers tick it when posting); the title is the fallback for
 * those who don't, and a title-only match must also contain a real list (see
 * `condensePatchPost`), so "Big update coming soon!" teasers stay out.
 */
const PATCH_TITLE =
  /\b(patch(?:\s*notes?)?|hot\s?fix(?:es)?|updated?|changelog|change\s?log|release\s*notes?|bug\s?fix(?:es)?|v(?:er(?:sion)?\.?)?\s?\d+(?:\.\d+)+|\d+\.\d+\.\d+)\b/i;

export function isPatchPost(item: Pick<SteamNewsItem, "title" | "tags">): boolean {
  if (item.tags?.includes("patchnotes")) return true;
  return PATCH_TITLE.test(item.title ?? "");
}

/** Only the BBCode tags Steam actually uses — a bare "[FIXES]" label must survive as text. */
const BBCODE_TAG =
  /\[\/?(?:b|i|u|s|url|quote|code|spoiler|noparse|hr|table|tr|td|th|size|color|center|left|right|emoticon|expand|p|h[1-6]|list|olist)(?:[= ][^\]]*)?\]/gi;

const H = "\u0001H";
const B = "\u0001B";
const E = "\u0001E";

function toMarkedLines(raw: string): string[] {
  const oneLine = (inner: string) => inner.replace(/\s*\n\s*/g, " ");
  const text = raw
    // Media and embeds carry no prose.
    .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, " ")
    .replace(/\[(previewyoutube|video|dynamiclink)[^\]]*\][\s\S]*?\[\/\1\]/gi, " ")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, " ")
    // Struck-out text is something the developer has retracted.
    .replace(/\[strike\][\s\S]*?\[\/strike\]/gi, " ")
    .replace(/<(s|strike|del)>[\s\S]*?<\/\1>/gi, " ")
    .replace(/\[h([1-6])\]([\s\S]*?)\[\/h\1\]/gi, (_m, _l, inner: string) => `\n${H}${oneLine(inner)}\n`)
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _l, inner: string) => `\n${H}${oneLine(inner)}\n`)
    .replace(/\[\*\]|<li[^>]*>/gi, `\n${B}`)
    .replace(/\[\/\*\]|<\/li>|\[\/?o?list[^\]]*\]|<\/?[ou]l[^>]*>/gi, `\n${E}\n`)
    .replace(/\[\/?p\]|<\/?p[^>]*>|<br\s*\/?>|\[br\]/gi, "\n")
    .replace(BBCODE_TAG, "")
    .replace(/<[^>]+>/g, "")
    // CS2 writes section labels as "\[ MISC ]".
    .replace(/\\\[/g, "[");
  return decodeEntities(text).split("\n");
}

const clean = (text: string) =>
  text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function trimTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

/** "[ UI ]" → "UI", "BUG FIXES:" → "Bug Fixes". Shouting is formatting, not wording. */
function cleanHeading(text: string): string {
  const bare = text
    .replace(/^\[\s*(.*?)\s*\]$/, "$1")
    .replace(/^[#=*\s-]+|[#=*:\s-]+$/g, "")
    .trim();
  if (/[a-z]/.test(bare) || bare.replace(/[^A-Z]/g, "").length <= 3) return bare;
  return bare.toLowerCase().replace(/(^|[\s/&(-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** A plain line that reads as a label rather than a sentence. */
function looksLikeHeading(text: string): boolean {
  if (/^\[[^\]]{1,40}\]$/.test(text)) return true;
  if (text.length > HEADING_MAX) return false;
  if (/:$/.test(text)) return true;
  return text.split(" ").length <= 5 && !/[.!?,;)]$/.test(text) && !/^\d/.test(text);
}

/** Sign-offs and calls to action, which say nothing about the change itself. */
const SIGN_OFF = /^(thank|thanks|please (stay|follow|join|let)|stay tuned|follow us|join (us|our)|for more|as always|see you|happy |enjoy|have fun|cheers|- ?the )/i;

const DASH_BULLET = /^(?:[-*•·–]|\d{1,2}[.)])\s+/;

interface Parsed {
  sections: PatchNote["sections"];
  totalItems: number;
  bulletCount: number;
}

/** Bullets grouped under their nearest heading; falls back to paragraphs for list-less posts. */
export function parsePatchBody(raw: string): Parsed {
  const sections: Array<{ heading: string; items: string[] }> = [];
  const paragraphs: string[] = [];
  let heading = "Changes";
  let bullet: string[] | null = null;
  let total = 0;

  const add = (item: string) => {
    const text = trimTo(clean(item), ITEM_MAX);
    if (text.length < 3 || !/[a-z0-9]/i.test(text)) return;
    total++;
    const key = heading.toLowerCase();
    let section = sections.find((s) => s.heading.toLowerCase() === key);
    if (!section) {
      section = { heading, items: [] };
      sections.push(section);
    }
    section.items.push(text);
  };
  const flush = () => {
    if (bullet && bullet.length > 0) add(bullet.join(" "));
    bullet = null;
  };

  for (const line of toMarkedLines(raw)) {
    if (line.startsWith(H)) {
      flush();
      const text = clean(line.slice(2));
      if (text && text.length <= HEADING_MAX) heading = cleanHeading(text) || heading;
      else if (text) paragraphs.push(text);
      continue;
    }
    if (line.startsWith(B)) {
      flush();
      bullet = [];
      const text = clean(line.slice(2));
      if (text) bullet.push(text);
      continue;
    }
    if (line.startsWith(E)) {
      flush();
      continue;
    }
    const text = clean(line);
    if (!text) continue;
    if (bullet) {
      // Inside one [*]: "Weapon" / "→ Increased power." continuation lines.
      // Developer footnotes ("Note: …") qualify rather than describe a change.
      if (/^note\s*:/i.test(text)) continue;
      bullet.push(text.replace(DASH_BULLET, ""));
      continue;
    }
    if (DASH_BULLET.test(text)) {
      add(text.replace(DASH_BULLET, ""));
      continue;
    }
    if (looksLikeHeading(text)) {
      heading = cleanHeading(text) || heading;
      continue;
    }
    paragraphs.push(text);
  }
  flush();

  const bulletCount = total;
  if (bulletCount === 0) {
    // No list at all (a short hotfix note): the developer's own sentences,
    // verbatim, are the only honest summary.
    heading = "Notes";
    for (const paragraph of paragraphs.filter((p) => p.length >= 20 && !SIGN_OFF.test(p)).slice(0, MAX_HIGHLIGHTS)) {
      add(paragraph);
    }
  }

  return { sections: sections.filter((s) => s.items.length > 0), totalItems: total, bulletCount };
}

/** Caps the stored bullets while keeping each section's head. */
function capSections(sections: PatchNote["sections"]): PatchNote["sections"] {
  let left = MAX_ITEMS_PER_POST;
  const out: PatchNote["sections"] = [];
  for (const section of sections) {
    if (left <= 0) break;
    const items = section.items.slice(0, left);
    left -= items.length;
    out.push({ heading: section.heading, items });
  }
  return out;
}

/** Highlights skip intro bullets ("The following were changed:") and one-word scraps. */
export function pickHighlights(sections: PatchNote["sections"]): string[] {
  return sections
    .flatMap((section) => section.items)
    .filter((item) => item.length >= 12 && !/:$/.test(item))
    .slice(0, MAX_HIGHLIGHTS);
}

function safeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.replace(/^http:/, "https:"));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * One Steam news item → a `PatchNote`, or null when it isn't a patch post
 * (or is title-matched but has no list to condense).
 */
export function condensePatchPost(item: SteamNewsItem): PatchNote | null {
  if (!item.title || !isPatchPost(item)) return null;
  const url = safeUrl(item.url);
  if (!url || typeof item.date !== "number") return null;
  const parsed = parsePatchBody(item.contents ?? "");
  const tagged = item.tags?.includes("patchnotes") ?? false;
  if (!tagged && parsed.bulletCount < 2) return null;
  const sections = capSections(parsed.sections);
  return {
    title: stripNewsMarkup(item.title, 160),
    date: new Date(item.date * 1000).toISOString(),
    url,
    sections,
    highlights: pickHighlights(sections),
    totalItems: parsed.totalItems,
  };
}

/** The latest `limit` patch posts, newest first. */
export function patchNotesFrom(items: SteamNewsItem[], limit = 5): PatchNote[] {
  const out: PatchNote[] = [];
  const seen = new Set<string>();
  for (const item of [...items].sort((a, b) => (b.date ?? 0) - (a.date ?? 0))) {
    if (out.length >= limit) break;
    const key = item.gid ?? item.url ?? item.title ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    const note = condensePatchPost(item);
    if (note) out.push(note);
  }
  return out;
}

/** Raw markup read for an excerpt; enough for 220 characters of prose after media is stripped. */
const EXCERPT_SOURCE = 6000;
const EXCERPT_MAX = 220;

/**
 * One pass over a feed for the updates timeline: the latest `patchLimit`
 * condensed patch posts (as `patchNotesFrom`) and the latest `postLimit`
 * posts of any kind with a plain-text excerpt. Each post's body is parsed at
 * most once — condensing for patches, a bounded strip for the rest — which
 * keeps a cold request's CPU small on Workers.
 */
export function steamFeedFrom(
  items: SteamNewsItem[],
  patchLimit = 5,
  postLimit = 12,
): { patches: PatchNote[]; posts: UpdatePost[] } {
  const patches: PatchNote[] = [];
  const posts: UpdatePost[] = [];
  const seen = new Set<string>();
  for (const item of [...items].sort((a, b) => (b.date ?? 0) - (a.date ?? 0))) {
    if (patches.length >= patchLimit && posts.length >= postLimit) break;
    const key = item.gid ?? item.url ?? item.title ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    const note = patches.length < patchLimit ? condensePatchPost(item) : null;
    if (note) patches.push(note);
    if (posts.length >= postLimit) continue;
    const url = safeUrl(item.url);
    if (!item.title || !url || typeof item.date !== "number") continue;
    posts.push({
      title: stripNewsMarkup(item.title, 160),
      date: new Date(item.date * 1000).toISOString(),
      url,
      // Past the condensing quota, Steam's tag / a patch title still marks a patch.
      patch: note !== null || (patches.length >= patchLimit && isPatchPost(item)),
      excerpt: stripNewsMarkup((item.contents ?? "").slice(0, EXCERPT_SOURCE), EXCERPT_MAX),
    });
  }
  return { patches, posts };
}
