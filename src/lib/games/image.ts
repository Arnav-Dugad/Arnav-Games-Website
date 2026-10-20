/**
 * Requests a provider's image at a size appropriate to how it will render.
 *
 * Providers hand back a URL at whatever size suited the query that produced it.
 * A cover fetched for a 220px card is the wrong asset for a 1920px hero, and
 * vice versa. IGDB encodes size as a path segment, so it can be re-targeted
 * cheaply; other providers serve one fixed asset and are returned untouched.
 *
 * `next/image` still optimises whatever comes back — this only ensures the
 * *source* is large enough to be worth optimising, and small enough not to
 * waste the origin's bandwidth.
 */

const IGDB_HOST = "images.igdb.com";
/** Matches the `/t_<size>/` segment in an IGDB media URL. */
const IGDB_SIZE_SEGMENT = /\/t_[a-z0-9_]+\//i;

/**
 * Deliberately biased one step up.
 *
 * The width passed in is a CSS width, but the browser requests roughly 2x that
 * on a retina display. Picking the source purely by CSS width would serve a
 * 264px cover into a 440px slot and look soft on exactly the screens people
 * notice it on.
 */
function igdbSizeFor(currentSize: string, width: number): string {
  // Covers are portrait crops. Retargeting them to 720p/1080p changes the
  // transform to a landscape fit and was the reason some hero posters appeared
  // blank or tiny. Keep the asset family intact.
  if (currentSize.startsWith("cover_")) {
    return width <= 160 ? "cover_big" : "cover_big_2x";
  }
  if (currentSize.startsWith("screenshot_")) return "screenshot_huge";
  if (currentSize === "logo_med") return currentSize;
  return width <= 900 ? "720p" : "1080p";
}

export function isIgdbImage(url: string | null | undefined): boolean {
  return Boolean(url?.includes(IGDB_HOST));
}

/** Hosts that already publish fixed transforms and are more reliable direct. */
export function shouldBypassImageOptimizer(url: string | null | undefined): boolean {
  return isIgdbImage(url) || Boolean(url?.includes("i.ytimg.com"));
}

export function sizedImage(url: string | null | undefined, width?: number): string | null {
  if (!url) return null;
  if (!width) return url;

  if (url.includes(IGDB_HOST) && IGDB_SIZE_SEGMENT.test(url)) {
    const currentSize = url.match(/\/t_([a-z0-9_]+)\//i)?.[1] ?? "";
    return url.replace(IGDB_SIZE_SEGMENT, `/t_${igdbSizeFor(currentSize, width)}/`);
  }

  return url;
}

/**
 * The smallest useful copy of an image, for effects that blur it beyond
 * recognition anyway (the game page's artwork ambience). IGDB's smallest
 * landscape transform keeps the whole frame's colours (its `thumb` is a
 * square centre crop); other hosts serve one size, returned as-is.
 */
export function ambientImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.includes(IGDB_HOST) && IGDB_SIZE_SEGMENT.test(url)) {
    const currentSize = url.match(/\/t_([a-z0-9_]+)\//i)?.[1] ?? "";
    return url.replace(IGDB_SIZE_SEGMENT, currentSize.startsWith("cover_") ? "/t_cover_small/" : "/t_screenshot_med/");
  }
  return url;
}
