/**
 * "Should I wait?" — a buying tip for the game page's price card. Pure, so it
 * runs in the browser on data the page already has (the market, CheapShark's
 * all-time low, the release date, the publishers) and so the rules are pinned
 * down in `scripts/check-providers.ts`.
 *
 * It weighs a handful of honest signals, each of which becomes a reason the
 * reader can see:
 *
 *  - how the current discount compares with the deepest one ever recorded
 *    (CheapShark, US, all stores — a percentage, so it compares across
 *    currencies where the dollar figure can't),
 *  - our own local price history (`priceVerdict` in `market-rules.ts`),
 *  - the next Steam seasonal sale (`steam-sales.ts`) — only for games sold
 *    on Steam, and only when they've actually been discounted before,
 *  - the game's age (new releases rarely drop far; old ones do, often),
 *  - a small table of publishers whose habits are well documented.
 *
 * Never overclaiming is the point: the three verdicts are hedged ("likely"),
 * the confidence says how much agrees, and with too little to go on the
 * confidence is "low" and says why. Nothing here predicts a price.
 */

import type { LocalPrice, PriceVerdictKind } from "./types";
import { nextSteamSale, type UpcomingSteamSale } from "./steam-sales";

export type BuyingTipKind = "buy" | "soon" | "wait";
export type TipConfidence = "high" | "medium" | "low";

export interface TipReason {
  /** Which way this signal leans; "info" is context that weighs nothing. */
  lean: "buy" | "wait" | "info";
  text: string;
}

export interface BuyingTip {
  kind: BuyingTipKind;
  confidence: TipConfidence;
  /** One sentence: the strongest reason for the verdict. */
  summary: string;
  reasons: TipReason[];
  /** The Steam sale the tip considered, when the game is on Steam. */
  sale: UpcomingSteamSale | null;
}

export interface BuyingTipInput {
  /** YYYY-MM-DD, UTC. */
  today: string;
  /** The cheapest current offer in the reader's region. */
  current: Pick<LocalPrice, "price" | "initial" | "discount" | "store"> | null;
  /** Our verdict from local history (`GameMarket.verdict`). */
  history: { kind: PriceVerdictKind; reason: string; days: number; lowest: number | null };
  /** CheapShark's deepest recorded discount, 0–100, US all stores; null when unknown. */
  deepestDiscount: number | null;
  /** YYYY-MM-DD of first release, null when unknown. */
  released: string | null;
  publishers: string[];
  /** Sold on Steam (the seasonal sales only apply there). */
  onSteam: boolean;
}

/** Thresholds, named so the rules read as documented. */
export const TIP = {
  /** Within this many points of the deepest discount ever counts as "as low as it goes". */
  nearDeepest: 5,
  /** A record discount this deep is worth waiting for. */
  worthWaiting: 30,
  /** Never more than this off: the game rarely gets cheaper. */
  rarelyDiscounted: 15,
  /** A sale this close is worth waiting for. */
  saleSoonDays: 30,
  /** A sale this close still makes "cheaper soon" likely. */
  saleNearDays: 60,
  /** Younger than this, a game is "new" (deep sales are unusual). */
  newGameDays: 60,
  /** Older than this, regular discounts are the norm. */
  oldGameDays: 730,
} as const;

/*
 * Publisher habits, deliberately short: only behaviour that's long-standing
 * and widely reported. Matched on the publisher's name, and only when the
 * publisher is unambiguous: IGDB lists regional and platform partners as
 * publishers too (WB Games on The Witcher 3), so a game with several
 * publishers gets a habit only when every one of them has the same habit.
 * "rare" leans buy (waiting rarely pays), "frequent" leans wait. Unknown
 * publishers simply add no reason.
 */
const HABITS: Array<{ match: RegExp; habit: "rare" | "shallow" | "frequent"; who: string }> = [
  { match: /\bnintendo\b|\bthe pok[eé]mon company\b/i, habit: "rare", who: "Nintendo" },
  { match: /\bactivision\b/i, habit: "shallow", who: "Activision" },
  { match: /\bubisoft\b/i, habit: "frequent", who: "Ubisoft" },
  { match: /\belectronic arts\b|^ea\b|\bea (games|sports)\b/i, habit: "frequent", who: "EA" },
  { match: /\bbandai namco\b/i, habit: "frequent", who: "Bandai Namco" },
  { match: /\bsquare enix\b/i, habit: "frequent", who: "Square Enix" },
  { match: /\bcapcom\b/i, habit: "frequent", who: "Capcom" },
  { match: /\bsega\b/i, habit: "frequent", who: "Sega" },
  { match: /\bwarner bros|\bwb games\b/i, habit: "frequent", who: "Warner Bros. Games" },
  { match: /\b2k( games)?\b/i, habit: "frequent", who: "2K" },
  { match: /\bdevolver\b/i, habit: "frequent", who: "Devolver Digital" },
  { match: /\bparadox interactive\b/i, habit: "frequent", who: "Paradox" },
  { match: /\bthq nordic\b/i, habit: "frequent", who: "THQ Nordic" },
];

export function publisherHabit(publishers: string[]): { habit: "rare" | "shallow" | "frequent"; who: string } | null {
  const named = publishers.filter((name) => name.trim());
  if (named.length === 0) return null;
  const found = named.map((name) => HABITS.find((entry) => entry.match.test(name)) ?? null);
  const first = found[0];
  if (!first || found.some((entry) => !entry || entry.habit !== first.habit)) return null;
  return { habit: first.habit, who: first.who };
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

const SALE_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const saleDay = (date: string) => SALE_DATE.format(new Date(`${date}T00:00:00Z`));

/** "Steam Winter Sale starts in ~58 days (expected around Dec 17)." */
export function saleSentence(sale: UpcomingSteamSale): string {
  if (sale.live) return `The Steam ${sale.name} is on now, until ${saleDay(sale.end)}.`;
  const when = sale.daysUntil === 1 ? "tomorrow" : `in ${sale.estimated ? "~" : ""}${sale.daysUntil} days`;
  return sale.estimated
    ? `The Steam ${sale.name} usually starts ${when} (expected around ${saleDay(sale.start)}).`
    : `The Steam ${sale.name} starts ${when}, on ${saleDay(sale.start)}.`;
}

/**
 * The tip, or null when there's nothing to buy (no price, free to play, not
 * out yet — a pre-order price says nothing about future discounts).
 */
export function buyingTip(input: BuyingTipInput): BuyingTip | null {
  const { current, today } = input;
  if (!current || current.price <= 0) return null;
  if (input.released && input.released > today) return null;

  const reasons: TipReason[] = [];
  const weights = new Map<TipReason, number>();
  let buy = 0;
  let wait = 0;
  const lean = (side: "buy" | "wait", weight: number, text: string) => {
    if (side === "buy") buy += weight;
    else wait += weight;
    const reason: TipReason = { lean: side, text };
    reasons.push(reason);
    weights.set(reason, weight);
  };

  const discount = Math.max(0, Math.round(current.discount));
  const deepest = input.deepestDiscount !== null && input.deepestDiscount >= 0 ? Math.round(input.deepestDiscount) : null;
  const age = input.released ? daysBetween(input.released, today) : null;
  const sale = input.onSteam ? nextSteamSale(today) : null;
  // Has it ever been meaningfully cheaper? Only then can a sale help.
  const discountsHappen = (deepest !== null && deepest >= TIP.worthWaiting) || input.history.kind === "wait";

  // 1. The discount against the deepest one ever recorded.
  if (deepest !== null && deepest >= 10 && discount > 0 && discount >= deepest - TIP.nearDeepest) {
    lean("buy", 4, `${discount}% off — about as deep as it has ever gone (record: ${deepest}% off, US stores).`);
  } else if (discount >= 60) {
    lean("buy", 3, `${discount}% off right now — a deep discount by any measure.`);
  } else if (deepest !== null && deepest >= TIP.worthWaiting && deepest - discount >= 15) {
    lean("wait", 2, discount > 0
      ? `${discount}% off now, but it has been ${deepest}% off before (US stores).`
      : `It has been ${deepest}% off before (US stores).`);
  } else if (deepest !== null && deepest < TIP.rarelyDiscounted && discount === 0) {
    lean("buy", 1, deepest === 0 ? "It has never been discounted in the US stores we track." : `It has never been more than ${deepest}% off in the US stores we track.`);
  }

  // 2. Our own local history.
  if (input.history.days >= 14 && input.history.lowest !== null && discount > 0 && current.price <= input.history.lowest * 1.02) {
    lean("buy", 2, "It's at the lowest price we've tracked in your region.");
  } else if (input.history.kind === "wait") {
    lean("wait", 2, input.history.reason);
  }

  // 3. The next Steam seasonal sale — only worth waiting for if discounts happen.
  if (sale) {
    const shallowNow = deepest === null ? discount < 20 : deepest - discount >= 10;
    if (sale.live) {
      reasons.push({ lean: "info", text: saleSentence(sale) });
    } else if (discountsHappen && shallowNow && sale.daysUntil <= TIP.saleSoonDays) {
      lean("wait", 3, saleSentence(sale));
    } else if (discountsHappen && shallowNow && sale.daysUntil <= TIP.saleNearDays) {
      lean("wait", 1, saleSentence(sale));
    } else if (sale.daysUntil <= TIP.saleNearDays) {
      reasons.push({ lean: "info", text: saleSentence(sale) });
    }
  }

  // 4. Age.
  if (age !== null && age >= 0 && age < TIP.newGameDays && discount === 0) {
    lean("buy", 1, "It came out recently — new releases seldom get deep discounts in their first months.");
  } else if (age !== null && age >= TIP.oldGameDays && discount < 25 && discountsHappen) {
    lean("wait", 1, `It's ${Math.floor(age / 365)} years old — games this age go on sale regularly.`);
  }

  // 5. Publisher habits.
  const habit = publisherHabit(input.publishers);
  if (habit?.habit === "rare") lean("buy", 2, `${habit.who} rarely discounts its games, and not by much — waiting seldom pays.`);
  else if (habit?.habit === "shallow" && discount === 0) lean("buy", 1, `${habit.who}'s discounts are usually modest.`);
  else if (habit?.habit === "frequent" && discount < 40) lean("wait", 1, `${habit.who} discounts its games often.`);

  const saleSoon = Boolean(sale && !sale.live && sale.daysUntil <= TIP.saleSoonDays && discountsHappen);
  let kind: BuyingTipKind;
  if (buy > wait) kind = "buy";
  else if (wait > buy && saleSoon) kind = "wait";
  else if (wait > buy) kind = "soon";
  // A tie, or no signals at all: nothing says it'll get cheaper soon.
  else kind = "buy";

  const margin = Math.abs(buy - wait);
  const signals = reasons.filter((reason) => reason.lean !== "info").length;
  const thin = deepest === null && input.history.days < 14;
  let confidence: TipConfidence = margin >= 4 && signals >= 2 ? "high" : margin >= 2 ? "medium" : "low";
  if (thin && confidence === "high") confidence = "medium";

  if (signals === 0) {
    reasons.push({ lean: "info", text: "We don't have enough price history for this game to call it either way." });
  }

  // Winning-side reasons first (heaviest first), then the other side, then context.
  const side = kind === "buy" ? "buy" : "wait";
  const order = (reason: TipReason) => (reason.lean === "info" ? 2 : reason.lean === side ? 0 : 1);
  const sorted = [...reasons].sort((a, b) => order(a) - order(b) || (weights.get(b) ?? 0) - (weights.get(a) ?? 0));
  const summary =
    sorted[0]?.lean === side
      ? sorted[0].text
      : kind === "buy"
        ? "Nothing suggests it'll get cheaper soon."
        : "It has been cheaper before.";
  return { kind, confidence, summary, reasons: sorted, sale };
}
