/**
 * Microsoft Store prices, from the public display catalogue (no key).
 *
 * A product lists several SKUs (editions) and each SKU several
 * "availabilities": the plain purchase offer, time-boxed sale offers, Game
 * Pass / EA Play member offers, licence-only entries for bundles. The member
 * offers are the trap — they price at 0 or at a member discount and are
 * marked `RemediationRequired` with an "Upsell" to the subscription. Quoting
 * one as "the price" would be false, so only offers anyone can buy count:
 * a non-trial SKU, an availability with the `Purchase` action, no required
 * remediation, inside its date window, priced in the market's currency.
 *
 * Within the first SKU that has such an offer (Microsoft orders SKUs with the
 * base edition first), the cheapest live offer is the price; its MSRP is the
 * undiscounted figure.
 */

import type { LocalPrice } from "./types";
import { decimalToMinor, formatMinor } from "./market-rules";
import type { FetchBudget } from "./fetch-budget";

const BIG_ID = /^[0-9A-Z]{12}$/;
const TIMEOUT_MS = 3500;
/**
 * Products per request. The catalogue accepts 100, but each product is ~60 KB
 * of JSON (the slim `fieldsTemplate=browse` drops `RemediationRequired`, so
 * it can't tell a Game Pass member price from the real one); 20 keeps one
 * response near 1 MB and a few ms of parsing.
 */
export const MICROSOFT_PRICE_BATCH = 20;

interface Availability {
  Actions?: string[];
  RemediationRequired?: boolean;
  Conditions?: { StartDate?: string; EndDate?: string };
  OrderManagementData?: { Price?: { CurrencyCode?: string; ListPrice?: number; MSRP?: number } };
}

interface Product {
  ProductId?: string;
  DisplaySkuAvailabilities?: Array<{
    Sku?: { Properties?: { IsTrial?: boolean } };
    Availabilities?: Availability[];
  }>;
}

export interface MicrosoftPrice {
  currency: string;
  /** Minor units. */
  price: number;
  initial: number;
  discount: number;
}

/** The buy-it-now price of one catalogue product, or null when it has none. */
export function microsoftPriceOf(product: Product, now = Date.now()): MicrosoftPrice | null {
  for (const sku of product.DisplaySkuAvailabilities ?? []) {
    if (sku.Sku?.Properties?.IsTrial) continue;
    let best: MicrosoftPrice | null = null;
    for (const offer of sku.Availabilities ?? []) {
      if (!offer.Actions?.includes("Purchase") || offer.RemediationRequired) continue;
      const start = Date.parse(offer.Conditions?.StartDate ?? "");
      const end = Date.parse(offer.Conditions?.EndDate ?? "");
      if ((Number.isFinite(start) && start > now) || (Number.isFinite(end) && end < now)) continue;
      const price = offer.OrderManagementData?.Price;
      const currency = price?.CurrencyCode?.toUpperCase();
      if (!currency || !/^[A-Z]{3}$/.test(currency) || typeof price?.ListPrice !== "number" || price.ListPrice < 0) continue;
      const list = decimalToMinor(price.ListPrice, currency);
      const msrp = typeof price.MSRP === "number" && price.MSRP >= price.ListPrice ? decimalToMinor(price.MSRP, currency) : list;
      if (!best || list < best.price) {
        best = {
          currency,
          price: list,
          initial: msrp,
          discount: msrp > 0 ? Math.max(0, Math.min(100, Math.round((1 - list / msrp) * 100))) : 0,
        };
      }
    }
    if (best) return best;
  }
  return null;
}

async function fetchProducts(bigIds: string[], market: string, revalidate: number): Promise<Product[] | null> {
  try {
    // Prices follow `market`, not the language; en-us is verified to return
    // local-currency prices in every market (IN, JP, TR…), so one request does.
    const res = await fetch(
      `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${bigIds.join(",")}&market=${market}&languages=en-us`,
      {
        headers: { Accept: "application/json" },
        ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" as const }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { Products?: Product[] }).Products ?? [];
  } catch {
    return null;
  }
}

/**
 * Prices for many BigIds in one market (ISO2). Products the market doesn't
 * sell, or that have no public offer, are absent. Never throws. One request
 * per `MICROSOFT_PRICE_BATCH` ids, each charged to `budget`.
 */
export async function microsoftPrices(
  bigIds: string[],
  market: string,
  revalidate: number,
  budget?: FetchBudget,
): Promise<Map<string, MicrosoftPrice>> {
  const out = new Map<string, MicrosoftPrice>();
  const ids = [...new Set(bigIds.map((id) => id.toUpperCase()).filter((id) => BIG_ID.test(id)))].sort();
  if (ids.length === 0 || !/^[A-Z]{2}$/.test(market)) return out;

  for (let i = 0; i < ids.length; i += MICROSOFT_PRICE_BATCH) {
    const part = ids.slice(i, i + MICROSOFT_PRICE_BATCH);
    if (budget && !budget.take()) break;
    const products = await fetchProducts(part, market, revalidate);
    for (const product of products ?? []) {
      const id = product.ProductId?.toUpperCase();
      const price = id ? microsoftPriceOf(product) : null;
      if (id && price) out.set(id, price);
    }
  }
  return out;
}

export function microsoftLocalPrice(bigId: string, country: string, price: MicrosoftPrice): LocalPrice {
  return {
    store: "microsoft",
    country,
    currency: price.currency,
    price: price.price,
    initial: price.initial,
    discount: price.discount,
    formatted: price.price === 0 ? "Free" : formatMinor(price.price, price.currency, `en-${country}`, "narrowSymbol"),
    url: `https://www.microsoft.com/store/productId/${bigId}`,
  };
}
