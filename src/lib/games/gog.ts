/**
 * GOG as a third local-price store.
 *
 * IGDB's GOG ids point at GOG *game* records, which often aren't the product
 * GOG actually sells (The Witcher 3's sellable item is a "pack" with its own
 * id), so prices are found the way a shopper would: the public catalogue
 * search, an exact title (or an edition of it — "… Remastered"), then that
 * product's price for the country from `api.gog.com/products/{id}/prices`.
 *
 * The price is GOG's own default for the country: the local currency where
 * GOG sells in one, USD where it doesn't (India, Japan, Korea…). We never
 * convert it — a USD figure is shown as USD, which is what GOG charges.
 *
 * Outbound: search 1 (cached 7 days per title) + price 1 (30 min per
 * product/country).
 */

import { unstable_cache } from "next/cache";
import { normaliseTitle, parseGogPrices, pickGogProduct, type GogProduct } from "./external-rules";
import { formatMinor } from "./market-rules";
import { USER_AGENT } from "./polite";
import type { LocalPrice } from "./types";

const TIMEOUT_MS = 3500;

async function gogJson(url: string): Promise<unknown | null> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 404 is GOG's "not sold here / no such product": a real, cacheable answer.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`gog ${res.status}`);
  return res.json();
}

const cachedProduct = unstable_cache(
  async (name: string): Promise<GogProduct | null> => {
    const query = name.replace(/["\\]/g, "").slice(0, 100);
    const raw = await gogJson(
      `https://catalog.gog.com/v1/catalog?limit=10&query=like:${encodeURIComponent(query)}&order=desc:score&productType=in:game,pack&countryCode=US&locale=en-US`,
    );
    return raw ? pickGogProduct(raw, name) : null;
  },
  ["gog-product-v1"],
  { revalidate: 60 * 60 * 24 * 7, tags: ["gog"] },
);

const cachedPrice = unstable_cache(
  async (productId: string, cc: string) => {
    const raw = await gogJson(`https://api.gog.com/products/${productId}/prices?countryCode=${cc}`);
    return raw ? parseGogPrices(raw) : null;
  },
  ["gog-price-v1"],
  { revalidate: 60 * 30, tags: ["gog"] },
);

/** GOG's current price for a game in a country; null when GOG doesn't sell it there (or can't be reached). */
export async function gogLocalPrice(name: string | null, cc: string): Promise<LocalPrice | null> {
  if (!name || !normaliseTitle(name) || !/^[A-Z]{2}$/.test(cc)) return null;
  try {
    const product = await cachedProduct(name.trim());
    if (!product) return null;
    const price = await cachedPrice(product.id, cc);
    if (!price) return null;
    return {
      store: "gog",
      country: cc,
      currency: price.currency,
      price: price.price,
      initial: price.initial,
      discount: price.discount,
      formatted: price.price === 0 ? "Free" : formatMinor(price.price, price.currency, `en-${cc}`, "narrowSymbol"),
      url: product.url,
      ...(normaliseTitle(product.title) !== normaliseTitle(name) ? { productTitle: product.title } : {}),
    };
  } catch (err) {
    console.warn("[gog] price failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
